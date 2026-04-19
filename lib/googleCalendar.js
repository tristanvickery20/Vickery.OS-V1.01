// lib/googleCalendar.js — Google Calendar API integration for Vickery Electric CRM
// Three calendars: Vickery Jobs (jobs/estimates), Vickery Internal (meetings/tasks),
// Personal (owner's personal cal, read-only for availability blocking).
//
// Setup required in Google Cloud Console:
//   1. Enable "Google Calendar API" in the project tied to GOOGLE_SERVICE_ACCOUNT_JSON
//   2. The service account automatically owns the Vickery Jobs & Internal calendars.
//      Share them with the owner's Google account for iPhone visibility.
//   3. For Personal calendar, the owner shares their calendar with the service account email,
//      then sets the Personal Calendar ID in CRM Settings (/crm/settings?tab=gcal).

const { google } = require("googleapis");
const { getSheetsClient } = require("./sheets");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

const CAL_JOBS     = "Vickery Jobs";
const CAL_INTERNAL = "Vickery Internal";

const CFG_JOBS_ID       = "gcal_vickery_jobs_id";
const CFG_INTERNAL_ID   = "gcal_vickery_internal_id";
const CFG_PERSONAL_ID   = "gcal_personal_calendar_id";
const CFG_SYNC_ENABLED  = "gcal_sync_enabled";
const CFG_LAST_SYNC_AT  = "gcal_last_sync_at";
const CFG_SA_EMAIL      = "gcal_service_account_email";
const CFG_TIMEZONE      = "gcal_timezone";

let _calCache   = null;
let _syncRunning = false;

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/\n/g, "\\n"));
  }
}

async function getCalendarClient() {
  const creds = getServiceAccount();
  const auth = new google.auth.JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

// ─────────────────────────────────────────────
// Config sheet helpers
// ─────────────────────────────────────────────
async function readConfig() {
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Config!A:B",
    });
    const map = {};
    for (const row of resp.data.values || []) {
      if (row && row[0]) map[String(row[0]).trim()] = String(row[1] || "").trim();
    }
    return map;
  } catch { return {}; }
}

