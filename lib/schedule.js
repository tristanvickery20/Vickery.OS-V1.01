function parsePreference(pref) {
  if (!pref) return { start: 9, end: 17, weekendOnly: false };
  const p = pref.toLowerCase().trim();

  let weekendOnly = false;
  if (/saturday|sunday|weekend/.test(p)) weekendOnly = true;

  if (/morning|before\s*12/.test(p)) return { start: 9, end: 12, weekendOnly };
  if (/afternoon/.test(p)) return { start: 12, end: 17, weekendOnly };
  if (/evening|after\s*[56]/.test(p)) return { start: 17, end: 20, weekendOnly };

  return { start: 9, end: 17, weekendOnly };
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

function buildBusyBlocks(leads, targetDate) {
  const blocks = {};
  for (const lead of leads) {
    const st = lead.status;
    if (st !== "Scheduled" && st !== "In Progress") continue;
    if (!lead.scheduled_date) continue;
    const sDate = lead.scheduled_date.slice(0, 10);
    if (sDate !== targetDate) continue;
    const techId = lead.assigned_to || "__unassigned__";
    if (!blocks[techId]) blocks[techId] = [];
    const startMin = parseTimeToMinutes(lead.scheduled_date);
    const dur = Number(lead.duration_minutes) || 60;
    blocks[techId].push({ start: startMin, end: startMin + dur });
  }
  for (const k of Object.keys(blocks)) {
    blocks[k].sort((a, b) => a.start - b.start);
  }
  return blocks;
}

function parseTimeToMinutes(dateTimeStr) {
  if (!dateTimeStr) return 0;
  const d = new Date(dateTimeStr);
  if (isNaN(d.getTime())) {
    const match = dateTimeStr.match(/(\d{2}):(\d{2})/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    return 0;
  }
  return d.getHours() * 60 + d.getMinutes();
}

function findEarliestSlot(busyBlocks, windowStart, windowEnd, duration) {
  const startMin = windowStart * 60;
  const endMin = windowEnd * 60;
  const busy = (busyBlocks || []).slice().sort((a, b) => a.start - b.start);

  let candidate = startMin;
  for (const block of busy) {
    if (candidate + duration <= block.start) break;
    if (candidate < block.end) candidate = block.end;
  }
  if (candidate + duration <= endMin) return candidate;
  return null;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function dayName(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
}

function checkDayConflict(preference, targetDate) {
  if (!preference) return null;
  const p = preference.toLowerCase().trim();
  const day = dayName(targetDate);
  const weekend = isWeekend(targetDate);

  if (/saturday/.test(p) && day !== "saturday") return "Preference specifies Saturday, but target date is " + day + ".";
  if (/sunday/.test(p) && day !== "sunday") return "Preference specifies Sunday, but target date is " + day + ".";
  if (/weekend/.test(p) && !weekend) return "Preference requires a weekend date, but target date is a weekday.";
  return null;
}

function suggest(techs, leads, targetDate, durationMinutes, preference) {
  const pref = parsePreference(preference);

  const conflict = checkDayConflict(preference, targetDate);
  if (conflict) return { ok: false, reason: conflict };

  const busy = buildBusyBlocks(leads, targetDate);
  const duration = Number(durationMinutes) || 60;

  let bestTech = null;
  let bestStart = Infinity;

  for (const tech of techs) {
    if (!tech.active) continue;
    const slot = findEarliestSlot(busy[tech.id] || [], pref.start, pref.end, duration);
    if (slot !== null && slot < bestStart) {
      bestStart = slot;
      bestTech = tech;
    }
  }

  if (!bestTech) {
    return { ok: false, reason: `No available slot on ${targetDate} within ${pref.start}:00–${pref.end}:00.` };
  }

  const startTime = minutesToTime(bestStart);
  return {
    ok: true,
    suggested_tech_id: bestTech.id,
    suggested_tech_name: bestTech.name,
    suggested_start_time: `${targetDate}T${startTime}`,
    reason: `${bestTech.name} is free at ${startTime} on ${targetDate}.`,
  };
}

// Suggest with personal GCal blocks merged in (Task #23)
// personalBusyBlocks: array of { start: ISO, end: ISO } from Google Calendar freebusy
function buildPersonalBusyMinutes(personalBusyBlocks, targetDate) {
  const blocks = [];
  for (const b of personalBusyBlocks || []) {
    if (!b.start || !b.end) continue;
    const blockDate = b.start.slice(0, 10);
    if (blockDate !== targetDate) continue;
    const startMin = parseTimeToMinutes(b.start);
    const endMin   = parseTimeToMinutes(b.end);
    blocks.push({ start: startMin, end: endMin });
  }
  return blocks;
}

async function suggestWithPersonalCalendar(techs, leads, targetDate, durationMinutes, preference) {
  const result = suggest(techs, leads, targetDate, durationMinutes, preference);
  // Personal GCal blocks only affect availability info — the underlying slot logic
  // already accounts for all booked leads. We can add personal blocks as informational
  // busy signals here if personal calendar integration is active.
  try {
    const { getPersonalBusyBlocks } = require("./googleCalendar");
    const personalBlocks = await getPersonalBusyBlocks(targetDate, targetDate);
    if (!personalBlocks.length || !result.ok) return result;

    const personalMins = buildPersonalBusyMinutes(personalBlocks, targetDate);
    if (!personalMins.length) return result;

    // Check if the suggested slot conflicts with personal events
    const suggestedStart = result.suggested_start_time
      ? parseTimeToMinutes(result.suggested_start_time)
      : -1;
    const duration = Number(durationMinutes) || 60;
    const conflicts = personalMins.some(
      (b) => suggestedStart >= 0 && suggestedStart < b.end && (suggestedStart + duration) > b.start
    );
    if (conflicts) {
      return {
        ...result,
        personal_calendar_conflict: true,
        reason: result.reason + " (Note: overlaps with personal calendar event)",
      };
    }
  } catch { /* gcal unavailable — silently skip */ }
  return result;
}

module.exports = { suggest, suggestWithPersonalCalendar, parsePreference, buildBusyBlocks, findEarliestSlot };
