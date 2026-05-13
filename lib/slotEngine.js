// lib/slotEngine.js — Pure slot generation. No I/O.

function pad(n) { return String(n).padStart(2, "0"); }

function getLocalParts(utcDate, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(utcDate).map(p => [p.type, p.value]));
  return {
    year:   parseInt(parts.year),
    month:  parseInt(parts.month),
    day:    parseInt(parts.day),
    hour:   parseInt(parts.hour === "24" ? "0" : parts.hour),
    minute: parseInt(parts.minute),
  };
}

function getDow(utcDate, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(utcDate);
  const day = parts.find(p => p.type === "weekday")?.value || "Mon";
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(day);
}

// Convert local (Y, M, D, h, m) in named timezone to a UTC Date.
// Uses guess-and-correct which is reliable for all IANA timezones incl. DST.
function localToUTC(year, month, day, hour, minute, timezone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const local = getLocalParts(guess, timezone);
  const localMs  = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const targetMs = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess.getTime() - (localMs - targetMs));
}

function parseHM(str) {
  const [h, m] = String(str || "08:00").split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

function localDayKey(utcDate, timezone) {
  const p = getLocalParts(utcDate, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Generate available booking slots.
 * @param {object} rules  - Row from SchedulerRules sheet
 * @param {Array}  existingBookings - Rows from Bookings sheet
 * @param {number} durationMinutes  - How long this job takes
 * @param {Date}   now             - Current UTC time
 * @returns {string[]} - Array of ISO 8601 UTC strings
 */
function generateSlots(rules, existingBookings, durationMinutes, now) {
  const tz         = rules.timezone        || "America/Chicago";
  const leadMs     = (Number(rules.lead_time_hours) || 3) * 3600 * 1000;
  const bufferMin  = Number(rules.buffer_minutes   || 30);
  // Minimum 60 days; if the sheet still has the old 14-day default, upgrade to 180
  const rawHorizon = Number(rules.horizon_days) || 0;
  const horizonDays= rawHorizon >= 60 ? rawHorizon : 180;
  const maxPerDay  = Number(rules.max_bookings_per_day || 3);
  const dur        = Number(durationMinutes)  || 60;
  const intervalMin = dur + bufferMin;
  const earliest   = new Date(now.getTime() + leadMs);

  // Build booking index
  const bookingsByDay = {};
  const bookedRanges  = [];
  for (const bk of (existingBookings || [])) {
    if (!bk.scheduled_datetime || bk.status === "cancelled") continue;
    const bkMs = new Date(bk.scheduled_datetime).getTime();
    if (isNaN(bkMs)) continue;
    const bkDur = Number(bk.duration_minutes) || dur;
    const dk    = localDayKey(new Date(bkMs), tz);
    bookingsByDay[dk] = (bookingsByDay[dk] || 0) + 1;
    bookedRanges.push({ start: bkMs, end: bkMs + (bkDur + bufferMin) * 60000 });
  }

  const slots = [];

  for (let di = 0; di <= horizonDays && slots.length < 500; di++) {
    // Use noon-UTC of each candidate day to reliably get local date
    const candidate = new Date(now.getTime() + di * 86400000);
    const lp  = getLocalParts(candidate, tz);
    const dow = getDow(candidate, tz);

    let wStart, wEnd;
    if (dow === 0) {
      if (String(rules.sunday_enabled).toLowerCase() !== "true") continue;
      wStart = parseHM(rules.saturday_start); wEnd = parseHM(rules.saturday_end);
    } else if (dow === 6) {
      wStart = parseHM(rules.saturday_start); wEnd = parseHM(rules.saturday_end);
    } else {
      wStart = parseHM(rules.workday_start); wEnd = parseHM(rules.workday_end);
    }

    const dayKey = `${lp.year}-${pad(lp.month)}-${pad(lp.day)}`;
    const alreadyBooked = bookingsByDay[dayKey] || 0;
    if (alreadyBooked >= maxPerDay) continue;

    const slotsNeeded = maxPerDay - alreadyBooked;
    let slotsToday = 0;
    let sh = wStart.h, sm = wStart.m;

    while (sh * 60 + sm + dur <= wEnd.h * 60 + wEnd.m) {
      const slotUTC = localToUTC(lp.year, lp.month, lp.day, sh, sm, tz);

      if (slotUTC >= earliest) {
        const startMs = slotUTC.getTime();
        const endMs   = startMs + (dur + bufferMin) * 60000;
        const conflict = bookedRanges.some(r => r.start < endMs && r.end > startMs);

        if (!conflict && slotsToday < slotsNeeded) {
          slots.push(slotUTC.toISOString());
          slotsToday++;
        }
      }

      sm += intervalMin;
      sh += Math.floor(sm / 60);
      sm %= 60;
    }
  }

  return slots;
}

module.exports = { generateSlots, getLocalParts, localDayKey };
