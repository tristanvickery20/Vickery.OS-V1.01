const { getSheetsClient } = require("../lib/sheets");
const { calculateRecessedLights } = require("../lib/pricing");
const { logAudit, genRequestId } = require("../lib/audit");

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return prefix + "-" + Date.now() + Math.floor(Math.random() * 1000); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function findLeadByPhoneAddress(sheets, spreadsheetId, phone, address) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A1:Z2000" });
  const rows = resp.data.values || [];
  if (rows.length <= 1) return { rowIndex: -1, lead: null, headers: rows[0] || [] };
  const headers = rows[0];
  const phoneIdx = headers.indexOf("phone");
  const addrIdx = headers.indexOf("address");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const rPhone = (r[phoneIdx] || "").trim();
    const rAddr = (r[addrIdx] || "").trim();
    if (rPhone === phone.trim()) {
      if (!address || rAddr === address.trim()) return { rowIndex: i, lead: r, headers };
    }
  }
  return { rowIndex: -1, lead: null, headers };
}

async function handleCreateQuote(req, res) {
  try {
    const data = await parseBody(req);
    const { name, phone, address, service_key, inputs } = data;
    if (!phone) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "phone is required" })); }

    const qty = Number((inputs && inputs.lights) || 1);
    const pricing = calculateRecessedLights(qty);
    const laborTotal = pricing.laborPerUnit * pricing.qty;
    const materialTotal = pricing.materialPerUnit * pricing.qty;

    const quoteId = newId("Q");
    const createdAt = nowIso();
    const pricingVersion = "v1";

    const snapshot = {
      quote_id: quoteId, created_at: createdAt,
      service_key: service_key || "recessed_light",
      inputs: inputs || {},
      engine: { pricing_version: pricingVersion, rates_used: { labor: pricing.laborPerUnit, material: pricing.materialPerUnit } },
      totals: { total: pricing.total, labor: laborTotal, material: materialTotal, unitTotal: pricing.unitTotal },
      lead: { name: name || "", phone, address: address || "" },
    };
    const snapshotJson = JSON.stringify(snapshot);

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const { rowIndex, lead: existingRow, headers } = await findLeadByPhoneAddress(sheets, spreadsheetId, phone, address);
    let leadId;

    if (rowIndex > 0 && existingRow) {
      leadId = existingRow[0];
      const idxOf = (h) => headers.indexOf(h);
      const updates = {};
      updates[idxOf("quoted_price")] = String(pricing.total);
      updates[idxOf("estimated_value")] = String(pricing.total);
      updates[idxOf("pricing_version")] = pricingVersion;
      updates[idxOf("last_quote_id")] = quoteId;
      updates[idxOf("quote_snapshot_json")] = snapshotJson;
      if (name) updates[idxOf("name")] = name;
      if (address) updates[idxOf("address")] = address;
      const statusIdx = idxOf("status");
      const currentStatus = existingRow[statusIdx] || "Lead";
      if (currentStatus === "Lead" || currentStatus === "") updates[statusIdx] = "Estimate Sent";

      const updatedRow = [...existingRow];
      while (updatedRow.length < headers.length) updatedRow.push("");
      for (const [ci, val] of Object.entries(updates)) { if (Number(ci) >= 0) updatedRow[Number(ci)] = val; }

      const sheetRow = rowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `Leads!A${sheetRow}`, valueInputOption: "RAW",
        requestBody: { majorDimension: "ROWS", values: [updatedRow] },
      });
    } else {
      leadId = newId("LEAD");
      const newRow = buildNewLeadRow(leadId, createdAt, data, pricing, pricingVersion, quoteId, snapshotJson);
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: "Leads!A:A", valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [newRow] },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Quotes!A:A", valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [[quoteId, createdAt, leadId, service_key || "recessed_light", pricingVersion, String(pricing.total), snapshotJson]] },
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, lead_id: leadId, quote_id: quoteId, total: pricing.total }));

    logAudit({
      action: "quote.create",
      entity_type: "quote",
      entity_id: quoteId,
      field: "*",
      new_value: String(pricing.total),
      note: "lead_id=" + leadId,
      source: "quote",
      request_id: genRequestId(),
    }).catch(() => {});
  } catch (err) {
    console.error("Quote create error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

function buildNewLeadRow(id, createdAt, data, pricing, pv, qid, snap) {
  return [
    id, createdAt, data.name || "", data.phone || "", data.address || "",
    "small_job", "false", String(pricing.total), "Estimate Sent",
    String(pricing.total), "0", "0", "0",
    "", "", "", "", "", "0", "false", "", "",
    pv, qid, snap,
  ];
}

module.exports = { handleCreateQuote };