async function writeConfig(key, value) {
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Config!A:B",
    });
    const values = resp.data.values || [];
    let rowNum = -1;
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || "").trim() === key) { rowNum = i + 1; break; }
    }
    if (rowNum > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID(),
        range: `Config!A${rowNum}:B${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[key, value]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID(),
        range: "Config!A:B",
        valueInputOption: "RAW",
        requestBody: { values: [[key, value]] },
      });
    }
  } catch (err) {
    console.error("[gcal] writeConfig error:", err.message);
  }
}

// ─────────────────────────────────────────────
// Calendar ID management
// ─────────────────────────────────────────────
async function loadCalendarIds(forceRefresh = false) {
  if (_calCache && !forceRefresh) return _calCache;
  const cfg = await readConfig();
  _calCache = {
    jobs:       cfg[CFG_JOBS_ID]      || "",
    internal:   cfg[CFG_INTERNAL_ID]  || "",
    personal:   cfg[CFG_PERSONAL_ID]  || "",
    enabled:    cfg[CFG_SYNC_ENABLED] !== "false",
    timezone:   cfg[CFG_TIMEZONE]     || "America/Chicago",
    saEmail:    cfg[CFG_SA_EMAIL]     || "",
  };
  return _calCache;
}

async function verifyCalendarExists(cal, calId) {
  try {
    await cal.calendars.get({ calendarId: calId });
    return true;
  } catch { return false; }
}

async function createCalendar(cal, name, timezone) {
  const resp = await cal.calendars.insert({
    requestBody: {
      summary:  name,
      timeZone: timezone || "America/Chicago",
    },
  });
  return resp.data.id;
}

// Ensure both owned calendars exist; store IDs in Config
async function bootstrapCalendars() {
  try {
    const cal = await getCalendarClient();
    const cfg = await readConfig();
    const tz  = cfg[CFG_TIMEZONE] || "America/Chicago";
    const creds = getServiceAccount();

    let jobsId     = cfg[CFG_JOBS_ID]     || "";
    let internalId = cfg[CFG_INTERNAL_ID] || "";

    const jobsOk     = jobsId     && await verifyCalendarExists(cal, jobsId);
    const internalOk = internalId && await verifyCalendarExists(cal, internalId);

    if (!jobsOk) {
      jobsId = await createCalendar(cal, CAL_JOBS, tz);
      await writeConfig(CFG_JOBS_ID, jobsId);
      console.log(`[gcal] Created calendar "${CAL_JOBS}": ${jobsId}`);
    }
    if (!internalOk) {
      internalId = await createCalendar(cal, CAL_INTERNAL, tz);
      await writeConfig(CFG_INTERNAL_ID, internalId);
      console.log(`[gcal] Created calendar "${CAL_INTERNAL}": ${internalId}`);
    }

    await writeConfig(CFG_SA_EMAIL, creds.client_email || "");

    _calCache = null; // force reload
    console.log(`[gcal] Calendars ready — Jobs: ${jobsId} | Internal: ${internalId}`);
    return { jobsId, internalId };
  } catch (err) {
    console.error("[gcal] bootstrapCalendars error:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Calendar routing
// ─────────────────────────────────────────────
function calendarForType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "personal block") return "personal";
  if (t === "meeting" || t === "callback") return "internal";
  if (t === "task" || t === "estimate" || t === "job") return "internal";
  return "internal";
}

function calendarForLeadStatus(status) {
  if (status === "Scheduled" || status === "In Progress") return "jobs";
  return null;
}

// ─────────────────────────────────────────────
// Reminders
// ─────────────────────────────────────────────
function remindersForType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "estimate")       return [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 60 }];
  if (t === "job" || t === "scheduled") return [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 30 }];
  if (t === "meeting")        return [{ method: "popup", minutes: 30 }];
  if (t === "callback")       return [{ method: "popup", minutes: 15 }];
  if (t === "personal block") return [{ method: "popup", minutes: 30 }];
  if (t === "task")           return [{ method: "popup", minutes: 0 }]; // fires at event start = 8:00 AM on due date
  return [{ method: "popup", minutes: 30 }];
}

// ─────────────────────────────────────────────
// GCal event building
// ─────────────────────────────────────────────
function buildGCalEvent({ title, type, startDT, endDT, notes, timezone, isAllDay }) {
  const event = {
    summary:     title,
    description: notes || "",
    reminders:   { useDefault: false, overrides: remindersForType(type) },
  };

  if (isAllDay) {
    const dateStr = startDT ? String(startDT).slice(0, 10) : new Date().toISOString().slice(0, 10);
    // Google Calendar all-day end is exclusive — must be the day AFTER start
    const nextDay = new Date(dateStr + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDateStr = nextDay.toISOString().slice(0, 10);
    event.start = { date: dateStr };
    event.end   = { date: endDateStr };
  } else {
    const tz = timezone || "America/Chicago";
    event.start = { dateTime: toRFC3339(startDT), timeZone: tz };
    event.end   = { dateTime: toRFC3339(endDT || startDT), timeZone: tz };
  }

  return event;
}

// Convert YYYY-MM-DDTHH:MM (local naive) to RFC 3339 with timezone
function toRFC3339(localDT) {
  if (!localDT) return new Date().toISOString();
  // If it already has seconds/Z, trust it
  if (localDT.includes("Z") || localDT.match(/[+-]\d{2}:\d{2}$/)) return localDT;
  // Append :00 seconds if needed
  const s = localDT.length === 16 ? localDT + ":00" : localDT;
  return s;
}

// ─────────────────────────────────────────────
// Core push functions
// ─────────────────────────────────────────────

// Create a GCal event; returns { gcalEventId, calendarId } or null on failure
async function createGCalEvent({ title, type, startDT, endDT, notes, isAllDay }) {
  try {
    const ids = await loadCalendarIds();
    if (!ids.enabled) return null;

    const calType = calendarForType(type);
    const calendarId = calType === "personal" ? ids.personal
                     : calType === "jobs"     ? ids.jobs
                     :                          ids.internal;
    if (!calendarId) {
      console.warn(`[gcal] No calendar ID for type "${type}" (calType="${calType}")`);
      return null;
    }

    const cal = await getCalendarClient();
    const event = buildGCalEvent({ title, type, startDT, endDT, notes, timezone: ids.timezone, isAllDay });
    const resp = await cal.events.insert({ calendarId, requestBody: event });
    const gcalEventId = resp.data.id;
    console.log(`[gcal] Created event "${title}" → calId=${calendarId} gcalId=${gcalEventId}`);
    return { gcalEventId, calendarId };
  } catch (err) {
    console.error("[gcal] createGCalEvent error:", err.message);
    return null;
  }
}

// Create a GCal event for a job/estimate lead
async function createJobGCalEvent({ title, status, scheduledDate, durationMinutes, address, notes }) {
  try {
    const ids = await loadCalendarIds();
    if (!ids.enabled) return null;

    const calendarId = ids.jobs;
    if (!calendarId) { console.warn("[gcal] No Jobs calendar ID"); return null; }
    if (!scheduledDate) return null;

    const startDT = scheduledDate.length === 10 ? scheduledDate + "T08:00:00" : scheduledDate;
    const dur = Number(durationMinutes) || 120;
    const endDT = addMinutesToISO(startDT, dur);

    const cal = await getCalendarClient();
    const type = title.startsWith("Estimate") ? "estimate" : "job";
    const event = buildGCalEvent({ title, type, startDT, endDT, notes: (notes || "") + (address ? `\nAddress: ${address}` : ""), timezone: ids.timezone, isAllDay: false });
    const resp = await cal.events.insert({ calendarId, requestBody: event });
    const gcalEventId = resp.data.id;
    console.log(`[gcal] Created job event "${title}" → gcalId=${gcalEventId}`);
    return { gcalEventId, calendarId };
  } catch (err) {
    console.error("[gcal] createJobGCalEvent error:", err.message);
    return null;
  }
}

// Update an existing GCal event
async function updateGCalEvent({ calendarId, gcalEventId, title, type, startDT, endDT, notes, isAllDay }) {
  try {
    if (!calendarId || !gcalEventId) return false;
    const ids = await loadCalendarIds();
    if (!ids.enabled) return false;
    const cal = await getCalendarClient();
    const event = buildGCalEvent({ title, type, startDT, endDT, notes, timezone: ids.timezone, isAllDay });
    await cal.events.update({ calendarId, eventId: gcalEventId, requestBody: event });
    console.log(`[gcal] Updated gcalId=${gcalEventId}`);
    return true;
  } catch (err) {
    console.error("[gcal] updateGCalEvent error:", err.message);
    return false;
  }
}

// Delete a GCal event
async function deleteGCalEvent({ calendarId, gcalEventId }) {
  try {
    if (!calendarId || !gcalEventId) return false;
    const ids = await loadCalendarIds();
    if (!ids.enabled) return false;
    const cal = await getCalendarClient();
    await cal.events.delete({ calendarId, eventId: gcalEventId });
    console.log(`[gcal] Deleted gcalId=${gcalEventId}`);
    return true;
  } catch (err) {
    console.error("[gcal] deleteGCalEvent error:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// Sheet write-back: store gcal_event_id in sheet row
// ─────────────────────────────────────────────

async function writeGCalEventIdToSheet({ tab, idCol, idValue, gcalCol, gcalEventId, calendarId }) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = SPREADSHEET_ID();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z5000`,
    });
    const values = resp.data.values || [];
    const headers = values[0] || [];

    // Find the gcal_event_id column index (use provided or detect from headers)
    const gcalColIdx = gcalCol >= 0 ? gcalCol : headers.indexOf("gcal_event_id");
    if (gcalColIdx < 0) return;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (String(row[idCol] || "").trim() === String(idValue)) {
        while (row.length <= gcalColIdx) row.push("");
        row[gcalColIdx] = `${gcalEventId}|${calendarId}`;
        const colLetter = colToLetter(gcalColIdx);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${tab}!${colLetter}${i + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [[row[gcalColIdx]]] },
        });
        return;
      }
    }
  } catch (err) {
    console.error("[gcal] writeGCalEventIdToSheet error:", err.message);
  }
}

