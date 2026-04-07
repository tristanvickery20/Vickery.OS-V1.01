const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");

function mapRowToEntry(row) {
  const [id, created_at, date, tech_id, lead_id, minutes, category, notes,
         lat_in, lng_in, lat_out, lng_out] = row;
  return {
    id: id || "",
    created_at: created_at || "",
    date: date || "",
    tech_id: tech_id || "",
    lead_id: lead_id || "",
    minutes: Number(minutes || 0),
    category: category || "",
    notes: notes || "",
    lat_in: lat_in || "",
    lng_in: lng_in || "",
    lat_out: lat_out || "",
    lng_out: lng_out || "",
  };
}

async function handleGetTime(req, res, opts = {}) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Time!A1:L2000",
    });

    const values = resp.data.values || [];
    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, entries: [] }));
    }

    let entries = values
      .slice(1)
      .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
      .map(mapRowToEntry);

    if (opts.filterDate) {
      entries = entries.filter((e) => e.date === opts.filterDate);
    }

    entries = entries
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 500);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, entries }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleCreateTime(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const data = body ? JSON.parse(body) : {};

      const entry = {
        id: "TIME-" + Date.now(),
        created_at: new Date().toISOString(),
        date: data.date || "",
        tech_id: data.tech_id || "",
        lead_id: data.lead_id || "",
        minutes: Number(data.minutes || 0),
        category: data.category || "",
        notes: data.notes || "",
        lat_in: data.lat_in != null ? String(data.lat_in) : "",
        lng_in: data.lng_in != null ? String(data.lng_in) : "",
        lat_out: data.lat_out != null ? String(data.lat_out) : "",
        lng_out: data.lng_out != null ? String(data.lng_out) : "",
      };

      const row = [
        entry.id,
        entry.created_at,
        entry.date,
        entry.tech_id,
        entry.lead_id,
        String(entry.minutes),
        entry.category,
        entry.notes,
        entry.lat_in,
        entry.lng_in,
        entry.lat_out,
        entry.lng_out,
      ];

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Time!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [row] },
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, entry }));

      logAudit({
        action: "time.create",
        entity_type: "time",
        entity_id: entry.id,
        field: "*",
        new_value: JSON.stringify({
          tech_id: entry.tech_id, lead_id: entry.lead_id,
          minutes: entry.minutes, category: entry.category,
          lat_in: entry.lat_in, lng_in: entry.lng_in,
        }),
        source: "crew-portal",
        request_id: genRequestId(),
      }).catch(() => {});
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

async function handleUpdateTime(req, res, timeId) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const data = body ? JSON.parse(body) : {};
      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Time!A1:L2000",
      });

      const values = resp.data.values || [];
      const rowIdx = values.findIndex((r, i) => i > 0 && String(r[0] || "").trim() === timeId);
      if (rowIdx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Time entry not found" }));
      }

      const existing = values[rowIdx];
      const sheetRow = rowIdx + 1; // 1-indexed

      const updated = [
        existing[0] || "",                                                  // id
        existing[1] || "",                                                  // created_at
        existing[2] || "",                                                  // date
        existing[3] || "",                                                  // tech_id
        existing[4] || "",                                                  // lead_id
        data.minutes  != null ? String(data.minutes)  : (existing[5] || "0"), // minutes
        data.category != null ? String(data.category) : (existing[6] || ""), // category
        data.notes    != null ? String(data.notes)    : (existing[7] || ""), // notes
        data.lat_in   != null ? String(data.lat_in)   : (existing[8] || ""), // lat_in
        data.lng_in   != null ? String(data.lng_in)   : (existing[9] || ""), // lng_in
        data.lat_out  != null ? String(data.lat_out)  : (existing[10] || ""), // lat_out
        data.lng_out  != null ? String(data.lng_out)  : (existing[11] || ""), // lng_out
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Time!A${sheetRow}:L${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { majorDimension: "ROWS", values: [updated] },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: timeId }));

      logAudit({
        action: "time.update",
        entity_type: "time",
        entity_id: timeId,
        field: "*",
        new_value: JSON.stringify({
          minutes: updated[5], lat_out: updated[10], lng_out: updated[11],
          notes: updated[7],
        }),
        source: "crew-portal",
        request_id: genRequestId(),
      }).catch(() => {});
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

module.exports = { handleGetTime, handleCreateTime, handleUpdateTime };
