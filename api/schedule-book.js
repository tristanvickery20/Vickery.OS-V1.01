// api/schedule-book.js
// POST /api/schedule/book

const crypto = require("crypto");
const { getSheetsClient } = require("../lib/sheets");
const { generateSlots }   = require("../lib/slotEngine");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

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

// Derive appointment duration from a locked snapshot.
// V2: use total_hours stored in snapshot.
// V1: look up JobTypes tab for default_duration_minutes.
async function resolveDuration(sheets, snapshot) {
  const DEFAULT = 90;

  // V2: snapshot has total_hours — compute duration from it
  if (String(snapshot.pricing_version || "").startsWith("v2")) {
    const hrs = Number(snapshot.total_hours);
    if (hrs > 0) {
      return Math.max(60, Math.ceil((hrs * 60) / 30) * 30);
    }
    return DEFAULT;
  }

  // V1: look up JobTypes tab
  try {
    const jobTypeRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "JobTypes!A:Z",
    });
    const jobTypes = rowsToObjects(jobTypeRes.data.values || []);
    const jt       = jobTypes.find(r => r.job_type_id === snapshot.job_type_id);
    if (jt?.default_duration_minutes) return Number(jt.default_duration_minutes) || DEFAULT;
  } catch { /* fall through */ }

  return DEFAULT;
}

async function handleBook(req, res) {
  try {
    const body = await parseBody(req);
    const { quote_id, scheduled_datetime } = body;

    if (!quote_id)           return json(res, 400, { ok: false, error: "quote_id required" });
    if (!scheduled_datetime) return json(res, 400, { ok: false, error: "scheduled_datetime required" });

    const slotDate = new Date(scheduled_datetime);
    if (isNaN(slotDate.getTime())) {
      return json(res, 400, { ok: false, error: "Invalid scheduled_datetime" });
    }

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    const [rulesRes, bookingsRes, snapshotsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:J3" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:H" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "QuoteSnapshots!A:U" }),
    ]);

    // Parse rules
    const rulesRows    = rulesRes.data.values || [];
    const rulesHeaders = rulesRows[0] || [];
    const rulesData    = rulesRows[1] || [];
    const rules = Object.fromEntries(rulesHeaders.map((h, i) => [h, rulesData[i] || ""]));

    // Find locked snapshot
    const snapshots = rowsToObjects(snapshotsRes.data.values || []);
    const snapshot  = snapshots.filter(r => r.quote_id === quote_id && r.event_type === "locked").pop();
    if (!snapshot) {
      return json(res, 400, { ok: false, error: "No locked quote found. Lock your price first." });
    }

    // Determine appointment duration
    const duration = await resolveDuration(sheets, snapshot);

    // Validate slot still available
    const bookings       = rowsToObjects(bookingsRes.data.values || []);
    const availableSlots = generateSlots(rules, bookings, duration, new Date());
    const slotIso        = slotDate.toISOString();
    const isAvailable    = availableSlots.some(
      s => Math.abs(new Date(s).getTime() - slotDate.getTime()) < 60000
    );

    if (!isAvailable) {
      return json(res, 409, { ok: false, error: "That time slot is no longer available. Please choose another." });
    }

    const bookingId = newId("BK");
    const eventId   = newId("EV");
    const now       = nowIso();

    // Write to Bookings
    const bookingRow = [
      bookingId,
      quote_id,
      now,
      slotIso,
      duration,
      snapshot.address       || "",
      snapshot.customer_name || "",
      "confirmed",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "Bookings!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [bookingRow] },
    });

    // Write to QuoteSnapshots
    const snapRow = [
      eventId, quote_id, now, "booked",
      snapshot.job_type_id            || "",
      snapshot.selected_options_json  || "[]",
      snapshot.selected_addons_json   || "[]",
      "", "", "", "", "",
      snapshot.final_price            || "",
      "", snapshot.pricing_version    || "1",
      "booked",
      snapshot.customer_name          || "",
      snapshot.phone                  || "",
      snapshot.email                  || "",
      snapshot.address                || "",
      bookingId,
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "QuoteSnapshots!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [snapRow] },
    });

    json(res, 200, {
      ok:                 true,
      booking_id:         bookingId,
      scheduled_datetime: slotIso,
      duration_minutes:   duration,
      customer_name:      snapshot.customer_name,
      address:            snapshot.address,
      final_price:        snapshot.final_price,
      quote_id,
    });
  } catch (err) {
    console.error("[schedule-book]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleBook };
