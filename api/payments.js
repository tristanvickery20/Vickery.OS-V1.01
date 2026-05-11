// api/payments.js
// POST /api/payments — record a payment event against an invoice.
// Full CRM-native financial model: tracks provider, type, gross/fee/net, and updates Leads.payment_status.

const { readTab } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");
const { getPaymentSettings, estimateFee } = require("../lib/paymentSettings");
const { PAYMENT_STATUS, PAYMENT_TYPE, PAYMENT_PROVIDER, PAYMENT_METHOD } = require("../lib/paymentStatus");

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

// Derive a Leads.payment_status from the invoice's current balance and payment details
function deriveLeadPaymentStatus(balanceDue, paidAmount, paymentType, paymentMethod) {
  if (balanceDue <= 0 && paidAmount > 0) return PAYMENT_STATUS.PAID;
  if (paymentMethod === PAYMENT_METHOD.CASH) return PAYMENT_STATUS.CASH_RECORDED;
  if (paymentType === PAYMENT_TYPE.DEPOSIT) return PAYMENT_STATUS.DEPOSIT_PAID;
  if (paidAmount > 0) return PAYMENT_STATUS.PARTIALLY_PAID;
  return PAYMENT_STATUS.UNPAID;
}

// Update Leads row payment_status, processing_fees_total, financing_fees_total, net_collected
async function updateLeadFinancials(sheets, spreadsheetId, leadId, paymentProvider, feeAmount, netAmount, newPaymentStatus) {
  if (!leadId) return;
  try {
    const leadsResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Leads!A1:ZZ5000",
    });
    const leadsValues = leadsResp.data.values || [];
    if (leadsValues.length <= 1) return;

    const leadsHeaders = leadsValues[0].map(h => String(h || "").trim());
    const idCol = leadsHeaders.indexOf("id");
    if (idCol < 0) return;

    let leadRowIndex = -1;
    for (let r = 1; r < leadsValues.length; r++) {
      if (String(leadsValues[r][idCol] || "").trim() === leadId) { leadRowIndex = r; break; }
    }
    if (leadRowIndex < 0) return;

    const lead = {};
    for (let i = 0; i < leadsHeaders.length; i++) {
      lead[leadsHeaders[i]] = leadsValues[leadRowIndex][i] != null ? String(leadsValues[leadRowIndex][i]) : "";
    }

    const updates = [];
    function setLeadCell(field, value) {
      const ci = leadsHeaders.indexOf(field);
      if (ci < 0) return;
      updates.push({ range: `Leads!${colLetter(ci)}${leadRowIndex + 1}`, values: [[String(value)]] });
    }

    // Update payment_status
    if (newPaymentStatus) setLeadCell("payment_status", newPaymentStatus);

    // Accumulate fees by provider type
    const fee = round2(num(feeAmount, 0));
    const prov = String(paymentProvider || "").toLowerCase();
    const isFinancingProvider = prov === PAYMENT_PROVIDER.WISETACK || prov === PAYMENT_PROVIDER.SQUARE_AFTERPAY;

    if (fee > 0) {
      if (isFinancingProvider) {
        const current = round2(num(lead.financing_fees_total, 0));
        setLeadCell("financing_fees_total", round2(current + fee));
      } else {
        const current = round2(num(lead.processing_fees_total, 0));
        setLeadCell("processing_fees_total", round2(current + fee));
      }
    }

    // Recompute net_collected from paid_amount - processing_fees_total - financing_fees_total
    const paidAmt = round2(num(lead.paid_amount, 0));
    const procFees = round2(num(lead.processing_fees_total, 0)) + (isFinancingProvider ? 0 : fee);
    const finFees  = round2(num(lead.financing_fees_total, 0))  + (isFinancingProvider ? fee : 0);
    setLeadCell("net_collected", round2(paidAmt - procFees - finFees));

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }
  } catch (err) {
    console.error("[payments] updateLeadFinancials error (non-fatal):", err.message);
  }
}

async function handleCreatePayment(req, res) {
  try {
    const body = await readBody(req);

    const invoice_id = String(body.invoice_id || "").trim();
    // gross_amount is the preferred field; fall back to amount for legacy callers
    const gross_amount = round2(num(body.gross_amount ?? body.amount, NaN));

    if (!invoice_id) return json(res, 400, { ok: false, error: "invoice_id is required." });
    if (!isFinite(gross_amount) || gross_amount <= 0) return json(res, 400, { ok: false, error: "amount must be a positive number." });

    // Resolve fee/net — caller may provide explicit values, or we compute from provider
    const settings = await getPaymentSettings();
    const payment_provider = String(body.payment_provider || body.provider || PAYMENT_PROVIDER.MANUAL).trim();
    let fee_amount  = body.fee_amount  !== undefined ? round2(num(body.fee_amount, 0))  : estimateFee(gross_amount, payment_provider, settings);
    let net_amount  = body.net_amount  !== undefined ? round2(num(body.net_amount, 0))  : round2(gross_amount - fee_amount);

    const payment_type   = String(body.payment_type   || PAYMENT_TYPE.FINAL).trim();
    const payment_method = String(body.payment_method || body.method || "").trim();
    const collected_by   = String(body.collected_by   || "admin").trim();
    const external_reference_id = String(body.external_reference_id || body.reference || "").trim();
    const note           = String(body.note || "").trim();

    const rid = genRequestId();
    const now = new Date().toISOString();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "Missing CRM_SHEET_ID." });

    // Load Invoices to find the invoice row
    const invResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Invoices!A1:ZZ5000",
    });
    const invValues = invResp.data.values || [];
    if (invValues.length <= 1) return json(res, 404, { ok: false, error: "Invoice not found." });

    const invHeaders = invValues[0].map(h => String(h || "").trim());
    const idCol = invHeaders.indexOf("id");
    if (idCol < 0) return json(res, 500, { ok: false, error: "Invoices sheet missing id column." });

    let invRowIndex = -1;
    for (let r = 1; r < invValues.length; r++) {
      if (String(invValues[r][idCol] || "").trim() === invoice_id) { invRowIndex = r; break; }
    }
    if (invRowIndex < 0) return json(res, 404, { ok: false, error: "Invoice not found." });

    const inv = {};
    for (let i = 0; i < invHeaders.length; i++) {
      inv[invHeaders[i]] = invValues[invRowIndex][i] != null ? String(invValues[invRowIndex][i]) : "";
    }

    const status = normalize(inv.status_code);
    if (status === "void") return json(res, 409, { ok: false, code: "VOID", message: "Cannot add payments to a void invoice." });

    const client_id = String(inv.client_id || "").trim();
    const lead_id   = String(body.lead_id || inv.lead_id || "").trim();

    const paymentDateInput = String(body.payment_date || "").trim();
    const paymentDate = paymentDateInput || now.slice(0, 10);
    const received_at = String(body.received_at || now).trim();

    // Append payment row with full financial model
    const payment_id = "PAY-" + Date.now();
    const payRowObj = {
      id:                   payment_id,
      created_at:           now,
      invoice_id,
      lead_id,
      client_id,
      payment_type,
      payment_provider,
      payment_method,
      gross_amount:         String(gross_amount),
      fee_amount:           String(fee_amount),
      net_amount:           String(net_amount),
      collected_by,
      received_at,
      verified_at:          String(body.verified_at || ""),
      external_reference_id,
      reference:            external_reference_id,
      note,
      payment_date:         paymentDate,
      // Legacy compat fields
      amount:               String(gross_amount),
      method:               payment_method,
      provider_ref:         "",
    };

    const payHeadersResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Payments!1:1",
    });
    const payHeaders = (payHeadersResp.data.values && payHeadersResp.data.values[0]) || [];
    const payRow = payHeaders.map(h => payRowObj[String(h || "").trim()] ?? "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Payments!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [payRow] },
    });

    logAudit({
      actor: collected_by,
      action: "CREATE_PAYMENT",
      entity_type: "payment",
      entity_id: payment_id,
      field: "gross_amount",
      new_value: String(gross_amount),
      note: `invoice_id=${invoice_id} provider=${payment_provider} type=${payment_type} fee=${fee_amount} net=${net_amount}`,
      source: "crm",
      request_id: rid,
    });

    // Recompute paid_amount for invoice based on ALL Payments rows
    const payments = await readTab("Payments");
    const myPayments = payments.filter(p => String(p.invoice_id || "").trim() === invoice_id);
    const paid_amount = round2(myPayments.reduce((s, p) => s + num(p.gross_amount || p.amount, 0), 0));

    const total = round2(num(inv.total, 0));
    const deposit_applied = round2(num(inv.deposit_applied, 0));
    const balance_due = round2(Math.max(0, total - deposit_applied - paid_amount));

    // Write back to invoice row
    const sheetRow = invRowIndex + 1;
    const invUpdates = [];
    function setInvCell(field, value) {
      const ci = invHeaders.indexOf(field);
      if (ci < 0) return;
      invUpdates.push({ range: `Invoices!${colLetter(ci)}${sheetRow}`, values: [[String(value)]] });
      inv[field] = String(value);
    }

    setInvCell("paid_amount", paid_amount);
    setInvCell("balance_due", balance_due);
    setInvCell("updated_at", now);

    const currentStatus = normalize(inv.status_code);
    let newInvStatus = null;
    if (balance_due <= 0) {
      newInvStatus = "paid";
    } else if (paid_amount > 0) {
      newInvStatus = payment_type === PAYMENT_TYPE.DEPOSIT ? "deposit_received" : "partial";
    }

    if (newInvStatus && newInvStatus !== currentStatus) {
      setInvCell("status_code", newInvStatus);
      if (newInvStatus === "paid") setInvCell("paid_at", now);
      logAudit({
        actor: collected_by,
        action: "UPDATE_INVOICE",
        entity_type: "invoice",
        entity_id: invoice_id,
        field: "status_code",
        old_value: currentStatus,
        new_value: newInvStatus,
        note: `Auto-status after payment (balance_due=${balance_due})`,
        source: "crm",
        request_id: rid,
      });
    }

    if (invUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: invUpdates },
      });
    }

    // Derive and update Leads.payment_status
    const leadPaymentStatus = deriveLeadPaymentStatus(balance_due, paid_amount, payment_type, payment_method);
    setImmediate(() => {
      updateLeadFinancials(sheets, spreadsheetId, lead_id, payment_provider, fee_amount, net_amount, leadPaymentStatus)
        .catch(err => console.error("[payments] lead financials update:", err.message));
    });

    if (client_id) touchClient(client_id).catch(() => {});

    json(res, 201, {
      ok: true,
      payment_id,
      invoice_id,
      lead_id,
      gross_amount,
      fee_amount,
      net_amount,
      paid_amount,
      balance_due,
      payment_status: leadPaymentStatus,
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleCreatePayment };
