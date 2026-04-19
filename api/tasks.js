// api/tasks.js — Task object CRUD (Tasks sheet in CRM_SHEET_ID)
// Task #23: After creation, push to Google Calendar (Vickery Internal) async
const { getSheetsClient } = require("../lib/sheets");

const COL_COUNT = 12; // includes gcal_event_id (col 11)
const RANGE     = "Tasks!A1:L5000";

function newTaskId() {
  return "TSK-" + Date.now();
}

function mapRowToTask(row) {
  const [task_id, title, type, due_date, assigned_to,
         related_lead_id, priority, notes, status, created_at, created_by, gcal_event_id] = row;
  return {
    task_id:         task_id || "",
    title:           title || "",
    type:            type || "Task",
    due_date:        due_date || "",
    assigned_to:     assigned_to || "",
    related_lead_id: related_lead_id || "",
    priority:        priority || "medium",
    notes:           notes || "",
    status:          status || "Open",
    created_at:      created_at || "",
    created_by:      created_by || "",
    gcal_event_id:   gcal_event_id || "",
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end",  () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function handleGetTasks(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const url = new URL("http://x" + req.url);
    const filterStatus   = (url.searchParams.get("status")      || "").toLowerCase();
    const filterAssigned = (url.searchParams.get("assigned_to") || "").toLowerCase();

    let values;
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      values = resp.data.values || [];
    } catch {
      values = [];
    }

    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, tasks: [] }));
    }

    let tasks = values
      .slice(1)
      .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
      .map(mapRowToTask);

    if (filterStatus)   tasks = tasks.filter((t) => t.status.toLowerCase() === filterStatus);
    if (filterAssigned) tasks = tasks.filter((t) => t.assigned_to.toLowerCase().includes(filterAssigned));

    tasks.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, tasks }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleCreateTask(req, res, serverOverrides = {}) {
  try {
    const body = await readBody(req);
    const { title, type, due_date, related_lead_id, priority, notes } = body;
    // created_by and assigned_to always come from server overrides when provided
    const created_by  = serverOverrides.created_by  || "admin";
    const assigned_to = serverOverrides.assigned_to != null ? serverOverrides.assigned_to
                      : (body.assigned_to || "");

    if (!title || !String(title).trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "title is required" }));
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const task_id   = newTaskId();
    const created_at = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Tasks!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        majorDimension: "ROWS",
        values: [[
          task_id,
          String(title).trim(),
          String(type        || "Task"),
          String(due_date    || ""),
          String(assigned_to || ""),
          String(related_lead_id || ""),
          String(priority    || "medium"),
          String(notes       || ""),
          "Open",
          created_at,
          String(created_by),
          "",  // gcal_event_id — written back async after GCal push
        ]],
      },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, task_id }));

    // Fire-and-forget: push to Google Calendar (Vickery Internal)
    const taskType = String(type || "Task");
    const taskTitle = String(title).trim();
    setImmediate(async () => {
      try {
        const { createGCalEvent, writeGCalEventIdToSheet } = require("../lib/googleCalendar");
        // Tasks always push as timed 8 AM events (not all-day) so the 0-minute
        // popup reminder fires at exactly 8 AM on the due date.
        const dueDateStr = (due_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const result = await createGCalEvent({
          title:    taskTitle,
          type:     taskType,
          startDT:  dueDateStr + "T08:00:00",
          endDT:    dueDateStr + "T08:30:00",
          notes:    notes || "",
          isAllDay: false,
        });
        if (result && result.gcalEventId) {
          await writeGCalEventIdToSheet({
            tab: "Tasks", idCol: 0, idValue: task_id,
            gcalCol: 11, gcalEventId: result.gcalEventId, calendarId: result.calendarId,
          });
        }
      } catch (err) {
        console.error("[tasks] GCal push error:", err.message);
      }
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleUpdateTask(req, res, taskId) {
  try {
    const body = await readBody(req);
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    let values;
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      values = resp.data.values || [];
    } catch {
      values = [];
    }

    const rowIndex = values.findIndex((r, i) => i > 0 && String(r[0] || "") === taskId);
    if (rowIndex < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Task not found" }));
    }

    const row = [...(values[rowIndex] || [])];
    while (row.length < COL_COUNT) row.push("");

    // Columns: task_id(0), title(1), type(2), due_date(3), assigned_to(4),
    //          related_lead_id(5), priority(6), notes(7), status(8), created_at(9),
    //          created_by(10), gcal_event_id(11)
    if (body.title          !== undefined) row[1]  = String(body.title);
    if (body.type           !== undefined) row[2]  = String(body.type);
    if (body.due_date       !== undefined) row[3]  = String(body.due_date);
    if (body.assigned_to    !== undefined) row[4]  = String(body.assigned_to);
    if (body.related_lead_id!== undefined) row[5]  = String(body.related_lead_id);
    if (body.priority       !== undefined) row[6]  = String(body.priority);
    if (body.notes          !== undefined) row[7]  = String(body.notes);
    if (body.status         !== undefined) row[8]  = String(body.status);

    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Tasks!A${sheetRow}:L${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Fire-and-forget: sync to GCal
    const gcalRaw    = String(row[11] || "");
    const taskId     = String(row[0] || "");
    const restoredOpen = body.status === "Open" && !gcalRaw;
    if (gcalRaw && (body.due_date !== undefined || body.title !== undefined || body.status !== undefined)) {
      setImmediate(async () => {
        try {
          const [gcalEventId, calendarId] = gcalRaw.split("|");
          if (!gcalEventId || !calendarId) return;
          const { updateGCalEvent } = require("../lib/googleCalendar");
          const dueDateUpd = (String(row[3]) || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
          await updateGCalEvent({
            calendarId, gcalEventId,
            title:   String(row[1]),
            type:    String(row[2]),
            startDT: dueDateUpd + "T08:00:00",
            endDT:   dueDateUpd + "T08:30:00",
            notes:   String(row[7]),
            isAllDay: false,
          });
        } catch (err) { console.error("[tasks] GCal update error:", err.message); }
      });
    } else if (restoredOpen) {
      // Task was restored from deleted/flagged state — gcal_event_id was cleared; recreate the event.
      setImmediate(async () => {
        try {
          const { createGCalEvent, writeGCalEventIdToSheet } = require("../lib/googleCalendar");
          const dueDate = (String(row[3]) || "").slice(0, 10);
          if (!dueDate) return;
          const result = await createGCalEvent({
            title:   String(row[1]),
            type:    String(row[2]) || "task",
            startDT: dueDate + "T08:00:00",
            endDT:   dueDate + "T08:30:00",
            notes:   String(row[7]),
            isAllDay: false,
          });
          if (result) {
            await writeGCalEventIdToSheet({
              tab: "Tasks", idCol: 0, idValue: taskId, gcalCol: 11,
              gcalEventId: result.gcalEventId, calendarId: result.calendarId,
            });
          }
        } catch (err) { console.error("[tasks] GCal restore push error:", err.message); }
      });
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleGetTasks, handleCreateTask, handleUpdateTask };
