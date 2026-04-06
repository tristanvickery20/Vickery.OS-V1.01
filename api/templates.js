// api/templates.js — SMS/Email template library (backed by Templates sheet tab)
const { getSheetsClient } = require("../lib/sheets");

const TAB = "Templates";
const HEADERS = ["id", "created_at", "updated_at", "name", "channel", "category", "body", "active"];

const SEED_TEMPLATES = [
  {
    name: "Review Ask",
    channel: "SMS",
    category: "review_ask",
    body: "Hi {first_name}, thanks so much for choosing Vickery Electric for your {service}! A quick Google review means the world to us as a small local business: {review_link} Thank you! — Cody at Vickery Electric",
    active: "true",
  },
  {
    name: "Review Reminder",
    channel: "SMS",
    category: "review_reminder",
    body: "Hi {first_name}, just a friendly follow-up — if you enjoyed your experience with Vickery Electric, we'd really appreciate a quick Google review: {review_link} No pressure, and thank you! — Cody",
    active: "true",
  },
  {
    name: "Quote Follow-Up (24h)",
    channel: "SMS",
    category: "quote_followup",
    body: "Hi {first_name}, this is Cody from Vickery Electric — just checking in on the quote we sent for {service}. Happy to answer any questions or get you on the schedule!",
    active: "true",
  },
  {
    name: "Quote Follow-Up (7d)",
    channel: "SMS",
    category: "quote_followup",
    body: "Hi {first_name}, Vickery Electric here. We'd love to earn your business on that {service} estimate — let us know if you're still interested or if anything changed. No pressure!",
    active: "true",
  },
  {
    name: "Job Complete Thank-You",
    channel: "SMS",
    category: "job_complete_thankyou",
    body: "Hi {first_name}, thank you for having Vickery Electric out! It was a pleasure. If you ever need any electrical work, we're always here. — Cody",
    active: "true",
  },
  {
    name: "Reactivation (6 months)",
    channel: "SMS",
    category: "reactivation",
    body: "Hi {first_name}! It's been a while since we last worked together at Vickery Electric. If you have any electrical needs this season, we'd love to help. Give us a call anytime!",
    active: "true",
  },
  {
    name: "Referral Ask",
    channel: "SMS",
    category: "referral_ask",
    body: "Hi {first_name}, if you know anyone who needs a reliable electrician in the area, we'd truly appreciate the referral! Just have them mention your name. — Cody at Vickery Electric",
    active: "true",
  },
];

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

async function readAllTemplates(sheets, spreadsheetId) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A:H`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return { headers: rows[0] || HEADERS, rows: [] };
    const headers = rows[0].map(h => String(h || "").trim());
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
      return obj;
    });
    return { headers, rows: data };
  } catch {
    return { headers: HEADERS, rows: [] };
  }
}

async function ensureTemplatesSeeded(sheets, spreadsheetId) {
  const { headers, rows } = await readAllTemplates(sheets, spreadsheetId);
  if (rows.length > 0) return; // already seeded

  // Write header row first if empty
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${TAB}!1:1`,
  }).catch(() => ({ data: { values: [] } }));
  const existing = ((headerResp.data.values || [])[0] || []);
  if (!existing.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }

  const now = nowIso();
  const seedRows = SEED_TEMPLATES.map((t, i) => {
    const obj = {
      id: "TPL-" + String(i + 1).padStart(3, "0"),
      created_at: now, updated_at: now,
      name: t.name, channel: t.channel,
      category: t.category, body: t.body, active: t.active,
    };
    return HEADERS.map(h => obj[h] || "");
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${TAB}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: seedRows },
  });
  console.log("[Templates] Seeded", seedRows.length, "default templates");
}

async function handleGetTemplates(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    await ensureTemplatesSeeded(sheets, spreadsheetId);
    const { rows } = await readAllTemplates(sheets, spreadsheetId);
    const url = new URL(req.url, "http://x");
    const category = url.searchParams.get("category") || "";
    const channel = url.searchParams.get("channel") || "";
    let templates = rows;
    if (category) templates = templates.filter(t => t.category === category);
    if (channel)   templates = templates.filter(t => t.channel.toLowerCase() === channel.toLowerCase());
    json(res, 200, { ok: true, templates });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateTemplate(req, res) {
  try {
    const body = await readBody(req);
    const { name, channel, category, body: tmplBody } = body;
    if (!name || !category || !tmplBody) return json(res, 400, { ok: false, error: "name, category, body required" });

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    await ensureTemplatesSeeded(sheets, spreadsheetId);

    const { rows } = await readAllTemplates(sheets, spreadsheetId);
    const now = nowIso();
    const maxNum = rows.reduce((m, r) => {
      const n = Number((r.id || "").replace("TPL-", "")) || 0;
      return Math.max(m, n);
    }, rows.length);
    const id = "TPL-" + String(maxNum + 1).padStart(3, "0");

    const obj = { id, created_at: now, updated_at: now, name, channel: channel || "SMS", category, body: tmplBody, active: "true" };
    const row = HEADERS.map(h => obj[h] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `${TAB}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    json(res, 201, { ok: true, template: obj });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateTemplate(req, res, templateId) {
  try {
    const body = await readBody(req);
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB}!A:H`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 404, { ok: false, error: "Template not found" });

    const headers = rows[0].map(h => String(h || "").trim());
    const idIdx = headers.indexOf("id");

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx] || "").trim() === templateId) { rowIndex = i; break; }
    }
    if (rowIndex === -1) return json(res, 404, { ok: false, error: "Template not found" });

    const EDITABLE = ["name", "channel", "category", "body", "active"];
    const now = nowIso();
    const updates = [];
    const colLetter = c => String.fromCharCode(65 + c);

    for (const field of EDITABLE) {
      if (body[field] === undefined) continue;
      const ci = headers.indexOf(field);
      if (ci >= 0) updates.push({ range: `${TAB}!${colLetter(ci)}${rowIndex + 1}`, values: [[String(body[field])]] });
    }
    const uaCI = headers.indexOf("updated_at");
    if (uaCI >= 0) updates.push({ range: `${TAB}!${colLetter(uaCI)}${rowIndex + 1}`, values: [[now]] });

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetTemplates, handleCreateTemplate, handleUpdateTemplate };
