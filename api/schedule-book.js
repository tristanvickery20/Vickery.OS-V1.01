// api/schedule-book.js
// POST /api/schedule/book
//
// Leads is the canonical lifecycle row.
// Bookings remains the scheduler/capacity table, and QuoteSnapshots remains an audit log.
// Every successful booking now mirrors the full schedule/snapshot state back into Leads.

const crypto = require("crypto");
const { getSheetsClient }  = require("../lib/sheets");
const { generateSlots }    = require("../lib/slotEngine");
const { ensureTabHeaders } = require("../lib/sheetsSchema");
const { mirrorBookingToLead } = require("../lib/leadLifecycle");

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

function buildBookingObject({ bookingId, quoteId, now, scheduledIso, durationMinutes, snapshot, block = "", allocatedMinutes = "", groupId = "", isContinuation = "" }) {
  return {
    booking_id: bookingId,
    quote_id: quoteId,
    created_at: now,
    scheduled_datetime: scheduledIso,
    duration_minutes: String(durationMinutes || ""),
    address: snapshot.address || "",
    customer_name: snapshot.customer_name || "",
    status: "confirmed",
    schedule_block: block,
    job_type_id: snapshot.job_type_id || "",
    final_price: snapshot.final_price || "",
    phone: snapshot.phone || "",
    email: snapshot.email || "",
    block_allocated_minutes: String(allocatedMinutes || ""),
    booking_group_id: groupId,
    is_continuation: isContinuation ? "true" : "",
  };
}

function bookingObjectToLegacyRow(b) {
  return [
    b.booking_id,
    b.quote_id,
    b.created_at,
    b.scheduled_datetime,
    b.duration_minutes,
    b.address,
    b.customer_name,
    b.status,
    b.schedule_block,
    b.job_type_id,
    b.final_price,
    b.phone,
    b.email,
    b.block_allocated_minutes,
    b.booking_group_id,
    b.is_continuation,
  ];
}

async function getRulesSnapshotsBookings(sheets, spreadsheetId) {
  const [rulesRes, snapshotsRes, bookingsRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "SchedulerRules!A1:O3" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:AZ" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
  ]);
  return { rulesRes, snapshotsRes, bookingsRes };
}

async function mirrorPrimaryBooking({ sheets, spreadsheetId, quoteId, snapshot, booking }) {
  try {
    return await mirrorBookingToLead({
      sheets,
      spreadsheetId,
      quoteId,
      snapshot,
      booking,
      desiredStatus: "Scheduled",
    });
  } catch (err) {
    console.error("[schedule-book] Lead lifecycle mirror failed:", err.message);
    return "";
  }
}

async function backfillLeadIdIntoBookings(sheets, spreadsheetId, bookingIds, leadId) {
  if (!leadId || !bookingIds.length) return;
  try {
    const bkHdrResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!1:1" });
    const bkHdrs = (bkHdrResp.data.values && bkHdrResp.data.values[0]) || [];
    const lidColIdx = bkHdrs.indexOf("lead_id");
    if (lidColIdx < 0) return;

    const allBkResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:A" });
    const allIds = (allBkResp.data.values || []).map(r => String(r[0] || "").trim());
    const colLetter = String.fromCharCode(65 + lidColIdx);
    for (const bookingId of bookingIds) {
      const rowNum = allIds.indexOf(bookingId);
      if (rowNum > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Bookings!${colLetter}${rowNum + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[leadId]] },
        });
      }
    }
  } catch (err) {
    console.warn("[schedule-book] lead_id backfill:", err.message);
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
    const id = SPREADSHEET_ID();

    await Promise.all([
      ensureTabHeaders("Bookings"),
      ensureTabHeaders("Leads"),
      ensureTabHeaders("QuoteSnapshots"),
    ]);

    const { rulesRes, snapshotsRes, bookingsRes } = await getRulesSnapshotsBookings(sheets, id);

    const rulesRows = rulesRes.data.values || [];
    const rulesHeaders = rulesRows[0] || [];
    const rulesData = rulesRows[1] || [];
    const rules = Object.fromEntries(rulesHeaders.map((h, i) => [h, rulesData[i] || ""]));
    const tz = rules.timezone || "America/Chicago";

    const snapshots = rowsToObjects(snapshotsRes.data.values || []);
    const snapshot = snapshots.filter(r => r.quote_id === quote_id && r.event_type === "locked").pop();
    if (!snapshot) {
      return json(res, 400, { ok: false, error: "No locked quote found. Lock your price first." });
    }

    const existingBookings = rowsToObjects(bookingsRes.data.values || []);
    const isBlockBooking = Boolean(block && (block === "Morning" || block === "Afternoon"));
    const bookingDate = date || toLocalDateStr(scheduled_datetime, tz) || slotDate.toISOString().slice(0, 10);

    if (!isBlockBooking) {
      const bookingsLegacy = rowsToObjects(
        (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:H" })).data.values || []
      );
      const durationLeg = getJobMinsFromSnapshot(snapshot);
      const availSlots = generateSlots(rules, bookingsLegacy, durationLeg, new Date());
      const isAvail = availSlots.some(s => Math.abs(new Date(s).getTime() - slotDate.getTime()) < 60000);
      if (!isAvail) {
        return json(res, 409, { ok: false, error: "That time slot is no longer available." });
      }

      const bookingId = newId("BK");
      const now = nowIso();
      const booking = buildBookingObject({
        bookingId,
        quoteId: quote_id,
        now,
        scheduledIso: slotDate.toISOString(),
        durationMinutes: durationLeg,
        snapshot,
        allocatedMinutes: durationLeg,
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: "Bookings!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [bookingObjectToLegacyRow(booking)] },
      });

      const leadId = await mirrorPrimaryBooking({ sheets, spreadsheetId: id, quoteId: quote_id, snapshot, booking });
      await backfillLeadIdIntoBookings(sheets, id, [bookingId], leadId);
      await _appendSnapshotEvent(sheets, id, newId("EV"), quote_id, snapshot, bookingId, now, leadId);

      console.log(`[schedule-book] Legacy booked ${bookingId} quote=${quote_id} lead=${leadId || ""}`);
      return json(res, 200, {
        ok: true,
        booking_id: bookingId,
        lead_id: leadId || "",
        scheduled_datetime: slotDate.toISOString(),
        schedule_block: null,
        window_label: null,
        duration_minutes: durationLeg,
        blocks_reserved: [],
        customer_name: snapshot.customer_name,
        address: snapshot.address,
        final_price: snapshot.final_price,
        quote_id,
      });
    }

    const jobMins = getJobMinsFromSnapshot(snapshot);
    const capMins = getBlockCapacityMins(rules);
    const leadHours = Number(rules.lead_time_hours) || 3;

    const reqBlockIso = blockStartIso(bookingDate, block, tz);
    const cutoffMs = Date.now() + leadHours * 3600000;
    if (new Date(reqBlockIso).getTime() < cutoffMs) {
      return json(res, 409, {
        ok: false,
        error: `That slot is within the ${leadHours}-hour advance booking window. Please choose a later date.`,
      });
    }

    const usedInStart = getBlockUsedMins(existingBookings, bookingDate, block, tz);
    const availInStart = capMins - usedInStart;
    if (availInStart < MIN_BOOKING_MINS) {
      return json(res, 409, {
        ok: false,
        error: `The ${block} block on ${bookingDate} is at capacity (${(availInStart / 60).toFixed(1)} hrs remaining). Please choose another.`,
      });
    }

    const segments = planMultiBlockBooking(jobMins, bookingDate, block, existingBookings, rules, tz);
    if (!segments || segments.length === 0) {
      return json(res, 409, { ok: false, error: "Unable to find available blocks for this job." });
    }

    const freshBookingsRes = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:Z" });
    const freshBookings = rowsToObjects(freshBookingsRes.data.values || []);
    const freshSegments = planMultiBlockBooking(jobMins, bookingDate, block, freshBookings, rules, tz);
    if (!freshSegments || freshSegments.length === 0) {
      return json(res, 409, { ok: false, error: "This slot just filled up. Please choose another time." });
    }

    for (const seg of freshSegments) {
      const freshUsed = getBlockUsedMins(freshBookings, seg.date, seg.block, tz);
      const freshAvail = capMins - freshUsed;
      if (freshAvail < seg.allocated_mins) {
        return json(res, 409, {
          ok: false,
          error: `This slot just filled up (${seg.date} ${seg.block}). Please choose another time.`,
        });
      }
    }

    const lockKeys = freshSegments.map(s => `${s.date}:${s.block}`);
    for (const lk of lockKeys) {
      if (_bookingLocks.has(lk)) {
        return json(res, 409, {
          ok: false,
          error: `This slot just filled up (${lk.replace(":", " ")}). Please choose another time.`,
        });
      }
    }
    for (const lk of lockKeys) _bookingLocks.add(lk);

    try {
      const groupId = newId("GRP");
      const now = nowIso();
      const primaryIso = blockStartIso(bookingDate, block, tz);

      const bookings = freshSegments.map((seg) => {
        const bookingId = newId("BK");
        const segStartIso = blockStartIso(seg.date, seg.block, tz);
        return buildBookingObject({
          bookingId,
          quoteId: quote_id,
          now,
          scheduledIso: segStartIso,
          durationMinutes: jobMins,
          snapshot,
          block: seg.block,
          allocatedMinutes: seg.allocated_mins,
          groupId,
          isContinuation: seg.is_continuation,
        });
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: "Bookings!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: bookings.map(bookingObjectToLegacyRow) },
      });

      const primaryBooking = {
        ...bookings[0],
        scheduled_datetime: primaryIso,
        schedule_block: block,
      };
      const leadId = await mirrorPrimaryBooking({
        sheets,
        spreadsheetId: id,
        quoteId: quote_id,
        snapshot,
        booking: primaryBooking,
      });

      await backfillLeadIdIntoBookings(sheets, id, bookings.map(b => b.booking_id), leadId);
      await _appendSnapshotEvent(sheets, id, newId("EV"), quote_id, snapshot, bookings[0].booking_id, now, leadId);

      const blocksReserved = freshSegments.map((seg, i) => ({
        date: seg.date,
        block: seg.block,
        window_label: WINDOW_LABELS[seg.block] || "",
        display: `${seg.block} — ${WINDOW_LABELS[seg.block] || ""}`,
        allocated_hrs: Math.round(seg.allocated_mins / 60 * 10) / 10,
        booking_id: bookings[i].booking_id,
        is_continuation: seg.is_continuation,
      }));

      const spansSummary = blocksReserved.length > 1
        ? blocksReserved.map(b => `${b.date} ${b.block}`).join(" → ")
        : `${bookingDate} ${block}`;

      console.log(`[schedule-book] Booked group=${groupId} quote=${quote_id} lead=${leadId || ""} job=${(jobMins/60).toFixed(1)}h spans: ${spansSummary}`);

      json(res, 200, {
        ok: true,
        booking_id: bookings[0].booking_id,
        lead_id: leadId || "",
        booking_group_id: groupId,
        scheduled_datetime: primaryIso,
        schedule_block: block,
        window_label: WINDOW_LABELS[block] || "",
        duration_minutes: jobMins,
        blocks_reserved: blocksReserved,
        multi_block: blocksReserved.length > 1,
        customer_name: snapshot.customer_name,
        address: snapshot.address,
        final_price: snapshot.final_price,
        quote_id,
      });
    } finally {
      for (const lk of lockKeys) _bookingLocks.delete(lk);
    }
  } catch (err) {
    console.error("[schedule-book]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function _appendSnapshotEvent(sheets, id, eventId, quote_id, snapshot, bookingId, now, leadId = "") {
  try {
    const snapRow = [
      eventId,
      quote_id,
      now,
      "booked",
      snapshot.job_type_id || "",
      snapshot.selected_options_json || "[]",
      snapshot.selected_addons_json || "[]",
      snapshot.total_hours || "",
      "",
      "",
      "",
      "",
      snapshot.final_price || "",
      "",
      snapshot.pricing_version || "1",
      "booked",
      snapshot.customer_name || "",
      snapshot.phone || "",
      snapshot.email || "",
      snapshot.address || "",
      bookingId,
      leadId || "",
      bookingId || "",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "QuoteSnapshots!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [snapRow] },
    });
  } catch (err) {
    console.error("[schedule-book/snapEvent]", err.message);
  }
}

module.exports = { handleBook };
