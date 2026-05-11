// api/reviews.js — Review Engine: queue, send asks, track receipts, testimonial library
// Reviews, Templates tabs → MARKETING_SHEET_ID; Leads → CRM_SHEET_ID
const { getSheetsClient } = require("../lib/sheets");
const { sendSms } = require("../lib/staff");
const { getConfig } = require("../lib/config");
const { marketingSpreadsheetId } = require("../lib/marketingSheetClient");

const LEADS_TAB   = "Leads";
const REVIEWS_TAB  = "Reviews";

const COMPLETE_STATUSES = ["complete", "completed", "paid", "closed", "invoiced"];

function nowIso() { return new Date().toISOString(); }

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function norm(v) { return String(v || "").trim().toLowerCase(); }
function isSmsOptIn(v) {
  const s = norm(v);
  return s === "true" || s === "1" || s === "yes";
}

function daysSince(isoStr) {
  if (!isoStr) return 9999;
  const d = new Date(isoStr);
  if (isNaN(d)) return 9999;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

async function readTab(sheets, spreadsheetId, tab, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${range}` });
    const rows = resp.data.values || [];
    if (rows.length < 1) return { headers: [], rows: [] };
    const headers = rows[0].map(h => String(h || "").trim());
    return { headers, rows: rows.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function toObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
  return obj;
}

function firstN(name) {
  return String(name || "").split(/\s+/)[0] || "there";
}

function renderTemplate(body, vars) {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] || "");
}

async function getActiveTemplate(sheets, _unused, category) {
  try {
    const spreadsheetId = marketingSpreadsheetId();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Templates!A:H",
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return null;
    const headers = rows[0].map(h => String(h || "").trim());
    for (let i = 1; i < rows.length; i++) {
      const t = toObj(headers, rows[i]);
      if (t.category === category && norm(t.active) === "true") return t;
    }
    return null;
  } catch { return null; }
}

async function updateClientField(sheets, spreadsheetId, leadId, updates) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${LEADS_TAB}!A:ZZ`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0].map(h => String(h || "").trim());

  const findId = (row) => {
    const idIdx = headers.indexOf("id");
    const leadIdIdx = headers.indexOf("lead_id");
    const rawId = String(row[idIdx] || "").trim();
    const rawLid = String(row[leadIdIdx] || "").trim();
    return rawId === leadId || rawLid === leadId;
  };

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (findId(rows[i])) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return false;

  const sheetRowNum = rowIndex + 1;
  const colLetter = c => {
    if (c < 26) return String.fromCharCode(65 + c);
    return String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
  };

  const batchData = [];
  for (const [field, value] of Object.entries(updates)) {
    let ci = headers.indexOf(field);
    if (ci === -1) {
      // append header
      const newHeaders = [...headers, field];
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${LEADS_TAB}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [newHeaders] },
      });
      headers.push(field);
      ci = headers.length - 1;
    }
    batchData.push({ range: `${LEADS_TAB}!${colLetter(ci)}${sheetRowNum}`, values: [[String(value)]] });
  }

  if (batchData.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: batchData },
    });
  }
  return true;
}

