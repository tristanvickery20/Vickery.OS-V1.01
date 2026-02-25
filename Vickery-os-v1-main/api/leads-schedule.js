const { getSheetsClient } = require("../lib/sheets");
const { logAuditBatch, genRequestId } = require("../lib/audit");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function normalizeScheduledDate(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.includes("T")) return s.slice(0, 16);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const hh = String(parsed.getHours()).padStart(2, "0");
    const min = String(parsed.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  return "";
}

async function handleScheduleLead(req, res) {
  if (req.method !== "PATCH") {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const data = await readBody(req);
    const id = String(data.id || "").trim();

    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Missing id" }));
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const getResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Leads!A1:T2000",
    });

    const values = getResp.data.values || [];
    let foundIdx = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i]?.[0] || "").trim() === id) { foundIdx = i; break; }
    }

    if (foundIdx === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Lead not found" }));
    }

    const row = values[foundIdx] || [];
    while (row.length < 20) row.push("");

    const depositRequired = String(row[6] || "").toLowerCase() === "true";
    const depositReceived = Number(row[10] || 0);
    const depositOverride = data.deposit_override === true;

    const reqId = genRequestId();
    const oldSnap = row.slice();

    if (depositRequired && depositReceived <= 0 && !depositOverride) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "DEPOSIT_REQUIRED" }));
      const { logAudit } = require("../lib/audit");
      logAudit({ action: "lead.status.blocked", entity_type: "lead", entity_id: id, field: "status", old_value: String(row[8] || ""), new_value: "Scheduled", note: "Deposit required but not received", source: "crm-leads", request_id: reqId }).catch(() => {});
      return;
    }

    row[8] = "Scheduled";
    row[13] = normalizeScheduledDate(data.scheduled_date);
    row[14] = String(data.assigned_to || "");
    row[16] = String(data.schedule_window || row[16] || "");
    row[17] = String(data.schedule_preference || row[17] || "");
    row[18] = String(Math.max(0, Math.min(1440, Math.round(Number(data.duration_minutes || 0)))));
    row[19] = String(depositOverride);

    const sheetRow = foundIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Leads!A${sheetRow}:T${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row.slice(0, 20)] },
    });

    const lead = {
      id: row[0], status: row[8], scheduled_date: row[13],
      assigned_to: row[14], duration_minutes: Number(row[18]),
      deposit_override: depositOverride,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, lead }));

    // Audit: log changed schedule fields
    const schedFields = { 8: "status", 13: "scheduled_date", 14: "assigned_to", 18: "duration_minutes", 19: "deposit_override" };
    const entries = [];
    for (const [idx, fname] of Object.entries(schedFields)) {
      const i = Number(idx);
      if (String(oldSnap[i] || "") !== String(row[i] || "")) {
        entries.push({ action: "lead.schedule", entity_type: "lead", entity_id: id, field: fname, old_value: String(oldSnap[i] || ""), new_value: String(row[i] || ""), source: "crm-leads", request_id: reqId });
      }
    }
    if (entries.length > 0) logAuditBatch(entries).catch(() => {});
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleScheduleLead };
