// api/marketing.js — Marketing Hub: Overview scoreboard, Segments, Follow-up queue
// Reviews, Templates tabs → MARKETING_SHEET_ID
const { getSheetsClient } = require("../lib/sheets");
const { sendSms } = require("../lib/staff");
const { getConfig, setConfigKeys } = require("../lib/config");
const { marketingSpreadsheetId } = require("../lib/marketingSheetClient");

const COMPLETE_STATUSES = ["complete", "completed", "paid", "closed", "invoiced"];
const BOOKED_STATUSES   = ["scheduled", "in progress", "complete", "completed", "paid", "closed", "invoiced"];
const STALE_QUOTE_STATUSES = ["estimate_sent", "awaiting_response", "new", "quoted"];
const QUOTED_STATUSES   = ["quoted", "estimate_sent", "awaiting_response"];

const SOURCE_CATEGORIES = [
  "GBP", "Organic SEO", "LSA", "Google Ads", "Direct",
  "Referral", "Yard Sign", "Truck Wrap", "Repeat Customer",
  "Facebook", "Manual Outreach", "Other",
];

function norm(v) { return String(v || "").trim().toLowerCase(); }
function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function daysSince(isoStr) {
  if (!isoStr) return 9999;
  const d = new Date(isoStr);
  if (isNaN(d)) return 9999;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

async function readTabRows(sheets, spreadsheetId, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:ZZ` });
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
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Templates!A:H" });
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

// GET /api/marketing/overview
async function handleGetOverview(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const config = await getConfig();
    const hvThreshold = Number(config.high_value_threshold || "1000");

    const mktId = marketingSpreadsheetId();
    const [clientsData, reviewsData] = await Promise.all([
      readTabRows(sheets, spreadsheetId, "Leads"),
      readTabRows(sheets, mktId, "Reviews").catch(() => ({ headers: [], rows: [] })),
    ]);

    const { headers, rows } = clientsData;
    const statusIdx   = headers.indexOf("status_code");
    const srcIdx      = headers.indexOf("lead_source");
    const invIdx      = headers.indexOf("invoiced_amount");
    const paidIdx     = headers.indexOf("paid_amount");
    const revStatIdx  = headers.indexOf("review_status");
    const smsIdx      = headers.indexOf("sms_opt_in");
    const createdIdx  = headers.indexOf("created_at");
    const actIdx      = headers.indexOf("last_activity_at");
    const estIdx      = headers.indexOf("estimated_value");
    const quotedIdx   = headers.indexOf("quoted_price");
    const nameIdx     = headers.indexOf("name");
    const phoneIdx    = headers.indexOf("phone");

    const updatedAtIdx = headers.indexOf("updated_at");

    const leadsTotal = rows.filter(r => r && r.length && String(r[0] || "").trim()).length;
    let bookedCount = 0;
    let completedCount = 0;
    let revenueTotal = 0;
    let quotedOrBookedCount = 0;
    const sourceLeads = {};
    const sourceBooked = {};
    const sourceRevenue = {};
    let reviewEligible = 0;
    let reviewAsked = 0;
    let reviewReceived = 0;
    let staleQuoteCount = 0;
    let repeatCustomers = 0;
    const firstResponseHoursArr = [];

    // phone → job count for repeat customer rate
    const phoneCounts = {};

    for (const row of rows) {
      if (!row || !row.length || !String(row[0] || "").trim()) continue;

      const status = norm(String(row[statusIdx] || ""));
      const src    = String(row[srcIdx] || "").trim() || "Unknown";
      const inv    = Number(row[invIdx] || 0);
      const paid   = Number(row[paidIdx] || 0);
      const rev    = inv > 0 ? inv : paid;
      const revStat = String(row[revStatIdx] || "").trim();
      const smsOpt  = String(row[smsIdx] || "").trim();
      const lastAct = String(row[actIdx] || row[createdIdx] || "").trim();
      const est     = Number(row[estIdx] || row[quotedIdx] || 0);
      const phone   = String(row[phoneIdx] || "").trim().replace(/\D/g, "");

      // Source counts
      if (!sourceLeads[src]) sourceLeads[src] = 0;
      sourceLeads[src]++;

      if (QUOTED_STATUSES.includes(status)) quotedOrBookedCount++;

      if (BOOKED_STATUSES.includes(status)) {
        bookedCount++;
        quotedOrBookedCount++; // booked leads were all quoted at some point
        if (!sourceBooked[src]) sourceBooked[src] = 0;
        sourceBooked[src]++;
        if (!sourceRevenue[src]) sourceRevenue[src] = 0;
        sourceRevenue[src] += rev;
        revenueTotal += rev;
      }

      if (COMPLETE_STATUSES.includes(status)) {
        completedCount++;
        // Review eligible
        reviewEligible++;
        if (revStat === "asked" || revStat === "reminded") reviewAsked++;
        if (revStat === "received") { reviewAsked++; reviewReceived++; }
      }

      if (STALE_QUOTE_STATUSES.includes(status)) {
        const days = daysSince(lastAct);
        if (days >= 2) staleQuoteCount++;
      }

      if (phone) {
        phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
      }

      // First-response time: created_at → updated_at (proxy for first status change / touch)
      const createdAt  = String(row[createdIdx] || "").trim();
      const updatedAt  = String(row[updatedAtIdx >= 0 ? updatedAtIdx : actIdx] || "").trim();
      if (createdAt && updatedAt && createdAt !== updatedAt) {
        const diffMs = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
        if (diffMs > 0) firstResponseHoursArr.push(diffMs / 3600000);
      }
    }

    // Median first-response time (hours)
    let medianFirstResponseHours = null;
    if (firstResponseHoursArr.length > 0) {
      const sorted = [...firstResponseHoursArr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianFirstResponseHours = sorted.length % 2 === 0
        ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
        : Math.round(sorted[mid] * 10) / 10;
    }

    // Repeat customer rate
    const uniquePhones = Object.keys(phoneCounts).length;
    const repeatPhones = Object.values(phoneCounts).filter(c => c >= 2).length;
    const repeatRate = uniquePhones > 0 ? Math.round((repeatPhones / uniquePhones) * 100) : 0;

    // Bookings count (cross-check)
    const bookingsCount = (bookingsData.rows || []).filter(r => r && r.length && String(r[0] || "").trim()).length;

    // Build source breakdown table
    const allSources = [...new Set([...Object.keys(sourceLeads), ...Object.keys(sourceBooked)])];
    const sourceBreakdown = allSources.map(src => ({
      source: src,
      leads: sourceLeads[src] || 0,
      booked: sourceBooked[src] || 0,
      revenue: Math.round((sourceRevenue[src] || 0) * 100) / 100,
      close_rate: sourceLeads[src] > 0
        ? Math.round(((sourceBooked[src] || 0) / sourceLeads[src]) * 100)
        : 0,
    })).sort((a, b) => b.leads - a.leads);

    const closeRate = leadsTotal > 0 ? Math.round((bookedCount / leadsTotal) * 100) : 0;
    const quoteToBookRate = quotedOrBookedCount > 0 ? Math.round((bookedCount / quotedOrBookedCount) * 100) : 0;
    const reviewRequestRate = reviewEligible > 0 ? Math.round((reviewAsked / reviewEligible) * 100) : 0;
    const reviewConversionRate = reviewAsked > 0 ? Math.round((reviewReceived / reviewAsked) * 100) : 0;

    json(res, 200, {
      ok: true,
      overview: {
        leads_total: leadsTotal,
        booked_count: bookedCount,
        completed_count: completedCount,
        revenue_total: Math.round(revenueTotal * 100) / 100,
        close_rate_pct: closeRate,
        quote_to_book_pct: quoteToBookRate,
        median_first_response_hours: medianFirstResponseHours,
        review_eligible: reviewEligible,
        review_asked: reviewAsked,
        review_received: reviewReceived,
        review_request_rate_pct: reviewRequestRate,
        review_conversion_rate_pct: reviewConversionRate,
        repeat_customer_rate_pct: repeatRate,
        stale_quote_count: staleQuoteCount,
        source_breakdown: sourceBreakdown,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/segments
async function handleGetSegments(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const config = await getConfig();
    const hvThreshold = Number(config.high_value_threshold || "1000");

    const mktId = marketingSpreadsheetId();
    const [clientsData, reviewsData] = await Promise.all([
      readTabRows(sheets, spreadsheetId, "Leads"),
      readTabRows(sheets, mktId, "Reviews").catch(() => ({ headers: [], rows: [] })),
    ]);

    const { headers, rows } = clientsData;
    const statusIdx  = headers.indexOf("status_code");
    const smsIdx     = headers.indexOf("sms_opt_in");
    const actIdx     = headers.indexOf("last_activity_at");
    const createdIdx = headers.indexOf("created_at");
    const nameIdx    = headers.indexOf("name");
    const phoneIdx   = headers.indexOf("phone");
    const emailIdx   = headers.indexOf("email");
    const revStatIdx = headers.indexOf("review_status");
    const estIdx     = headers.indexOf("estimated_value");
    const quotedIdx  = headers.indexOf("quoted_price");
    const invIdx     = headers.indexOf("invoiced_amount");
    const paidIdx    = headers.indexOf("paid_amount");
    const idIdx      = headers.indexOf("id");
    const lidIdx     = headers.indexOf("lead_id");

    const segments = {
      needs_review_ask: [],
      stale_quote: [],
      reactivation_ready: [],
      repeat_customers: [],
      high_value: [],
      no_sms_opt_in: [],
    };

    // Count completions per phone for repeat
    const phoneCompletions = {};

    for (const row of rows) {
      if (!row || !row.length || !String(row[0] || "").trim()) continue;
      const phone = String(row[phoneIdx] || "").trim().replace(/\D/g, "");
      const status = norm(String(row[statusIdx] || ""));
      if (COMPLETE_STATUSES.includes(status) && phone) {
        phoneCompletions[phone] = (phoneCompletions[phone] || 0) + 1;
      }
    }

    const seen = {}; // deduplicate by phone for repeat

    for (const row of rows) {
      if (!row || !row.length || !String(row[0] || "").trim()) continue;
      const id      = String(row[idIdx] || "").trim();
      const leadId  = String(row[lidIdx] || "").trim() || id;
      const name    = String(row[nameIdx] || "").trim() || "Unknown";
      const phone   = String(row[phoneIdx] || "").trim();
      const email   = String(row[emailIdx] || "").trim();
      const status  = norm(String(row[statusIdx] || ""));
      const smsOpt  = String(row[smsIdx] || "").trim();
      const lastAct = String(row[actIdx] || row[createdIdx] || "").trim();
      const revStat = String(row[revStatIdx] || "").trim();
      const est     = Number(row[estIdx] || row[quotedIdx] || 0);
      const inv     = Number(row[invIdx] || 0);
      const paid    = Number(row[paidIdx] || 0);
      const value   = inv > 0 ? inv : (paid > 0 ? paid : est);
      const phoneDigits = phone.replace(/\D/g, "");

      const baseEntry = { lead_id: leadId, name, phone, email, status, last_activity: lastAct, value };

      // 1. Needs Review Ask — requires sms_opt_in + phone (same eligibility as review engine queue)
      const hasSmsOptIn = smsOpt === "true" || smsOpt === "yes" || smsOpt === "1";
      if (COMPLETE_STATUSES.includes(status) && hasSmsOptIn && phoneDigits && (!revStat || revStat === "none")) {
        segments.needs_review_ask.push({ ...baseEntry, days_since_complete: daysSince(lastAct) });
      }

      // 2. Stale Quote
      if (STALE_QUOTE_STATUSES.includes(status)) {
        const days = daysSince(lastAct);
        if (days >= 2) {
          segments.stale_quote.push({ ...baseEntry, days_stale: days });
        }
      }

      // 3. Reactivation Ready (no completed job in 6+ months)
      if (COMPLETE_STATUSES.includes(status)) {
        const days = daysSince(lastAct);
        if (days >= 180) {
          segments.reactivation_ready.push({ ...baseEntry, days_inactive: days });
        }
      }

      // 4. Repeat Customers
      if (COMPLETE_STATUSES.includes(status) && phoneDigits && !seen[phoneDigits]) {
        if ((phoneCompletions[phoneDigits] || 0) >= 2) {
          seen[phoneDigits] = true;
          segments.repeat_customers.push({ ...baseEntry, job_count: phoneCompletions[phoneDigits] });
        }
      }

      // 5. High Value
      if (value >= hvThreshold) {
        segments.high_value.push({ ...baseEntry });
      }

      // 6. No SMS Opt-in (completed but can't text)
      if (COMPLETE_STATUSES.includes(status) && (!smsOpt || smsOpt === "no" || smsOpt === "false") && (!revStat || revStat === "none")) {
        segments.no_sms_opt_in.push({ ...baseEntry });
      }
    }

    // Sort each segment
    segments.needs_review_ask.sort((a, b) => b.days_since_complete - a.days_since_complete);
    segments.stale_quote.sort((a, b) => b.days_stale - a.days_stale);
    segments.reactivation_ready.sort((a, b) => b.days_inactive - a.days_inactive);
    segments.repeat_customers.sort((a, b) => b.job_count - a.job_count);
    segments.high_value.sort((a, b) => b.value - a.value);

    const counts = {};
    for (const [k, v] of Object.entries(segments)) counts[k] = v.length;

    json(res, 200, { ok: true, segments, counts });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/followup — stale quotes grouped by age bucket
async function handleGetFollowupQueue(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const { headers, rows } = await readTabRows(sheets, spreadsheetId, "Leads");

    const statusIdx  = headers.indexOf("status");
    const actIdx     = headers.indexOf("updated_at");
    const createdIdx = headers.indexOf("created_at");
    const nameIdx    = headers.indexOf("name");
    const phoneIdx   = headers.indexOf("phone");
    const emailIdx   = headers.indexOf("email");
    const idIdx      = headers.indexOf("id");
    const lidIdx     = headers.indexOf("lead_id");
    const estIdx     = headers.indexOf("estimated_value");
    const quotedIdx  = headers.indexOf("quoted_price");
    const jobIdx     = headers.indexOf("job_description");

    const buckets = { "24h": [], "72h": [], "7d": [], "14d+": [] };

    for (const row of rows) {
      if (!row || !row.length || !String(row[0] || "").trim()) continue;
      const status = norm(String(row[statusIdx] || ""));
      if (!STALE_QUOTE_STATUSES.includes(status)) continue;

      const id     = String(row[idIdx] || "").trim();
      const leadId = String(row[lidIdx] || "").trim() || id;
      const name   = String(row[nameIdx] || "").trim() || "Unknown";
      const phone  = String(row[phoneIdx] || "").trim();
      const email  = String(row[emailIdx] || "").trim();
      const lastAct = String(row[actIdx] || row[createdIdx] || "").trim();
      const est    = Number(row[estIdx] || row[quotedIdx] || 0);
      const job    = String(row[jobIdx] || "").trim() || "Service";
      const days   = daysSince(lastAct);

      const entry = { lead_id: leadId, name, phone, email, status, job_type: job, days_stale: days, estimated_value: est, last_activity: lastAct };

      if (days < 3)        buckets["24h"].push(entry);
      else if (days < 7)   buckets["72h"].push(entry);
      else if (days < 14)  buckets["7d"].push(entry);
      else                  buckets["14d+"].push(entry);
    }

    for (const b of Object.values(buckets)) b.sort((a, bb) => bb.days_stale - a.days_stale);

    json(res, 200, { ok: true, buckets, total: Object.values(buckets).reduce((s, b) => s + b.length, 0) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/followup/send — fire template SMS for stale quote
async function handleSendFollowup(req, res) {
  try {
    const body = await readBody(req);
    const { lead_id, name, phone, job_type } = body;
    if (!lead_id) return json(res, 400, { ok: false, error: "lead_id required" });

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const config = await getConfig();

    const template = await getActiveTemplate(sheets, spreadsheetId, "quote_followup");
    const firstName = firstN(name);
    const service = job_type || "your project";

    let smsBody = template
      ? renderTemplate(template.body, { first_name: firstName, service, review_link: config.google_review_url || "" })
      : `Hi ${firstName}, this is Cody from Vickery Electric — just checking in on your quote for ${service}. Let us know if you have any questions!`;

    let phoneClean = String(phone || "").replace(/\D/g, "");
    if (phoneClean.length === 10) phoneClean = "+1" + phoneClean;
    else if (phoneClean.length === 11) phoneClean = "+" + phoneClean;

    let smsSent = false;
    if (phoneClean.length >= 11) {
      smsSent = await sendSms(phoneClean, smsBody);
    }

    // Log the follow-up touch on the client: update last_activity_at and last_followup_at
    const now = new Date().toISOString();
    const { headers, rows } = await readTabRows(sheets, spreadsheetId, "Leads");
    const lidIdx2     = headers.indexOf("id");
    const idIdx2      = headers.indexOf("id");
    const actIdx2     = headers.indexOf("last_activity_at");
    const followupIdx = headers.indexOf("last_followup_at");
    for (let i = 0; i < rows.length; i++) {
      const rowId   = String(rows[i][idIdx2] || "").trim();
      const rowLid  = String(rows[i][lidIdx2] || "").trim();
      if (rowId === lead_id || rowLid === lead_id) {
        const colLetter = c => String.fromCharCode(65 + c);
        const updateOps = [];
        if (actIdx2 >= 0) {
          updateOps.push({ range: `Leads!${colLetter(actIdx2)}${i + 2}`, values: [[now]] });
        }
        if (followupIdx >= 0) {
          updateOps.push({ range: `Leads!${colLetter(followupIdx)}${i + 2}`, values: [[now]] });
        }
        for (const op of updateOps) {
          await sheets.spreadsheets.values.update({
            spreadsheetId, range: op.range,
            valueInputOption: "RAW",
            requestBody: { values: op.values },
          });
        }
        break;
      }
    }

    json(res, 200, { ok: true, sms_sent: smsSent, message_body: smsBody });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/sources
async function handleGetSources(req, res) {
  json(res, 200, { ok: true, sources: SOURCE_CATEGORIES });
}

// GET /api/marketing/settings — return editable marketing config
async function handleGetMarketingSettings(req, res) {
  try {
    const config = await getConfig();
    json(res, 200, {
      ok: true,
      settings: {
        google_review_url:   config.google_review_url   || "",
        high_value_threshold: config.high_value_threshold || "1000",
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/settings — save editable marketing config
async function handleSaveMarketingSettings(req, res) {
  try {
    const body = await readBody(req);
    const map  = {};
    if (body.google_review_url   !== undefined) map.google_review_url   = String(body.google_review_url || "").trim();
    if (body.high_value_threshold !== undefined) map.high_value_threshold = String(Number(body.high_value_threshold) || 1000);
    if (Object.keys(map).length === 0) return json(res, 400, { ok: false, error: "No settings provided" });
    await setConfigKeys(map);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetOverview,
  handleGetSegments,
  handleGetFollowupQueue,
  handleSendFollowup,
  handleGetSources,
  handleGetMarketingSettings,
  handleSaveMarketingSettings,
  SOURCE_CATEGORIES,
};
