// api/events.js — Timed calendar events (Meeting, Callback, Personal Block)
const { getSheetsClient } = require("../lib/sheets");

const TIMED_TYPES = new Set(["Meeting", "Callback", "Personal Block"]);

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
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Events!A1:J5000",
      });
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
    // (crew routes force these from session — body values for these fields are ignored)
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
        ]],
      },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, event_id }));
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

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Events!A1:J5000",
    });
    const values = resp.data.values || [];
    const rowIndex = values.findIndex((r, i) => i > 0 && String(r[0]||"") === eventId);
    if (rowIndex === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Event not found" }));
    }
    const row = [...values[rowIndex]];
    while (row.length < 10) row.push("");

    if (body.status         !== undefined) row[7] = String(body.status);
    if (body.notes          !== undefined) row[6] = String(body.notes);
    if (body.end_datetime   !== undefined) row[4] = String(body.end_datetime);
    if (body.assigned_to    !== undefined) row[5] = String(body.assigned_to);

    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Events!A${sheetRow}:J${sheetRow}`,
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

module.exports = { handleGetEvents, handleCreateEvent, handleUpdateEvent, TIMED_TYPES };
