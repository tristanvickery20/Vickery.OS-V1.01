// api/site-visit-book.js
// POST /api/quote/site-visit-book
//
// Books a free site-visit estimate into the crew calendar.
// Does NOT require a locked QuoteSnapshot — creates its own Lead + Booking rows.
//
// Body: { name, phone, address, service_id, service_name, block, date, quote_id? }
//
// Response: { ok, booking_id, lead_id, date, block, window_label, display, start_iso }

const crypto = require("crypto");
const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");
const {
  getBlockCapacityMins,
  getBlockUsedMins,
  MIN_BOOKING_MINS,
} = require("../lib/schedulerCapacity");
const { sendSms } = require("../lib/sms");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

const SITE_VISIT_MINS = 30;

const WINDOW_LABELS = {
  Morning:   "8 AM – 12 PM",
  Afternoon: "1 PM – 5 PM",
};

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

function nowIso() { return new Date().toISOString(); }

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function blockStartIso(dateStr, block, tz) {
  const timeStr = block === "Morning" ? "08:00" : "13:00";
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mn]   = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, mn, 0));
  const fmt   = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(guess);
  const lh    = Number(parts.find(p => p.type === "hour")?.value   || h);
  const lm    = Number(parts.find(p => p.type === "minute")?.value || mn);
  const diff  = ((h - lh) * 60 + (mn - lm)) * 60000;
  return new Date(guess.getTime() + diff).toISOString();
}

async function handleSiteVisitBook(req, res) {
  try {
    const body = await parseBody(req);
    const { name, phone, address, service_id, service_name, block, date, quote_id, email, lead_source } = body;

    if (!name    || !String(name).trim())    return json(res, 400, { ok: false, error: "name required" });
    if (!phone   || !String(phone).trim())   return json(res, 400, { ok: false, error: "phone required" });
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.length < 10)              return json(res, 400, { ok: false, error: "Please enter a valid phone number" });
    if (!address || !String(address).trim()) return json(res, 400, { ok: false, error: "address required" });
    if (!block   || (block !== "Morning" && block !== "Afternoon"))
      return json(res, 400, { ok: false, error: "block required (Morning or Afternoon)" });
    if (!date    || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return json(res, 400, { ok: false, error: "date required (YYYY-MM-DD)" });

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    await Promise.all([
      ensureTabHeaders("Bookings"),
      ensureTabHeaders("Leads"),
    ]);

    const [rulesRes, bookingsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:O3" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:P" }),
    ]);

    const rulesRows    = rulesRes.data.values || [];
    const rulesHeaders = rulesRows[0] || [];
    const rulesData    = rulesRows[1] || [];
    const rules = Object.fromEntries(rulesHeaders.map((h, i) => [h, rulesData[i] || ""]));
    const tz    = rules.timezone || "America/Chicago";

    const existingBookings = rowsToObjects(bookingsRes.data.values || []);

    const capMins   = getBlockCapacityMins(rules);
    const usedMins  = getBlockUsedMins(existingBookings, date, block, tz);
    const availMins = capMins - usedMins;

    if (availMins < MIN_BOOKING_MINS) {
      return json(res, 409, {
        ok:    false,
        error: `The ${block} block on ${date} is now fully booked. Please pick a different time.`,
      });
    }

    const now         = nowIso();
    const bookingId   = newId("BK");
    const leadId      = newId("LEAD");
    const startIso    = blockStartIso(date, block, tz);
    const windowLabel = WINDOW_LABELS[block] || "";
    const displayStr  = `${block} — ${windowLabel}`;
    const allocMins   = Math.min(SITE_VISIT_MINS, availMins);

    // ── Write Booking row ──────────────────────────────────────────────────────
    await sheets.spreadsheets.values.append({
      spreadsheetId: id, range: "Bookings!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [[
        bookingId,
        leadId,
        now,
        startIso,
        SITE_VISIT_MINS,
        String(address).trim(),
        String(name).trim(),
        "confirmed",
        block,
        service_id || "SITE_VISIT",
        "",
        cleanPhone,
        "",
        allocMins,
        "",
        "",
      ]]},
    });

    // ── Write Lead row matching sheet schema ───────────────────────────────────
    const leadsRes = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Leads!A1:Z1" });
    const leadHeaders = (leadsRes.data.values || [[]])[0] || [];

    const leadFields = {
      id:             leadId,
      created_at:     now,
      name:           String(name).trim(),
      phone:          cleanPhone,
      email:          String(email || "").trim(),
      job_type:       service_id || "",
      status:         "Site Visit Scheduled",
      lead_type:      "site_visit",
      notes:          [
        service_name  ? `Service: ${service_name}` : "",
        `Address: ${String(address).trim()}`,
        `Booked: ${block} ${date} (${windowLabel})`,
        quote_id      ? `Quote session: ${quote_id}` : "",
      ].filter(Boolean).join(" | "),
      estimated_value:  "",
      lead_source:      lead_source || "Website",
      last_quote_id:    quote_id || "",
      scheduled_date:   startIso.slice(0, 16),
      schedule_window:  block,
    };

    const leadRow = leadHeaders.length
      ? leadHeaders.map(h => String(leadFields[h] ?? ""))
      : Object.values(leadFields).map(String);

    await sheets.spreadsheets.values.append({
      spreadsheetId: id, range: "Leads!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [leadRow] },
    });

    // ── SMS owner notification ─────────────────────────────────────────────────
    const ownerPhone = process.env.OWNER_PHONE;
    if (ownerPhone) {
      const svcLabel = service_name || service_id || "Unknown service";
      const msg = [
        `[Site Visit Booked] ${String(name).trim()} — ${cleanPhone}`,
        `Service: ${svcLabel}`,
        `Address: ${String(address).trim()}`,
        `${block} ${date} (${windowLabel})`,
        `Booking: ${bookingId}`,
      ].join("\n");
      sendSms(ownerPhone, msg).catch(err =>
        console.error("[site-visit-book] SMS error:", err.message)
      );
    }

    console.log(`[site-visit-book] Booked ${bookingId} lead=${leadId} block=${block} date=${date}`);

    json(res, 200, {
      ok:           true,
      booking_id:   bookingId,
      lead_id:      leadId,
      date,
      block,
      window_label: windowLabel,
      display:      displayStr,
      start_iso:    startIso,
    });
  } catch (err) {
    console.error("[site-visit-book]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleSiteVisitBook };
