// api/payments.js
const { readTab } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function num(v, def = 0) {
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function colLetter(c) {
  if (c < 26) return String.fromCharCode(65 + c);
  return String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
}

async function handleCreatePayment(req, res) {
  try {
    const body = await readBody(req);

    const invoice_id = String(body.invoice_id || "").trim();
    const amount = round2(num(body.amount, NaN));

    if (!invoice_id) return json(res, 400, { ok: false, error: "invoice_id is required." });
    if (!isFinite(amount) || amount <= 0) return json(res, 400, { ok: false, error: "amount must be a positive number." });

    const rid = genRequestId();
    const now = new Date().toISOString();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "Missing CRM_SHEET_ID." });

    // Load Invoices grid to find the invoice row
    const invResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:Z5000",
    });
    const invValues = invResp.data.values || [];
    if (invValues.length <= 1) return json(res, 404, { ok: false, error: "Invoice not found." });

    const invHeaders = invValues[0].map((h) => String(h || "").trim());
    const idCol = invHeaders.indexOf("id");
    if (idCol < 0) return json(res, 500, { ok: false, error: "Invoices sheet missing id column." });

    let invRowIndex = -1;
    for (let r = 1; r < invValues.length; r++) {
      if (String(invValues[r][idCol] || "").trim() === invoice_id) {
        invRowIndex = r;
        break;
      }
    }
    if (invRowIndex < 0) return json(res, 404, { ok: false, error: "Invoice not found." });

    const inv = {};
    for (let i = 0; i < invHeaders.length; i++) {
      inv[invHeaders[i]] = invValues[invRowIndex][i] != null ? String(invValues[invRowIndex][i]) : "";
    }

    const status = normalize(inv.status_code);
    if (status === "void") {
      return json(res, 409, { ok: false, code: "VOID", message: "Cannot add payments to a void invoice." });
    }

    const client_id = String(inv.client_id || "").trim();
    const request_id = String(inv.request_id || "").trim();

    // Append payment row
    const payment_id = "PAY-" + Date.now();
    const payRowObj = {
      id: payment_id,
      created_at: now,
      invoice_id,
      client_id,
      request_id,
      amount: String(amount),
      method: String(body.method || "").trim(),
      reference: String(body.reference || "").trim(),
      note: String(body.note || "").trim(),
    };

    const payHeadersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Payments!1:1",
    });
    const payHeaders = (payHeadersResp.data.values && payHeadersResp.data.values[0]) || [];
    const payRow = payHeaders.map((h) => payRowObj[String(h || "").trim()] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Payments!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [payRow] },
    });

    logAudit({
      actor: "admin",
      action: "CREATE_PAYMENT",
      entity_type: "payment",
      entity_id: payment_id,
      field: "amount",
      new_value: String(amount),
      note: `invoice_id=${invoice_id}`,
      source: "crm",
      request_id: rid,
    });

    // Recompute paid_amount for invoice based on ALL Payments rows
    const payments = await readTab("Payments");
    const myPayments = payments.filter((p) => String(p.invoice_id || "").trim() === invoice_id);
    const paid_amount = round2(myPayments.reduce((s, p) => s + num(p.amount, 0), 0));

    // Recompute balance_due deterministically from invoice totals fields
    const total = round2(num(inv.total, 0));
    const deposit_applied = round2(num(inv.deposit_applied, 0));
    const balance_due = round2(Math.max(0, total - deposit_applied - paid_amount));

    // Write back to invoice row
    const sheetRow = invRowIndex + 1;
    const updates = [];

    function setCell(field, value) {
      const ci = invHeaders.indexOf(field);
      if (ci < 0) return;
      updates.push({
        range: `Invoices!${colLetter(ci)}${sheetRow}`,
        values: [[String(value)]],
      });
      inv[field] = String(value);
    }

    setCell("paid_amount", paid_amount);
    setCell("balance_due", balance_due);
    setCell("updated_at", now);

    // If fully paid, mark invoice paid
    if (balance_due <= 0 && normalize(inv.status_code) !== "paid") {
      setCell("status_code", "paid");
      setCell("paid_at", now);

      logAudit({
        actor: "admin",
        action: "UPDATE_INVOICE",
        entity_type: "invoice",
        entity_id: invoice_id,
        field: "status_code",
        old_value: inv.status_code || "",
        new_value: "paid",
        note: "Auto-marked paid (balance_due <= 0)",
        source: "crm",
        request_id: rid,
      });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates,
        },
      });
    }

    if (client_id) touchClient(client_id).catch(() => {});

    json(res, 201, {
      ok: true,
      payment_id,
      invoice_id,
      paid_amount,
      balance_due,
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleCreatePayment };