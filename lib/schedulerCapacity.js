// lib/schedulerCapacity.js
// Crew-hours-aware block capacity engine.
//
// Key concepts:
//   - Each block (Morning 8-12, Afternoon 1-5) = 4 hours of wall time
//   - crew_size workers → block_capacity = crew_size × 4 hrs crew-minutes
//   - Default: 2 crew × 240 min = 480 crew-minutes (8 crew-hrs) per block
//   - Jobs consume crew-minutes from a block based on estimated duration
//   - When a job exceeds one block's remaining capacity it spills into the
//     next consecutive block: Morning → Afternoon → next-day Morning (Mon-Fri)
//   - Weekend bridging: Friday Afternoon overflow → Monday Morning (no Saturday)

const BLOCK_DURATION_MINS = 4 * 60;  // 4-hour block = 240 min wall time
const DEFAULT_CREW_SIZE   = 2;
const MIN_BOOKING_MINS    = 60;       // minimum job size we'll place in a block

// ── Date helpers ─────────────────────────────────────────────────────────────

function parseDateStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function toLocalDateStr(isoStr, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(isoStr));
  } catch {
    return String(isoStr || "").slice(0, 10);
  }
}

function addDays(dateStr, n) {
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day + n, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

function getDow(dateStr) {
  const { year, month, day } = parseDateStr(dateStr);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay(); // 0=Sun, 6=Sat
}

// ── Block capacity math ───────────────────────────────────────────────────────

/**
 * getBlockCapacityMins(rules)
 * Returns total crew-minutes available per block, e.g. 2 crew × 240 min = 480.
 */
function getBlockCapacityMins(rules) {
  const crew = Math.max(1, Number(rules.crew_size || DEFAULT_CREW_SIZE));
  return crew * BLOCK_DURATION_MINS;
}

/**
 * getNextWorkingBlock(dateStr, block)
 * Returns { date, block } of the very next bookable block in sequence.
 *   Morning → same-day Afternoon
 *   Afternoon → next Mon–Fri Morning  (skips Sat, Sun)
 */
function getNextWorkingBlock(dateStr, block) {
  if (block === "Morning") {
    return { date: dateStr, block: "Afternoon" };
  }
  // Afternoon → next working-day Morning
  let next = addDays(dateStr, 1);
  for (let guard = 0; guard < 7; guard++) {
    const dow = getDow(next);
    if (dow !== 0 && dow !== 6) break; // Mon–Fri
    next = addDays(next, 1);
  }
  return { date: next, block: "Morning" };
}

/**
 * getBlockUsedMins(bookings, date, block, tz)
 * Sums time committed to a specific date+block across all non-cancelled bookings.
 * Uses block_allocated_minutes if present; falls back to duration_minutes.
 */
function getBlockUsedMins(bookings, date, block, tz) {
  let used = 0;
  for (const bk of bookings) {
    if (String(bk.status || "").toLowerCase() === "cancelled") continue;
    let bkDate = "", bkBlock = "";

    if (bk.schedule_block) {
      bkDate  = (bk.scheduled_datetime || "").slice(0, 10);
      bkBlock = bk.schedule_block;
    } else if (bk.scheduled_datetime) {
      const dt = new Date(bk.scheduled_datetime);
      if (isNaN(dt.getTime())) continue;
      bkDate  = toLocalDateStr(bk.scheduled_datetime, tz);
      const hr = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", hour12: false,
      }).format(dt));
      bkBlock = hr < 13 ? "Morning" : "Afternoon";
    }

    if (bkDate !== date || bkBlock !== block) continue;

    // block_allocated_minutes is precise (per-block share of a multi-block job)
    // duration_minutes is total job duration (used for legacy / single-block jobs)
    const allocated = Number(bk.block_allocated_minutes) || Number(bk.duration_minutes) || MIN_BOOKING_MINS;
    used += allocated;
  }
  return used;
}

/**
 * planMultiBlockBooking(jobMins, startDate, startBlock, bookings, rules, tz)
 *
 * Plans how a job is allocated across one or more consecutive blocks.
 * Returns an array of segments:
 *   [{ date, block, allocated_mins, is_continuation }, ...]
 *
 * - Segments are consecutive working blocks (no weekend gaps).
 * - Each segment uses only the remaining capacity in its block.
 * - Returns null if the job cannot be placed (e.g. start block full, guard hit).
 */
function planMultiBlockBooking(jobMins, startDate, startBlock, bookings, rules, tz) {
  const capMins  = getBlockCapacityMins(rules);
  const segments = [];
  let remaining  = Math.max(MIN_BOOKING_MINS, jobMins);
  let curDate    = startDate;
  let curBlock   = startBlock;
  let first      = true;

  for (let guard = 0; guard < 30 && remaining > 0; guard++) {
    const used      = getBlockUsedMins(bookings, curDate, curBlock, tz);
    const avail     = capMins - used;

    if (avail < MIN_BOOKING_MINS) {
      // Block is full or nearly full — skip to next
      const next = getNextWorkingBlock(curDate, curBlock);
      curDate  = next.date;
      curBlock = next.block;
      continue;
    }

    const allocate = Math.min(remaining, avail);
    segments.push({
      date:            curDate,
      block:           curBlock,
      allocated_mins:  allocate,
      is_continuation: !first,
    });
    remaining -= allocate;
    first      = false;

    if (remaining > 0) {
      const next = getNextWorkingBlock(curDate, curBlock);
      curDate  = next.date;
      curBlock = next.block;
    }
  }

  return segments.length > 0 ? segments : null;
}

/**
 * getJobMinsFromSnapshot(snapshot)
 * Extracts estimated job duration in minutes from a QuoteSnapshot row.
 * Priority: total_hours → snapshot_json.hours → default 90 min.
 */
function getJobMinsFromSnapshot(snapshot) {
  const DEFAULT_MINS = 90;
  if (!snapshot) return DEFAULT_MINS;

  // V2 QuoteSnapshots store total_hours directly
  const hrs = Number(snapshot.total_hours);
  if (hrs > 0) return Math.max(60, Math.ceil((hrs * 60) / 30) * 30);

  // Try snapshot_json (estimator V2 flow stores hours there)
  try {
    if (snapshot.snapshot_json) {
      const parsed = JSON.parse(snapshot.snapshot_json);
      const snHrs  = Number(parsed.hours || parsed.estimated_hours || parsed.total_hours);
      if (snHrs > 0) return Math.max(60, Math.ceil((snHrs * 60) / 30) * 30);
    }
  } catch { /* ignore */ }

  // Fall back to duration_minutes if stored from a previous booking
  const dm = Number(snapshot.duration_minutes);
  if (dm > 0) return dm;

  return DEFAULT_MINS;
}

/**
 * formatHours(mins) — e.g. 150 → "2.5 hrs"
 */
function formatHours(mins) {
  return (mins / 60).toFixed(1).replace(/\.0$/, "") + " hrs";
}

/**
 * hoursBar(usedMins, capMins, width) — simple ASCII-style load bar for logs.
 */
function hoursBar(usedMins, capMins, width = 12) {
  const pct   = Math.min(1, usedMins / capMins);
  const filled = Math.round(pct * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

module.exports = {
  getBlockCapacityMins,
  getBlockUsedMins,
  getNextWorkingBlock,
  planMultiBlockBooking,
  getJobMinsFromSnapshot,
  formatHours,
  hoursBar,
  BLOCK_DURATION_MINS,
  DEFAULT_CREW_SIZE,
  MIN_BOOKING_MINS,
};
