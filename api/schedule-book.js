// api/schedule-book.js
// POST /api/schedule/book
//
// Accepts either:
//   A) block-based booking (preferred):
//      { quote_id, block: "Morning"|"Afternoon", date: "YYYY-MM-DD",
//        scheduled_datetime: "<ISO start of block>" }
//   B) exact-time booking (legacy V1 / fallback):
//      { quote_id, scheduled_datetime: "<ISO>" }
//
// On success:
//   - Writes row to Bookings sheet (with schedule_block field)
//   - Appends "booked" event to QuoteSnapshots
//   - Updates the Lead's schedule_window + scheduled_date if a matching lead exists

const crypto = require("crypto");
const { getSheetsClient } = require("../lib/sheets");
const { generateSlots }   = require("../lib/slotEngine");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

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
async function resolveDuration(sheets, snapshot) {
  const DEFAULT = 90;

  if (String(snapshot.pricing_version || "").startsWith("v2")) {
    const hrs = Number(snapshot.total_hours);
    if (hrs > 0) return Math.max(60, Math.ceil((hrs * 60) / 30) * 30);
    return DEFAULT;
  }

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

// Block-based capacity check: count existing bookings for the given date + block.
async function validateBlockAvailability(sheets, rules, date, block) {
  const id = SPREADSHEET_ID();
  let bookingsRows;
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:M" });
    bookingsRows = rowsToObjects(r.data.values || []);
  } catch { bookingsRows = []; }

  const tz     = rules.timezone || "America/Chicago";
  const cap    = block === "Morning"
    ? Number(rules.morning_capacity   || 3)
    : Number(rules.afternoon_capacity || 3);

  // Count bookings for this date + block, excluding cancelled
  let count = 0;
  for (const bk of bookingsRows) {
    if (bk.status === "cancelled") continue;
    let bkDate = "", bkBlock = "";

    if (bk.schedule_block) {
      // New-style
      bkDate  = bk.scheduled_datetime?.slice(0, 10) || "";
      bkBlock = bk.schedule_block;
    } else if (bk.scheduled_datetime) {
      // Legacy: infer block from hour in timezone
      const dt  = new Date(bk.scheduled_datetime);
      if (isNaN(dt.getTime())) continue;
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
      const hr  = Number(fmt.format(dt));
      bkBlock   = hr < 13 ? "Morning" : "Afternoon";
      bkDate    = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(dt);
    }

    if (bkDate === date && bkBlock === block) count++;
  }

  return { available: count < cap, booked: count, capacity: cap };
}

// After booking, try to update the matching Lead's schedule_window + scheduled_date.
// Matching strategy: Leads.last_quote_id === quote_id (primary), or most recent email/phone match.
async function updateLeadSchedule(sheets, quote_id, date, block, startIso, snapshot) {
  try {
    const id = SPREADSHEET_ID();
    const leadsRes = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Leads!A1:Y2000" });
    const rows     = leadsRes.data.values || [];
    if (rows.length < 2) return;

    const headers  = rows[0];
    const lastQuoteIdx = headers.indexOf("last_quote_id");  // col index (may be 23)
    const schedDateIdx = headers.indexOf("scheduled_date"); // col 13
    const schedWinIdx  = headers.indexOf("schedule_window");// col 16
    const statusIdx    = headers.indexOf("status");         // col 8

    // Find row where last_quote_id matches
    let foundRowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (lastQuoteIdx >= 0 && String(row[lastQuoteIdx] || "").trim() === quote_id) {
        foundRowIdx = i;
        break;
      }
    }

    // Fallback: match by phone or email from snapshot
    if (foundRowIdx === -1 && snapshot) {
      const phoneIdx = headers.indexOf("phone");
      const emailIdx = headers.indexOf("email");
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const ph  = String(row[phoneIdx] || "").replace(/\D/g, "");
        const em  = String(row[emailIdx] || "").toLowerCase().trim();
        const sPh = String(snapshot.phone || "").replace(/\D/g, "");
        const sEm = String(snapshot.email || "").toLowerCase().trim();
        if ((sPh && ph === sPh) || (sEm && em === sEm)) {
          foundRowIdx = i;
          break;
        }
      }
    }

    if (foundRowIdx === -1) {
      console.log(`[schedule-book] No matching Lead for quote_id=${quote_id} — schedule_window not updated.`);
      return;
    }

    const row = [...(rows[foundRowIdx] || [])];
    while (row.length < Math.max(schedDateIdx, schedWinIdx, statusIdx) + 1) row.push("");

    if (schedDateIdx >= 0) row[schedDateIdx] = startIso.slice(0, 16); // store as datetime
    if (schedWinIdx  >= 0) row[schedWinIdx]  = block;
    if (statusIdx    >= 0 && row[statusIdx] !== "Scheduled") row[statusIdx] = "Scheduled";

    const sheetRow = foundRowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `Leads!A${sheetRow}:Y${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row.slice(0, 25)] },
    });
    console.log(`[schedule-book] Lead row ${sheetRow} updated: schedule_window=${block} scheduled_date=${startIso.slice(0,16)} status=Scheduled`);
  } catch (err) {
    console.error("[schedule-book/updateLead]", err.message);
    // Non-fatal — booking still succeeded
  }
}

async function handleBook(req, res) {
  try {
    const body = await parseBody(req);
    const { quote_id, scheduled_datetime, block, date } = body;

    if (!quote_id)           return json(res, 400, { ok: false, error: "quote_id required" });
    if (!scheduled_datetime) return json(res, 400, { ok: false, error: "scheduled_datetime required" });

    const slotDate = new Date(scheduled_datetime);
    if (isNaN(slotDate.getTime())) {
      return json(res, 400, { ok: false, error: "Invalid scheduled_datetime" });
    }

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    // Ensure Bookings has new columns
    await ensureTabHeaders("Bookings");

    const [rulesRes, snapshotsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:N3" }),
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

    // Determine booking date and block
    const isBlockBooking = Boolean(block && (block === "Morning" || block === "Afternoon"));
    const bookingDate    = date || scheduled_datetime.slice(0, 10);
    const resolvedBlock  = isBlockBooking ? block : null;

    if (isBlockBooking) {
      // Block-based availability check (server-side revalidation)
      const avail = await validateBlockAvailability(sheets, rules, bookingDate, block);
      if (!avail.available) {
        return json(res, 409, { ok: false, error: `The ${block} block on ${bookingDate} is fully booked. Please choose another.` });
      }
    } else {
      // Legacy exact-time: use original slot engine validation
      const bookingsRes2 = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:H" });
      const bookings       = rowsToObjects(bookingsRes2.data.values || []);
      const duration       = await resolveDuration(sheets, snapshot);
      const availableSlots = generateSlots(rules, bookings, duration, new Date());
      const slotIso        = slotDate.toISOString();
      const isAvailable    = availableSlots.some(
        s => Math.abs(new Date(s).getTime() - slotDate.getTime()) < 60000
      );
      if (!isAvailable) {
        return json(res, 409, { ok: false, error: "That time slot is no longer available. Please choose another." });
      }
    }

    const duration  = await resolveDuration(sheets, snapshot);
    const bookingId = newId("BK");
    const eventId   = newId("EV");
    const now       = nowIso();
    const slotIso   = slotDate.toISOString();

    // ── Write to Bookings (new 13-column row) ─────────────────────────────────
    // booking_id, quote_id, created_at, scheduled_datetime, duration_minutes,
    // address, customer_name, status,
    // schedule_block, job_type_id, final_price, phone, email
    const bookingRow = [
      bookingId,
      quote_id,
      now,
      slotIso,
      duration,
      snapshot.address         || "",
      snapshot.customer_name   || "",
      "confirmed",
      resolvedBlock            || "",
      snapshot.job_type_id     || "",
      snapshot.final_price     || "",
      snapshot.phone           || "",
      snapshot.email           || "",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "Bookings!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [bookingRow] },
    });

    // ── Append "booked" event to QuoteSnapshots ───────────────────────────────
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

    // ── Update matching Lead (non-fatal) ──────────────────────────────────────
    if (isBlockBooking) {
      await updateLeadSchedule(sheets, quote_id, bookingDate, block, slotIso, snapshot);
    }

    console.log(`[schedule-book] Booked ${bookingId} quote=${quote_id} date=${bookingDate} block=${resolvedBlock || "exact-time"}`);

    json(res, 200, {
      ok:                 true,
      booking_id:         bookingId,
      scheduled_datetime: slotIso,
      schedule_block:     resolvedBlock,
      window_label:       resolvedBlock === "Morning" ? "8 AM – 12 PM" : resolvedBlock === "Afternoon" ? "1 PM – 5 PM" : null,
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
