// api/referrals.js — Referral Center API
"use strict";

const crypto = require("crypto");
const { getSheetsClient } = require("../lib/sheets");
const { sendSms } = require("../lib/staff");
const { getConfig } = require("../lib/config");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

// ── Helpers ────────────────────────────────────────────────────────────────

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let b = "";
    req.on("data", c => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function norm(v) { return String(v || "").trim().toLowerCase(); }

function uid() {
  return "REF-" + Date.now().toString(36).toUpperCase() +
         "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function readTabRows(sheets, spreadsheetId, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:ZZ`,
    });
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

function cleanPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11) return "+" + d;
  return "";
}

// Column order matches SCHEMAS.ReferralLedger in sheetsSchema.js
const LEDGER_HEADERS = [
  "id", "created_at", "updated_at",
  "referrer_name", "referrer_phone", "referrer_type",
  "employee_id", "referral_slug",
  "referee_name", "referee_phone", "referee_city", "referee_job_type",
  "lead_id", "status",
  "reward_amount", "reward_status", "reward_paid_at", "reward_method",
  "notes", "notified_at", "source",
];

// ── GET /api/referrals ─────────────────────────────────────────────────────
async function handleGetReferrals(req, res) {
  try {
    await ensureTabHeaders("ReferralLedger").catch(() => {});
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;
    const { headers, rows } = await readTabRows(sheets, sid, "ReferralLedger");

    const all = rows
      .filter(r => r && String(r[0] || "").trim())
      .map(r => toObj(headers, r));

    const total       = all.length;
    const booked      = all.filter(r => ["booked","complete","rewarded"].includes(norm(r.status))).length;
    const rewardReady = all.filter(r => norm(r.reward_status) === "ready").length;
    const rewardPaid  = all.filter(r => norm(r.reward_status) === "paid").length;
    const totalPaid   = all.reduce((s, r) =>
      s + (norm(r.reward_status) === "paid" ? Number(r.reward_amount || 0) : 0), 0
    );

    json(res, 200, {
      ok: true,
      stats: {
        total,
        booked,
        conversion_pct: total ? Math.round(booked / total * 100) : 0,
        reward_ready:   rewardReady,
        reward_paid:    rewardPaid,
        total_paid:     totalPaid,
      },
      rows: all.sort((a, b) => (b.created_at > a.created_at ? 1 : -1)),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── POST /api/referrals — public, no auth ──────────────────────────────────
// Called from the upgraded /referral public page.
// Also writes a lead to Leads tab for backward-compatible CRM visibility.
async function handleCreateReferral(req, res) {
  try {
    // Ensure the tab exists (safe no-op if already present)
    await ensureTabHeaders("ReferralLedger").catch(() => {});

    const body = await readBody(req);

    const referrerName  = String(body.referrer_name  || body.your_name  || "").trim();
    const referrerPhone = String(body.referrer_phone || body.your_phone || "").trim();
    const refereeName   = String(body.referee_name   || body.ref_name   || "").trim();
    const refereePhone  = String(body.referee_phone  || body.ref_phone  || "").trim();
    const refereeCity   = String(body.referee_city   || body.ref_city   || "").trim();
    const refereeJob    = String(body.referee_job    || body.ref_job    || "").trim();
    const referralSlug  = String(body.referral_slug  || "").trim();
    const employeeId    = String(body.employee_id    || "").trim();
    const source        = String(body.source         || "public_form").trim();

    if (!referrerName || !referrerPhone || !refereeName || !refereePhone) {
      return json(res, 400, { ok: false, error: "Missing required fields." });
    }

    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;
    const now    = new Date().toISOString();
    const id     = uid();
    const referrerType = employeeId ? "employee" : "customer";

    // Write to ReferralLedger
    const row = LEDGER_HEADERS.map(h => {
      switch (h) {
        case "id":               return id;
        case "created_at":
        case "updated_at":       return now;
        case "referrer_name":    return referrerName;
        case "referrer_phone":   return referrerPhone;
        case "referrer_type":    return referrerType;
        case "employee_id":      return employeeId;
        case "referral_slug":    return referralSlug;
        case "referee_name":     return refereeName;
        case "referee_phone":    return refereePhone;
        case "referee_city":     return refereeCity;
        case "referee_job_type": return refereeJob;
        case "status":           return "new";
        case "reward_status":    return "pending";
        case "reward_amount":    return "50";
        case "source":           return source;
        default:                 return "";
      }
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sid,
      range:            "ReferralLedger!A:U",
      valueInputOption: "RAW",
      requestBody:      { values: [row] },
    });

    // Also write a lead for CRM pipeline visibility (legacy path preserved)
    const nowShort  = now.slice(0, 16).replace("T", " ");
    const leadNotes = referrerName + " (" + referrerPhone + ")";
    const leadRow   = [
      nowShort, refereeName, refereePhone, refereeCity, refereeJob,
      "Referral", leadNotes, "", "New",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: sid,
      range:            "Leads!A:I",
      valueInputOption: "USER_ENTERED",
      requestBody:      { values: [leadRow] },
    });

    json(res, 200, { ok: true, id });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── PATCH /api/referrals/:id ───────────────────────────────────────────────
async function handleUpdateReferral(req, res, referralId) {
  try {
    const body   = await readBody(req);
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: "ReferralLedger!A:ZZ",
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 404, { ok: false, error: "Not found" });

    const headers = rows[0].map(h => String(h || "").trim());
    const idIdx   = headers.indexOf("id");
    const updIdx  = headers.indexOf("updated_at");

    const ALLOWED = [
      "status", "reward_amount", "reward_status",
      "reward_paid_at", "reward_method", "notes", "lead_id", "notified_at",
    ];

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx] || "") !== referralId) continue;

      const updated = [...rows[i]];
      while (updated.length < headers.length) updated.push("");

      for (const [k, v] of Object.entries(body)) {
        if (!ALLOWED.includes(k)) continue;
        const idx = headers.indexOf(k);
        if (idx >= 0) updated[idx] = String(v == null ? "" : v);
      }
      if (updIdx >= 0) updated[updIdx] = new Date().toISOString();

      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range:            `ReferralLedger!A${i + 1}`,
        valueInputOption: "RAW",
        requestBody:      { values: [updated] },
      });
      return json(res, 200, { ok: true });
    }

    json(res, 404, { ok: false, error: "Referral not found" });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── GET /api/referrals/employees ───────────────────────────────────────────
async function handleGetReferralEmployees(req, res) {
  try {
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: "Staff!A:Z",
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, employees: [] });

    const headers   = rows[0];
    const employees = rows.slice(1)
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = String(r[i] || "").trim(); });
        return obj;
      })
      .filter(e => e.staff_id && e.status !== "inactive")
      .map(e => ({
        staff_id: e.staff_id,
        name:     [e.first_name, e.last_name].filter(Boolean).join(" "),
        role:     e.role || "crew",
      }));

    json(res, 200, { ok: true, employees });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── POST /api/referrals/:id/notify ─────────────────────────────────────────
async function handleNotifyReferrer(req, res, referralId) {
  try {
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;

    const { headers, rows } = await readTabRows(sheets, sid, "ReferralLedger");
    const idIdx = headers.indexOf("id");
    const rawRow = rows.find(r => String(r[idIdx] || "") === referralId);
    if (!rawRow) return json(res, 404, { ok: false, error: "Not found" });

    const entry    = toObj(headers, rawRow);
    const phone    = cleanPhone(entry.referrer_phone);
    if (!phone) return json(res, 400, { ok: false, error: "No valid referrer phone" });

    const firstName  = firstN(entry.referrer_name);
    const refereeName = entry.referee_name || "your referral";
    const rewardAmt  = entry.reward_amount || "50";

    const smsBody = `Hi ${firstName} — great news! ${refereeName}'s job with Vickery Electric is complete. Your referral reward of $${rewardAmt} is ready. We'll be in touch shortly to arrange delivery!`;

    const smsSent = await sendSms(phone, smsBody);
    const now = new Date().toISOString();

    // Stamp notified_at on the ledger row
    await _patchLedgerRow(sheets, sid, referralId, { notified_at: now });

    json(res, 200, { ok: true, sms_sent: smsSent });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function _patchLedgerRow(sheets, sid, referralId, updates) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: "ReferralLedger!A:ZZ",
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return;
  const headers = rows[0].map(h => String(h || "").trim());
  const idIdx   = headers.indexOf("id");
  const updIdx  = headers.indexOf("updated_at");
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx] || "") !== referralId) continue;
    const updated = [...rows[i]];
    while (updated.length < headers.length) updated.push("");
    for (const [k, v] of Object.entries(updates)) {
      const idx = headers.indexOf(k);
      if (idx >= 0) updated[idx] = String(v == null ? "" : v);
    }
    if (updIdx >= 0) updated[updIdx] = new Date().toISOString();
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range:            `ReferralLedger!A${i + 1}`,
      valueInputOption: "RAW",
      requestBody:      { values: [updated] },
    });
    return;
  }
}

// ── Template seeding (called once at startup) ──────────────────────────────
const REFERRAL_TEMPLATE_SEEDS = [
  {
    name:     "Referral Soft Ask",
    category: "referral_soft_ask",
    channel:  "SMS",
    body:     "Hi {first_name}, thanks for choosing Vickery Electric! If you know anyone who needs electrical work in Southeast Texas, we'd love the referral. Just have them mention your name and we'll take great care of them.",
  },
  {
    name:     "Referral — New Referrer Notice",
    category: "referral_new_referrer_notice",
    channel:  "SMS",
    body:     "Hi {first_name} — {referee_name} just reached out to us and mentioned your name. We'll take good care of them. Thank you for sending them our way!",
  },
  {
    name:     "Referral Reward Ready",
    category: "referral_reward_ready",
    channel:  "SMS",
    body:     "Hi {first_name} — great news! {referee_name}'s job is complete. Your referral reward of ${reward_amount} is ready. We'll be in touch shortly to arrange delivery!",
  },
  {
    name:     "Referral Reward Paid Confirmation",
    category: "referral_paid_confirmation",
    channel:  "SMS",
    body:     "Hi {first_name}, your referral reward has been sent. Thanks again for sending {referee_name} our way — we really appreciate it!",
  },
];

async function seedReferralTemplates() {
  try {
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;
    if (!sid) return;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sid,
      range: "Templates!A:H",
    });
    const rows = resp.data.values || [];
    if (rows.length < 1) return;

    const headers    = rows[0].map(h => String(h || "").trim());
    const catIdx     = headers.indexOf("category");
    const existingCats = new Set(
      rows.slice(1).map(r => String(r[catIdx] || "").trim())
    );

    const missing = REFERRAL_TEMPLATE_SEEDS.filter(t => !existingCats.has(t.category));
    if (!missing.length) return;

    const now = new Date().toISOString();
    for (const t of missing) {
      const id  = "TMPL-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const row = headers.map(h => {
        switch (h) {
          case "id":          return id;
          case "created_at":
          case "updated_at":  return now;
          case "name":        return t.name;
          case "channel":     return t.channel;
          case "category":    return t.category;
          case "body":        return t.body;
          case "active":      return "true";
          default:            return "";
        }
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId: sid,
        range:            "Templates!A:H",
        valueInputOption: "RAW",
        requestBody:      { values: [row] },
      });
    }
    console.log(`[referrals] Seeded ${missing.length} referral template(s).`);
  } catch (err) {
    console.error("[referrals/seedTemplates]", err.message);
  }
}

module.exports = {
  handleGetReferrals,
  handleCreateReferral,
  handleUpdateReferral,
  handleGetReferralEmployees,
  handleNotifyReferrer,
  seedReferralTemplates,
};
