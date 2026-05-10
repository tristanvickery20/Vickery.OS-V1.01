// api/schedule-book.js
// POST /api/schedule/book
//
// Accepts block-based booking:
//   { quote_id, block: "Morning"|"Afternoon", date: "YYYY-MM-DD",
//     scheduled_datetime: "<ISO start of block>" }
//
// Crew-hours-aware multi-block logic:
//   1. Reads estimated job duration from the locked QuoteSnapshot (total_hours field)
//   2. Calls planMultiBlockBooking() to find consecutive block segments that fit the job
//   3. Writes one Bookings row per segment with block_allocated_minutes + booking_group_id
//   4. If job spans multiple blocks, all segments are returned in blocks_reserved[]
//
// Weekend bridging:
//   Friday Afternoon overflow → Monday Morning (Saturday/Sunday skipped automatically)
//
// On success:
//   - Writes booking row(s) to Bookings sheet
//   - Appends "booked" event to QuoteSnapshots
//   - Updates the Lead's schedule_window + scheduled_date

const crypto = require("crypto");
const { getSheetsClient }  = require("../lib/sheets");
const { generateSlots }    = require("../lib/slotEngine");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

// In-process booking lock — prevents two simultaneous requests from both
// passing the fresh-read check before either append executes.
// Key: "YYYY-MM-DD:Block" of the requested start block.
const _bookingLocks = new Set();
const {
  getBlockCapacityMins,
  getBlockUsedMins,
  planMultiBlockBooking,
  getJobMinsFromSnapshot,
  MIN_BOOKING_MINS,
} = require("../lib/schedulerCapacity");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

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

function toLocalDateStr(isoStr, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(isoStr));
  } catch {
    return String(isoStr || "").slice(0, 10);
  }
}

// Build the ISO start time for a block on a given date
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

// After booking, update the matching Lead record (non-fatal)
async function updateLeadSchedule(sheets, quote_id, date, block, startIso, snapshot) {
  try {
    const id       = SPREADSHEET_ID();
    const leadsRes = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Leads!A1:Y2000" });
    const rows     = leadsRes.data.values || [];
    if (rows.length < 2) return;

    const headers       = rows[0];
    const lastQuoteIdx  = headers.indexOf("last_quote_id");
    const schedDateIdx  = headers.indexOf("scheduled_date");
    const schedWinIdx   = headers.indexOf("schedule_window");
    const statusIdx     = headers.indexOf("status");

    let foundRowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (lastQuoteIdx >= 0 && String(rows[i][lastQuoteIdx] || "").trim() === quote_id) {
        foundRowIdx = i;
        break;
      }
    }

    // Fallback: match by phone or email
    if (foundRowIdx === -1 && snapshot) {
      const phoneIdx = headers.indexOf("phone");
      const emailIdx = headers.indexOf("email");
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const ph  = String(row[phoneIdx] || "").replace(/\D/g, "");
        const em  = String(row[emailIdx] || "").toLowerCase().trim();
        const sPh = String(snapshot.phone || "").replace(/\D/g, "");
        const sEm = String(snapshot.email || "").toLowerCase().trim();
        if ((sPh && ph === sPh) || (sEm && em === sEm)) { foundRowIdx = i; break; }
      }
    }

    if (foundRowIdx === -1) {
      console.log(`[schedule-book] No matching Lead for quote_id=${quote_id}`);
      return;
    }

    const row = [...(rows[foundRowIdx] || [])];
    while (row.length < Math.max(schedDateIdx, schedWinIdx, statusIdx) + 1) row.push("");
    if (schedDateIdx >= 0) row[schedDateIdx] = startIso.slice(0, 16);
    if (schedWinIdx  >= 0) row[schedWinIdx]  = block;
    if (statusIdx    >= 0 && row[statusIdx] !== "Scheduled") row[statusIdx] = "Scheduled";

    const sheetRow = foundRowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range:         `Leads!A${sheetRow}:Y${sheetRow}`,
      valueInputOption: "RAW",
      requestBody:   { majorDimension: "ROWS", values: [row.slice(0, 25)] },
    });
    console.log(`[schedule-book] Lead row ${sheetRow} updated: block=${block} date=${date} status=Scheduled`);
  } catch (err) {
    console.error("[schedule-book/updateLead]", err.message);
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

    await ensureTabHeaders("Bookings");

    const [rulesRes, snapshotsRes, bookingsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:O3" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "QuoteSnapshots!A:U" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:P" }),
    ]);

    // Parse rules
    const rulesRows    = rulesRes.data.values || [];
    const rulesHeaders = rulesRows[0] || [];
    const rulesData    = rulesRows[1] || [];
    const rules = Object.fromEntries(rulesHeaders.map((h, i) => [h, rulesData[i] || ""]));
    const tz    = rules.timezone || "America/Chicago";

    // Find locked snapshot
    const snapshots = rowsToObjects(snapshotsRes.data.values || []);
    const snapshot  = snapshots.filter(r => r.quote_id === quote_id && r.event_type === "locked").pop();
    if (!snapshot) {
      return json(res, 400, { ok: false, error: "No locked quote found. Lock your price first." });
    }

    // Existing bookings (for capacity math)
    const existingBookings = rowsToObjects(bookingsRes.data.values || []);

    const isBlockBooking = Boolean(block && (block === "Morning" || block === "Afternoon"));
    const bookingDate    = date || toLocalDateStr(scheduled_datetime, tz) || slotDate.toISOString().slice(0, 10);

    if (!isBlockBooking) {
      // ── Legacy exact-time path (no multi-block, no hours logic) ────────────
      const bookingsLegacy = rowsToObjects(
        (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:H" })).data.values || []
      );
      const durationLeg = getJobMinsFromSnapshot(snapshot);
      const availSlots  = generateSlots(rules, bookingsLegacy, durationLeg, new Date());
      const isAvail     = availSlots.some(s => Math.abs(new Date(s).getTime() - slotDate.getTime()) < 60000);
      if (!isAvail) {
        return json(res, 409, { ok: false, error: "That time slot is no longer available." });
      }
      // Write single legacy booking
      const bookingId = newId("BK");
      const eventId   = newId("EV");
      const now       = nowIso();
      await sheets.spreadsheets.values.append({
        spreadsheetId: id, range: "Bookings!A:A",
        valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [[
          bookingId, quote_id, now, slotDate.toISOString(), durationLeg,
          snapshot.address || "", snapshot.customer_name || "", "confirmed",
          "", snapshot.job_type_id || "", snapshot.final_price || "",
          snapshot.phone || "", snapshot.email || "",
          durationLeg, "", "",
        ]]},
      });
      await _appendSnapshotEvent(sheets, id, eventId, quote_id, snapshot, bookingId, now);
      console.log(`[schedule-book] Legacy booked ${bookingId} quote=${quote_id}`);
      return json(res, 200, {
        ok: true, booking_id: bookingId,
        scheduled_datetime: slotDate.toISOString(),
        schedule_block: null, window_label: null,
        duration_minutes: durationLeg, blocks_reserved: [],
        customer_name: snapshot.customer_name, address: snapshot.address,
        final_price: snapshot.final_price, quote_id,
      });
    }

    // ── Block-based path: hours-aware multi-block planning ───────────────────
    const jobMins  = getJobMinsFromSnapshot(snapshot);
    const capMins  = getBlockCapacityMins(rules);
    const leadHours = Number(rules.lead_time_hours) || 4;

    // Lead-time guard: reject if the requested block starts within the cutoff window
    const reqBlockIso = blockStartIso(bookingDate, block, tz);
    const cutoffMs    = Date.now() + leadHours * 3600000;
    if (new Date(reqBlockIso).getTime() < cutoffMs) {
      return json(res, 409, {
        ok:    false,
        error: `That slot is within the ${leadHours}-hour advance booking window. Please choose a later date.`,
      });
    }

    // Validate the requested start block has room
    const usedInStart   = getBlockUsedMins(existingBookings, bookingDate, block, tz);
    const availInStart  = capMins - usedInStart;
    if (availInStart < MIN_BOOKING_MINS) {
      return json(res, 409, {
        ok:    false,
        error: `The ${block} block on ${bookingDate} is at capacity (${(availInStart / 60).toFixed(1)} hrs remaining). Please choose another.`,
      });
    }

    // Plan the full booking (may span multiple blocks)
    const segments = planMultiBlockBooking(jobMins, bookingDate, block, existingBookings, rules, tz);
    if (!segments || segments.length === 0) {
      return json(res, 409, { ok: false, error: "Unable to find available blocks for this job." });
    }

    // ── Race-condition guard: re-read bookings fresh before writing ──────────
    // Two simultaneous requests could both see capacity and both proceed.
    // Re-reading and recomputing segments from fresh data closes the window.
    const freshBookingsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: id, range: "Bookings!A:P",
    });
    const freshBookings = rowsToObjects(freshBookingsRes.data.values || []);
    const freshSegments = planMultiBlockBooking(jobMins, bookingDate, block, freshBookings, rules, tz);
    if (!freshSegments || freshSegments.length === 0) {
      return json(res, 409, { ok: false, error: "This slot just filled up. Please choose another time." });
    }
    // Verify each planned segment still has enough room for its required allocation
    for (const seg of freshSegments) {
      const freshUsed  = getBlockUsedMins(freshBookings, seg.date, seg.block, tz);
      const freshAvail = capMins - freshUsed;
      if (freshAvail < seg.allocated_mins) {
        return json(res, 409, {
          ok:    false,
          error: `This slot just filled up (${seg.date} ${seg.block}). Please choose another time.`,
        });
      }
    }

    // Acquire in-process lock — block any concurrent request for the same start block
    const lockKey = `${bookingDate}:${block}`;
    if (_bookingLocks.has(lockKey)) {
      return json(res, 429, {
        ok:    false,
        error: "A booking for this slot is already in progress. Please wait a moment and try again.",
      });
    }
    _bookingLocks.add(lockKey);

    try {

    const groupId   = newId("GRP");
    const now       = nowIso();
    const primaryIso = blockStartIso(bookingDate, block, tz);

    // Write one Bookings row per segment (use freshSegments — fresh allocation amounts)
    const bookingRows = [];
    for (const seg of freshSegments) {
      const bookingId  = newId("BK");
      const segStartIso = blockStartIso(seg.date, seg.block, tz);
      bookingRows.push({
        id:  bookingId,
        row: [
          bookingId,
          quote_id,
          now,
          segStartIso,
          jobMins,                              // duration_minutes = total job (for display)
          snapshot.address         || "",
          snapshot.customer_name   || "",
          "confirmed",
          seg.block,
          snapshot.job_type_id     || "",
          snapshot.final_price     || "",
          snapshot.phone           || "",
          snapshot.email           || "",
          seg.allocated_mins,                   // block_allocated_minutes (hours engine)
          groupId,                              // booking_group_id
          seg.is_continuation ? "true" : "",   // is_continuation
        ],
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: id, range: "Bookings!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: bookingRows.map(b => b.row) },
    });

    // Append "booked" snapshot event (once, for the primary segment)
    const eventId = newId("EV");
    await _appendSnapshotEvent(sheets, id, eventId, quote_id, snapshot, bookingRows[0].id, now);

    // Update lead schedule to primary block
    await updateLeadSchedule(sheets, quote_id, bookingDate, block, primaryIso, snapshot);

    const blocksReserved = freshSegments.map((seg, i) => ({
      date:             seg.date,
      block:            seg.block,
      window_label:     WINDOW_LABELS[seg.block] || "",
      display:          `${seg.block} — ${WINDOW_LABELS[seg.block] || ""}`,
      allocated_hrs:    Math.round(seg.allocated_mins / 60 * 10) / 10,
      booking_id:       bookingRows[i].id,
      is_continuation:  seg.is_continuation,
    }));

    const spansSummary = blocksReserved.length > 1
      ? blocksReserved.map(b => `${b.date} ${b.block}`).join(" → ")
      : `${bookingDate} ${block}`;

    console.log(`[schedule-book] Booked group=${groupId} quote=${quote_id} job=${(jobMins/60).toFixed(1)}h spans: ${spansSummary}`);

    json(res, 200, {
      ok:                 true,
      booking_id:         bookingRows[0].id,
      booking_group_id:   groupId,
      scheduled_datetime: primaryIso,
      schedule_block:     block,
      window_label:       WINDOW_LABELS[block] || "",
      duration_minutes:   jobMins,
      blocks_reserved:    blocksReserved,
      multi_block:        blocksReserved.length > 1,
      customer_name:      snapshot.customer_name,
      address:            snapshot.address,
      final_price:        snapshot.final_price,
      quote_id,
    });

    } finally {
      _bookingLocks.delete(lockKey);
    }

  } catch (err) {
    console.error("[schedule-book]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Helper: write "booked" event to QuoteSnapshots ───────────────────────────
async function _appendSnapshotEvent(sheets, id, eventId, quote_id, snapshot, bookingId, now) {
  try {
    const snapRow = [
      eventId, quote_id, now, "booked",
      snapshot.job_type_id            || "",
      snapshot.selected_options_json  || "[]",
      snapshot.selected_addons_json   || "[]",
      snapshot.total_hours            || "",
      "", "", "", "",
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
      spreadsheetId: id, range: "QuoteSnapshots!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [snapRow] },
    });
  } catch (err) {
    console.error("[schedule-book/snapEvent]", err.message);
  }
}

module.exports = { handleBook };