// GET /api/reviews — returns { queue, pending, received, response_due }
async function handleGetReviews(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "No CRM_SHEET_ID" });
    const mktId = marketingSpreadsheetId();

    const [clientsData, reviewsData] = await Promise.all([
      readTab(sheets, spreadsheetId, LEADS_TAB, "A:ZZ"),
      readTab(sheets, mktId, REVIEWS_TAB, "A:T").catch(() => ({ headers: [], rows: [] })),
    ]);

    // Index reviews by lead_id
    const reviewByLead = {};
    const liIdx = reviewsData.headers.indexOf("lead_id");
    if (liIdx >= 0) {
      for (const row of reviewsData.rows) {
        const lid = String(row[liIdx] || "").trim();
        if (lid) reviewByLead[lid] = toObj(reviewsData.headers, row);
      }
    }

    const { headers, rows } = clientsData;
    const idIdx    = headers.indexOf("id");
    const lidIdx   = headers.indexOf("lead_id");
    const nameIdx  = headers.indexOf("name");
    const phoneIdx = headers.indexOf("phone");
    const statIdx  = headers.indexOf("status_code");
    const smsIdx   = headers.indexOf("sms_opt_in");
    const jobIdx   = headers.indexOf("job_description");
    const actIdx   = headers.indexOf("last_activity_at");
    const revStatIdx = headers.indexOf("review_status");
    const revAskIdx  = headers.indexOf("review_ask_sent_at");
    const revRemIdx  = headers.indexOf("review_reminder_sent_at");
    const createdIdx = headers.indexOf("created_at");
    const srcIdx     = headers.indexOf("lead_source");
    const emailIdx   = headers.indexOf("email");
    const cityIdx    = headers.indexOf("city");
    const addrIdx    = headers.indexOf("primary_address");

    const queue = [], pending = [], received = [], response_due = [];

    for (const row of rows) {
      const status = norm(String(row[statIdx] || ""));
      if (!COMPLETE_STATUSES.includes(status)) continue;

      const rawId  = String(row[idIdx] || "").trim();
      const leadId = String(row[lidIdx] || "").trim() || rawId;
      if (!leadId) continue;

      const reviewStatus = String(row[revStatIdx] || "").trim();
      const complaintFlag = (reviewByLead[leadId] || {}).complaint_flag || "";
      if (norm(complaintFlag) === "true") continue;

      const name   = String(row[nameIdx] || "").trim() || "Unknown";
      const phone  = String(row[phoneIdx] || "").trim();
      const smsOpt = String(row[smsIdx] || "").trim();
      const job    = String(row[jobIdx] || "").trim() || "Service";
      const lastAct = String(row[actIdx] || row[createdIdx] || "").trim();
      const source  = String(row[srcIdx] || "").trim();
      const email   = String(row[emailIdx] || "").trim();
      const cityRaw = cityIdx >= 0 ? String(row[cityIdx] || "").trim() : "";
      const addrRaw = addrIdx >= 0 ? String(row[addrIdx] || "").trim() : "";
      // Extract city: prefer explicit city column, else parse from address, else default
      let city = cityRaw;
      if (!city && addrRaw) {
        const m = addrRaw.match(/,\s*([A-Za-z\s]+?)(?:\s+TX|\s+\d{5}|$)/);
        if (m) city = m[1].trim();
      }
      if (!city) city = "Orange";
      const askSentAt = String(row[revAskIdx] || "").trim();
      const remSentAt = String(row[revRemIdx] || "").trim();
      const daysSinceComplete = daysSince(lastAct);

      const hasSmsOptIn = isSmsOptIn(smsOpt);
      const entry = {
        lead_id: leadId,
        name,
        phone,
        email,
        city,
        job_type: job,
        source,
        days_since_complete: daysSinceComplete,
        review_status: reviewStatus,
        review_ask_sent_at: askSentAt,
        review_reminder_sent_at: remSentAt,
        sms_opt_in: smsOpt,
        has_phone: !!phone,
        has_sms_opt_in: hasSmsOptIn,
        review: reviewByLead[leadId] || null,
      };

      if (!reviewStatus || reviewStatus === "none") {
        // Queue only includes sms_opt_in + has phone (can actually receive the text)
        if (hasSmsOptIn && phone) {
          queue.push(entry);
        }
      } else if (reviewStatus === "asked") {
        const daysSinceAsk = daysSince(askSentAt);
        entry.days_since_ask = daysSinceAsk;
        entry.reminder_eligible = daysSinceAsk >= 2;
        pending.push(entry);
      } else if (reviewStatus === "reminded") {
        const daysSinceAsk = daysSince(remSentAt);
        entry.days_since_reminder = daysSinceAsk;
        pending.push(entry);
      } else if (reviewStatus === "received") {
        const rev = reviewByLead[leadId] || {};
        entry.review_text  = rev.review_text || "";
        entry.star_rating  = rev.star_rating || "";
        entry.service_tag  = rev.service_tag || "";
        entry.city_tag     = rev.city_tag || "";
        entry.response_status = rev.response_status || "";
        if (!rev.response_status || rev.response_status === "pending") {
          response_due.push(entry);
        }
        received.push(entry);
      }
    }

    // Sort queue by days_since_complete desc (oldest completed first)
    queue.sort((a, b) => b.days_since_complete - a.days_since_complete);
    pending.sort((a, b) => (b.days_since_ask || 0) - (a.days_since_ask || 0));

    json(res, 200, { ok: true, queue, pending, received, response_due });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/reviews/ask — send review ask SMS
async function handleSendAsk(req, res) {
  try {
    const body = await readBody(req);
    const { lead_id, name, phone, job_type, city } = body;
    if (!lead_id) return json(res, 400, { ok: false, error: "lead_id required" });

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const mktId = marketingSpreadsheetId();

    // Prevent duplicate ask — check current review_status on this client
    const clientsResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${LEADS_TAB}!A:ZZ`,
    });
    const cRows = clientsResp.data.values || [];
    if (cRows.length > 1) {
      const cHeaders = cRows[0].map(h => String(h || "").trim());
      const cIdIdx = cHeaders.indexOf("id");
      const cLidIdx = cHeaders.indexOf("id"); // Leads use id directly
      const cRevStatIdx = cHeaders.indexOf("review_status");
      for (let i = 1; i < cRows.length; i++) {
        const rowId  = String(cRows[i][cIdIdx] || "").trim();
        const rowLid = String(cRows[i][cLidIdx] || "").trim();
        if (rowId === lead_id || rowLid === lead_id) {
          const existing = cRevStatIdx >= 0 ? String(cRows[i][cRevStatIdx] || "").trim() : "";
          if (existing && existing !== "none" && existing !== "") {
            return json(res, 409, { ok: false, error: `Review already in progress: status is '${existing}'` });
          }
          break;
        }
      }
    }
    const config = await getConfig();

    const reviewUrl = config.google_review_url || "https://g.page/r/vickeryelectric/review";
    const template = await getActiveTemplate(sheets, null, "review_ask");

    const firstName = firstN(name);
    const service = job_type || "your recent electrical work";
    let smsBody = template
      ? renderTemplate(template.body, { first_name: firstName, service, review_link: reviewUrl, city: city || "Orange, TX" })
      : `Hi ${firstName}, thanks for choosing Vickery Electric for ${service}! A quick Google review means the world to us: ${reviewUrl} — Cody at Vickery Electric`;

    let smsSent = false;
    let phoneClean = String(phone || "").replace(/\D/g, "");
    if (phoneClean.length === 10) phoneClean = "+1" + phoneClean;
    else if (phoneClean.length === 11) phoneClean = "+" + phoneClean;

    if (phoneClean.length >= 11) {
      smsSent = await sendSms(phoneClean, smsBody);
    }

    const now = nowIso();

    // Create Reviews row (on Marketing sheet)
    const reviewId = "REV-" + Date.now();
    const revHeaders = (await readTab(sheets, mktId, REVIEWS_TAB, "1:1")).headers;
    const revObj = {
      id: reviewId, created_at: now, lead_id,
      customer_name: name || "", phone: phone || "",
      job_type: job_type || "", city: city || "",
      ask_sent_at: now, ask_channel: "SMS",
      response_status: "pending",
    };
    const revRow = revHeaders.length > 0
      ? revHeaders.map(h => revObj[h] || "")
      : Object.values(revObj);

    await sheets.spreadsheets.values.append({
      spreadsheetId: mktId, range: `${REVIEWS_TAB}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [revRow] },
    });

    // Update Leads review_status (on CRM sheet)
    await updateClientField(sheets, spreadsheetId, lead_id, {
      review_status: "asked",
      review_ask_sent_at: now,
    });

    json(res, 200, { ok: true, sms_sent: smsSent, review_id: reviewId });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/reviews/remind — send reminder SMS (max 1 reminder; min 48h after ask)
async function handleSendReminder(req, res) {
  try {
    const body = await readBody(req);
    const { lead_id, name, phone, job_type, city } = body;
    if (!lead_id) return json(res, 400, { ok: false, error: "lead_id required" });

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const mktId = marketingSpreadsheetId();

    // Enforce eligibility: must be status=asked, 48h+ elapsed, not already reminded
    const clientsResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${LEADS_TAB}!A:ZZ`,
    });
    const cRows = clientsResp.data.values || [];
    if (cRows.length > 1) {
      const cH = cRows[0].map(h => String(h || "").trim());
      const cIdIdx      = cH.indexOf("id");
      const cLidIdx     = cH.indexOf("id"); // Leads use id directly
      const cRevStatIdx = cH.indexOf("review_status");
      const cAskIdx     = cH.indexOf("review_ask_sent_at");
      const cRemIdx     = cH.indexOf("review_reminder_sent_at");
      for (let i = 1; i < cRows.length; i++) {
        const rowId  = String(cRows[i][cIdIdx] || "").trim();
        const rowLid = String(cRows[i][cLidIdx] || "").trim();
        if (rowId === lead_id || rowLid === lead_id) {
          const revStat = cRevStatIdx >= 0 ? String(cRows[i][cRevStatIdx] || "").trim() : "";
          if (revStat !== "asked") {
            return json(res, 409, { ok: false, error: `Cannot send reminder: review_status is '${revStat}' (must be 'asked')` });
          }
          const askAt = cAskIdx >= 0 ? String(cRows[i][cAskIdx] || "").trim() : "";
          if (daysSince(askAt) < 2) {
            return json(res, 409, { ok: false, error: "Cannot send reminder: minimum 48 hours must pass after initial ask" });
          }
          const remAt = cRemIdx >= 0 ? String(cRows[i][cRemIdx] || "").trim() : "";
          if (remAt) {
            return json(res, 409, { ok: false, error: "Reminder already sent for this lead (one reminder maximum)" });
          }
          break;
        }
      }
    }
    const config = await getConfig();

    const reviewUrl = config.google_review_url || "https://g.page/r/vickeryelectric/review";
    const template = await getActiveTemplate(sheets, null, "review_reminder");

    const firstName = firstN(name);
    let smsBody = template
      ? renderTemplate(template.body, { first_name: firstName, service: job_type || "service", review_link: reviewUrl, city: city || "" })
      : `Hi ${firstName}, just a quick follow-up on your ${job_type || "recent electrical work"} with Vickery Electric — if you had a great experience, we'd love a Google review: ${reviewUrl} — Cody at Vickery Electric`;

    let smsSent = false;
    let phoneClean = String(phone || "").replace(/\D/g, "");
    if (phoneClean.length === 10) phoneClean = "+1" + phoneClean;
    else if (phoneClean.length === 11) phoneClean = "+" + phoneClean;

    if (phoneClean.length >= 11) {
      smsSent = await sendSms(phoneClean, smsBody);
    }

    const now = nowIso();

    // Update Reviews row (on Marketing sheet)
    const reviewsData = await readTab(sheets, mktId, REVIEWS_TAB, "A:T");
    const lidIdx = reviewsData.headers.indexOf("lead_id");
    const remIdx = reviewsData.headers.indexOf("reminder_sent_at");
    if (lidIdx >= 0 && remIdx >= 0) {
      for (let i = 0; i < reviewsData.rows.length; i++) {
        const rowLid = String(reviewsData.rows[i][lidIdx] || "").trim();
        if (rowLid === lead_id) {
          const colLetter = c => String.fromCharCode(65 + c);
          await sheets.spreadsheets.values.update({
            spreadsheetId: mktId,
            range: `${REVIEWS_TAB}!${colLetter(remIdx)}${i + 2}`,
            valueInputOption: "RAW",
            requestBody: { values: [[now]] },
          });
          break;
        }
      }
    }

    // Update Leads review fields (on CRM sheet)
    await updateClientField(sheets, spreadsheetId, lead_id, {
      review_status: "reminded",
      review_reminder_sent_at: now,
    });

    json(res, 200, { ok: true, sms_sent: smsSent });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/reviews/:id — update review (mark received, tag, mark responded)
async function handleUpdateReview(req, res, reviewId) {
  try {
    const body = await readBody(req);
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const mktId = marketingSpreadsheetId();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: mktId, range: `${REVIEWS_TAB}!A:T`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 404, { ok: false, error: "Review not found" });

    const headers = rows[0].map(h => String(h || "").trim());
    const idIdx = headers.indexOf("id");

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx] || "").trim() === reviewId) { rowIndex = i; break; }
    }

    // If marking by lead_id (no review id known)
    if (rowIndex === -1 && body.lead_id) {
      const lidIdx2 = headers.indexOf("lead_id");
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][lidIdx2] || "").trim() === body.lead_id) { rowIndex = i; break; }
      }
    }

    if (rowIndex === -1) return json(res, 404, { ok: false, error: "Review not found" });

    const EDITABLE = ["star_rating", "review_text", "service_tag", "city_tag", "technician_tag", "complaint_flag", "response_status", "notes", "review_received_at"];
    const colLetter = c => String.fromCharCode(65 + c);
    const updates = [];

    for (const field of EDITABLE) {
      if (body[field] === undefined) continue;
      const ci = headers.indexOf(field);
      if (ci >= 0) updates.push({ range: `${REVIEWS_TAB}!${colLetter(ci)}${rowIndex + 1}`, values: [[String(body[field])]] });
    }

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: mktId, requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    // If marking received, also update Leads review_status (on CRM sheet)
    if (body.review_received_at || body.star_rating || body.review_text) {
      const lidIdx2 = headers.indexOf("lead_id");
      const leadId = String(rows[rowIndex][lidIdx2] || "").trim();
      if (leadId) {
        await updateClientField(sheets, spreadsheetId, leadId, { review_status: "received" });
      }
    }

    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetReviews,
  handleSendAsk,
  handleSendReminder,
  handleUpdateReview,
};
