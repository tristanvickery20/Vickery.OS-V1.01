// api/events.js — Timed calendar events (Meeting, Callback, Personal Block)
// Task #23: After creation, push to Google Calendar async
const { getSheetsClient } = require("../lib/sheets");

const TIMED_TYPES = new Set(["Meeting", "Callback", "Personal Block"]);
const RANGE = "Events!A1:K5000"; // K = gcal_event_id (col 10)

function newEventId() {
  return "EVT-" + Date.now();
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function handleGetEvents(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const url = new URL("http://x" + req.url);
    const filterAssigned = (url.searchParams.get("assigned_to") || "").toLowerCase();
    const filterType     = (url.searchParams.get("type") || "").toLowerCase();

    let values = [];
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      values = resp.data.values || [];
    } catch { values = []; }

    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, events: [] }));
    }

    const events = values.slice(1)
      .filter(r => r && r.length && String(r[0]||"").trim() !== "")
      .filter(r => !filterAssigned || String(r[5]||"").toLowerCase() === filterAssigned)
      .filter(r => !filterType     || String(r[2]||"").toLowerCase() === filterType)
      .filter(r => String(r[7]||"").toLowerCase() !== "cancelled")
      .map(r => ({
        event_id:       r[0]||"",
        title:          r[1]||"",
        type:           r[2]||"Meeting",
        start_datetime: r[3]||"",
        end_datetime:   r[4]||"",
        assigned_to:    r[5]||"",
        notes:          r[6]||"",
        status:         r[7]||"Scheduled",
        created_at:     r[8]||"",
        created_by:     r[9]||"",
        gcal_event_id:  r[10]||"",
      }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, events }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleCreateEvent(req, res, serverOverrides = {}) {
  try {
    const body = await readBody(req);
    const { title, type, start_datetime, end_datetime, notes } = body;
    // created_by and assigned_to always come from server overrides when provided
    const created_by  = serverOverrides.created_by  || "admin";
    const assigned_to = serverOverrides.assigned_to != null ? serverOverrides.assigned_to
                      : (body.assigned_to || "");

    if (!title || !String(title).trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "title is required" }));
    }
    if (!start_datetime) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "start_datetime is required" }));
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const event_id  = newEventId();
    const created_at = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Events!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        majorDimension: "ROWS",
        values: [[
          event_id,
          String(title).trim(),
          String(type || "Meeting"),
          String(start_datetime),
          String(end_datetime || ""),
          String(assigned_to || ""),
          String(notes || ""),
          "Scheduled",
          created_at,
          String(created_by),
          "",  // gcal_event_id — written back async
        ]],
      },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, event_id }));

    // Fire-and-forget: push to Google Calendar
    const evTitle = String(title).trim();
    const evType  = String(type || "Meeting");
    setImmediate(async () => {
      try {
        const { createGCalEvent, writeGCalEventIdToSheet } = require("../lib/googleCalendar");
        const result = await createGCalEvent({
          title:    evTitle,
          type:     evType,
          startDT:  start_datetime,
          endDT:    end_datetime || start_datetime,
          notes:    notes || "",
          isAllDay: false,
        });
        if (result && result.gcalEventId) {
          await writeGCalEventIdToSheet({
            tab: "Events", idCol: 0, idValue: event_id,
            gcalCol: 10, gcalEventId: result.gcalEventId, calendarId: result.calendarId,
          });
        }
      } catch (err) {
        console.error("[events] GCal push error:", err.message);
      }
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleUpdateEvent(req, res, eventId) {
  try {
    const body = await readBody(req);
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
    const values = resp.data.values || [];
    const rowIndex = values.findIndex((r, i) => i > 0 && String(r[0]||"") === eventId);
    if (rowIndex === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Event not found" }));
    }
    const row = [...values[rowIndex]];
    while (row.length < 11) row.push("");

    if (body.status         !== undefined) row[7] = String(body.status);
    if (body.notes          !== undefined) row[6] = String(body.notes);
    if (body.end_datetime   !== undefined) row[4] = String(body.end_datetime);
    if (body.assigned_to    !== undefined) row[5] = String(body.assigned_to);
    if (body.start_datetime !== undefined) row[3] = String(body.start_datetime);

    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Events!A${sheetRow}:K${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Fire-and-forget: sync update to GCal
    const gcalRaw = String(row[10] || "");
    if (gcalRaw && (body.start_datetime !== undefined || body.end_datetime !== undefined || body.status !== undefined)) {
      setImmediate(async () => {
        try {
          const [gcalEventId, calendarId] = gcalRaw.split("|");
          if (!gcalEventId || !calendarId) return;

          if (body.status === "Cancelled") {
            const { deleteGCalEvent } = require("../lib/googleCalendar");
            await deleteGCalEvent({ calendarId, gcalEventId });
          } else {
            const { updateGCalEvent } = require("../lib/googleCalendar");
            await updateGCalEvent({
              calendarId, gcalEventId,
              title:   String(row[1]),
              type:    String(row[2]),
              startDT: String(row[3]),
              endDT:   String(row[4]),
              notes:   String(row[6]),
              isAllDay: false,
            });
          }
        } catch (err) { console.error("[events] GCal update error:", err.message); }
      });
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleGetEvents, handleCreateEvent, handleUpdateEvent, TIMED_TYPES };