function colToLetter(idx) {
  let letter = "";
  let n = idx;
  do {
    letter = String.fromCharCode("A".charCodeAt(0) + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

// ─────────────────────────────────────────────
// Personal calendar — busy block reader for schedule.js
// ─────────────────────────────────────────────
async function getPersonalBusyBlocks(startDateISO, endDateISO) {
  try {
    const ids = await loadCalendarIds();
    if (!ids.enabled || !ids.personal) return [];

    const cal = await getCalendarClient();
    const resp = await cal.freebusy.query({
      requestBody: {
        timeMin: startDateISO + "T00:00:00Z",
        timeMax: endDateISO   + "T23:59:59Z",
        items: [{ id: ids.personal }],
      },
    });
    const busy = (resp.data.calendars[ids.personal] || {}).busy || [];
    return busy.map((b) => ({
      start: b.start,
      end:   b.end,
      source: "personal_calendar",
    }));
  } catch (err) {
    console.error("[gcal] getPersonalBusyBlocks error:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// Reverse sync: poll GCal for updates to CRM-owned events
// ─────────────────────────────────────────────
async function pollReverseSyncForCalendar(cal, calendarId, calType, minUpdatedAt) {
  try {
    const resp = await cal.events.list({
      calendarId,
      updatedMin: minUpdatedAt || new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      showDeleted: true,
      singleEvents: true,
    });
    return resp.data.items || [];
  } catch (err) {
    console.error(`[gcal] pollReverseSyncForCalendar error (${calType}):`, err.message);
    return [];
  }
}

async function runReverseSync() {
  if (_syncRunning) return;
  _syncRunning = true;
  try {
    const ids  = await loadCalendarIds();
    if (!ids.enabled) return;
    if (!ids.jobs && !ids.internal) return;

    const cal = await getCalendarClient();
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min window

    // Collect all updated GCal events
    const updatedEvents = [];
    if (ids.jobs)     updatedEvents.push(...(await pollReverseSyncForCalendar(cal, ids.jobs, "jobs", since)));
    if (ids.internal) updatedEvents.push(...(await pollReverseSyncForCalendar(cal, ids.internal, "internal", since)));

    if (!updatedEvents.length) return;

    // Load CRM records that have gcal_event_ids
    const sheets = await getSheetsClient();
    const spreadsheetId = SPREADSHEET_ID();
    const [leadsResp, eventsResp, tasksResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A1:Z5000" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Events!A1:Z5000" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Tasks!A1:L5000" }),
    ]);

    const leadsVals  = leadsResp.data.values  || [];
    const eventsVals = eventsResp.data.values || [];
    const tasksVals  = tasksResp.data.values  || [];
    const leadsHdr   = leadsVals[0]  || [];
    const eventsHdr  = eventsVals[0] || [];
    const tasksHdr   = tasksVals[0]  || [];

    const leadGcalCol   = leadsHdr.indexOf("gcal_event_id");
    const leadSchedCol  = leadsHdr.indexOf("scheduled_date");
    const leadStatusCol = leadsHdr.indexOf("status");
    const leadNotesCol  = leadsHdr.indexOf("notes");
    const evGcalCol     = eventsHdr.indexOf("gcal_event_id");
    const evStartCol    = eventsHdr.indexOf("start_datetime");
    const evEndCol      = eventsHdr.indexOf("end_datetime");
    const evStatusCol   = eventsHdr.indexOf("status");
    const taskGcalCol   = tasksHdr.indexOf("gcal_event_id");
    const taskDueCol    = tasksHdr.indexOf("due_date");
    const taskStatusCol = tasksHdr.indexOf("status");
    const taskNotesCol  = tasksHdr.indexOf("notes");

    const deletedAt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    for (const gEvt of updatedEvents) {
      const gcalId = gEvt.id;
      const deleted = gEvt.status === "cancelled";

      // ── Leads ──────────────────────────────────────────────────
      if (leadGcalCol >= 0) {
        for (let ri = 1; ri < leadsVals.length; ri++) {
          const row = leadsVals[ri] || [];
          const stored = String(row[leadGcalCol] || "").split("|")[0];
          if (stored !== gcalId) continue;

          if (deleted) {
            // Lead deleted from GCal → revert to Unscheduled + leave review note
            if (leadStatusCol >= 0 && String(row[leadStatusCol]) === "Scheduled") {
              const newRow = [...row];
              newRow[leadStatusCol] = "Unscheduled";
              // Append a review note so the owner knows why it reverted
              if (leadNotesCol >= 0) {
                const existing = String(newRow[leadNotesCol] || "");
                newRow[leadNotesCol] = (existing ? existing + "\n" : "")
                  + `[GCal] Removed from calendar on ${deletedAt} — review & reschedule if needed.`;
              }
              newRow[leadGcalCol] = ""; // clear stale ID
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Leads!A${ri + 1}:Z${ri + 1}`,
                valueInputOption: "RAW",
                requestBody: { values: [newRow] },
              });
              console.log(`[gcal reverse] Lead row ${ri + 1} deleted from GCal → Unscheduled (review note added)`);
            }
          } else if (gEvt.start && leadSchedCol >= 0) {
            // Lead rescheduled → update scheduled_date
            const newStart = gEvt.start.dateTime || gEvt.start.date || "";
            if (newStart && String(row[leadSchedCol] || "").slice(0, 16) !== newStart.slice(0, 16)) {
              const newRow = [...row];
              newRow[leadSchedCol] = newStart.slice(0, 16);
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Leads!A${ri + 1}:Z${ri + 1}`,
                valueInputOption: "RAW",
                requestBody: { values: [newRow] },
              });
              console.log(`[gcal reverse] Lead row ${ri + 1} rescheduled → ${newStart}`);
            }
          }
          break;
        }
      }

      // ── Events ─────────────────────────────────────────────────
      if (evGcalCol >= 0) {
        for (let ri = 1; ri < eventsVals.length; ri++) {
          const row = eventsVals[ri] || [];
          const stored = String(row[evGcalCol] || "").split("|")[0];
          if (stored !== gcalId) continue;

          if (deleted && evStatusCol >= 0) {
            const newRow = [...row];
            newRow[evStatusCol] = "Cancelled";
            newRow[evGcalCol]   = ""; // clear stale ID
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `Events!A${ri + 1}:Z${ri + 1}`,
              valueInputOption: "RAW",
              requestBody: { values: [newRow] },
            });
            console.log(`[gcal reverse] Event row ${ri + 1} deleted from GCal → Cancelled`);
          } else if (!deleted && gEvt.start) {
            const newRow = [...row];
            let changed = false;
            if (evStartCol >= 0 && gEvt.start.dateTime) {
              const ns = gEvt.start.dateTime.slice(0, 16);
              if (ns !== String(row[evStartCol] || "").slice(0, 16)) { newRow[evStartCol] = ns; changed = true; }
            }
            if (evEndCol >= 0 && gEvt.end && gEvt.end.dateTime) {
              const ne = gEvt.end.dateTime.slice(0, 16);
              if (ne !== String(row[evEndCol] || "").slice(0, 16)) { newRow[evEndCol] = ne; changed = true; }
            }
            if (changed) {
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Events!A${ri + 1}:Z${ri + 1}`,
                valueInputOption: "RAW",
                requestBody: { values: [newRow] },
              });
              console.log(`[gcal reverse] Event row ${ri + 1} rescheduled from GCal`);
            }
          }
          break;
        }
      }

      // ── Tasks ──────────────────────────────────────────────────
      if (taskGcalCol >= 0) {
        for (let ri = 1; ri < tasksVals.length; ri++) {
          const row = tasksVals[ri] || [];
          const stored = String(row[taskGcalCol] || "").split("|")[0];
          if (stored !== gcalId) continue;

          if (deleted) {
            // Task deleted from GCal → flag for review, leave note
            if (taskStatusCol >= 0 && String(row[taskStatusCol]).toLowerCase() !== "done") {
              const newRow = [...row];
              newRow[taskStatusCol] = "Flagged";
              if (taskNotesCol >= 0) {
                const existing = String(newRow[taskNotesCol] || "");
                newRow[taskNotesCol] = (existing ? existing + "\n" : "")
                  + `[GCal] Removed from calendar on ${deletedAt} — verify completion or reschedule.`;
              }
              newRow[taskGcalCol] = ""; // clear stale ID
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Tasks!A${ri + 1}:L${ri + 1}`,
                valueInputOption: "RAW",
                requestBody: { values: [newRow] },
              });
              console.log(`[gcal reverse] Task row ${ri + 1} deleted from GCal → Flagged (review note added)`);
            }
          } else if (gEvt.start && taskDueCol >= 0) {
            // Task rescheduled from GCal → update due_date
            const newStart = gEvt.start.dateTime || gEvt.start.date || "";
            const newDate  = newStart ? newStart.slice(0, 10) : "";
            if (newDate && newDate !== String(row[taskDueCol] || "").slice(0, 10)) {
              const newRow = [...row];
              newRow[taskDueCol] = newDate;
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Tasks!A${ri + 1}:L${ri + 1}`,
                valueInputOption: "RAW",
                requestBody: { values: [newRow] },
              });
              console.log(`[gcal reverse] Task row ${ri + 1} rescheduled → ${newDate}`);
            }
          }
          break;
        }
      }
    }

    await writeConfig(CFG_LAST_SYNC_AT, new Date().toISOString());
  } catch (err) {
    console.error("[gcal] runReverseSync error:", err.message);
  } finally {
    _syncRunning = false;
  }
}

// ─────────────────────────────────────────────
// Settings / status
// ─────────────────────────────────────────────
async function getGCalStatus() {
  try {
    const cfg = await readConfig();
    const creds = getServiceAccount();
    return {
      enabled:     cfg[CFG_SYNC_ENABLED] !== "false",
      jobsCalId:   cfg[CFG_JOBS_ID]     || "",
      internalId:  cfg[CFG_INTERNAL_ID] || "",
      personalId:  cfg[CFG_PERSONAL_ID] || "",
      lastSyncAt:  cfg[CFG_LAST_SYNC_AT]|| "",
      saEmail:     creds.client_email   || cfg[CFG_SA_EMAIL] || "",
      timezone:    cfg[CFG_TIMEZONE]    || "America/Chicago",
    };
  } catch (err) {
    return { enabled: false, error: err.message };
  }
}

async function saveGCalSettings({ enabled, personalId, timezone }) {
  if (enabled !== undefined) await writeConfig(CFG_SYNC_ENABLED, String(enabled));
  if (personalId !== undefined) await writeConfig(CFG_PERSONAL_ID, String(personalId));
  if (timezone   !== undefined) await writeConfig(CFG_TIMEZONE, String(timezone));
  _calCache = null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function addMinutesToISO(dtStr, minutes) {
  // dtStr is YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS
  if (!dtStr) return "";
  const parts = dtStr.split("T");
  if (parts.length < 2) return dtStr;
  const datePart = parts[0];
  const timePart = parts[1].slice(0, 5);
  const hm = timePart.split(":");
  let totalMins = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10) + Number(minutes);
  const extraDays = Math.floor(totalMins / 1440);
  totalMins = totalMins % 1440;
  const endH = Math.floor(totalMins / 60);
  const endM = totalMins % 60;
  let endDate = datePart;
  if (extraDays > 0) {
    const d = new Date(datePart + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + extraDays);
    endDate = d.toISOString().slice(0, 10);
  }
  return `${endDate}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;
}

// ─────────────────────────────────────────────
// Overdue task alert: daily 8 AM cron
// ─────────────────────────────────────────────
// For each open task with due_date < today, creates a GCal "⚠ Overdue" event
// in the Internal calendar at 8 AM today (0-min popup = fires at 8 AM).
// Appends a daily flag to task notes to prevent duplicate alerts the same day.
async function runOverdueTaskAlerts() {
  try {
    const ids = await loadCalendarIds();
    if (!ids.enabled || !ids.internal) return;

    const today     = new Date().toISOString().slice(0, 10);
    const alertFlag = `[GCal] Overdue alert ${today}`;

    const sheets        = await getSheetsClient();
    const spreadsheetId = SPREADSHEET_ID();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Tasks!A1:L5000" });
    const rows = resp.data.values || [];
    const hdr  = rows[0] || [];

    const colId     = hdr.indexOf("task_id");
    const colTitle  = hdr.indexOf("title");
    const colDue    = hdr.indexOf("due_date");
    const colStatus = hdr.indexOf("status");
    const colNotes  = hdr.indexOf("notes");

    if (colDue < 0) return;

    const cal = await getCalendarClient();

    for (let ri = 1; ri < rows.length; ri++) {
      const row    = rows[ri] || [];
      const status = String(row[colStatus] || "").toLowerCase();
      const dueRaw = String(row[colDue]    || "").slice(0, 10);
      const notes  = String(row[colNotes]  || "");

      if (!dueRaw || dueRaw >= today) continue;                        // not overdue
      if (status === "done" || status === "cancelled") continue;        // already resolved
      if (notes.includes(alertFlag)) continue;                         // already alerted today

      const taskTitle = String(row[colTitle] || "Task");
      const alertTitle = `⚠ Overdue: ${taskTitle}`;

      try {
        await cal.events.insert({
          calendarId: ids.internal,
          requestBody: {
            summary:     alertTitle,
            description: `Task was due ${dueRaw}. Open in CRM to resolve.`,
            start:    { dateTime: `${today}T08:00:00`, timeZone: "America/Chicago" },
            end:      { dateTime: `${today}T08:15:00`, timeZone: "America/Chicago" },
            reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
          },
        });

        // Append flag to task notes so we don't re-alert today
        const newRow  = [...row];
        while (newRow.length < 12) newRow.push("");
        newRow[colNotes] = (notes ? notes + "\n" : "") + alertFlag;
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Tasks!A${ri + 1}:L${ri + 1}`,
          valueInputOption: "RAW",
          requestBody: { values: [newRow] },
        });
        console.log(`[gcal] Overdue alert created for task: ${taskTitle}`);
      } catch (e) {
        console.error(`[gcal] Overdue alert error for task ${taskTitle}:`, e.message);
      }
    }
  } catch (err) {
    console.error("[gcal] runOverdueTaskAlerts error:", err.message);
  }
}

module.exports = {
  bootstrapCalendars,
  createGCalEvent,
  createJobGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  writeGCalEventIdToSheet,
  getPersonalBusyBlocks,
  runReverseSync,
  runOverdueTaskAlerts,
  getGCalStatus,
  saveGCalSettings,
  loadCalendarIds,
  calendarForType,
};
