// api/tasks.js — Task object CRUD (Tasks sheet in CRM_SHEET_ID)
const { getSheetsClient } = require("../lib/sheets");

const COL_COUNT = 11;

function newTaskId() {
  return "TSK-" + Date.now();
}

function mapRowToTask(row) {
  const [task_id, title, type, due_date, assigned_to,
         related_lead_id, priority, notes, status, created_at, created_by] = row;
  return {
    task_id:        task_id || "",
    title:          title || "",
    type:           type || "Task",
    due_date:       due_date || "",
    assigned_to:    assigned_to || "",
    related_lead_id:related_lead_id || "",
    priority:       priority || "medium",
    notes:          notes || "",
    status:         status || "Open",
    created_at:     created_at || "",
    created_by:     created_by || "",
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
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Tasks!A1:K5000",
      });
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
    // created_by and assigned_to defaults come from server overrides (e.g. crew session)
    const created_by  = serverOverrides.created_by  || "admin";
    const assigned_to = body.assigned_to || serverOverrides.assigned_to || "";

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
        ]],
      },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, task_id }));
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
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Tasks!A1:K5000",
      });
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
    //          related_lead_id(5), priority(6), notes(7), status(8), created_at(9), created_by(10)
    if (body.title          !== undefined) row[1] = String(body.title);
    if (body.type           !== undefined) row[2] = String(body.type);
    if (body.due_date       !== undefined) row[3] = String(body.due_date);
    if (body.assigned_to    !== undefined) row[4] = String(body.assigned_to);
    if (body.related_lead_id!== undefined) row[5] = String(body.related_lead_id);
    if (body.priority       !== undefined) row[6] = String(body.priority);
    if (body.notes          !== undefined) row[7] = String(body.notes);
    if (body.status         !== undefined) row[8] = String(body.status);

    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Tasks!A${sheetRow}:K${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleGetTasks, handleCreateTask, handleUpdateTask };
