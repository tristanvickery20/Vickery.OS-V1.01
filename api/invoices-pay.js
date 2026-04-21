// api/invoices-pay.js
// POST /api/invoice/pay  — public Square payment endpoint (no CRM auth required)
// Body: { token: "<public_token>", source_id: "<square_nonce>", amount_cents: 12345 }

const https = require("https");
const { readTab } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit } = require("../lib/audit");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function round2(n) { return Math.round(n * 100) / 100; }

function colLetter(c) {
  if (c < 26) return String.fromCharCode(65 + c);
  return String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
}

function squareRequest(method, path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: "connect.squareup.com",
      port: 443,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": "2024-01-18",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", (c) => (data += c));
      resp.on("end", () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: resp.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function handlePublicPay(req, res) {
  const accessToken  = process.env.SQUARE_ACCESS_TOKEN  || "";
  const locationId   = process.env.SQUARE_LOCATION_ID   || "";

  const appId = process.env.SQUARE_APP_ID || "";
  if (!accessToken || !locationId || !appId) {
    const missing = [!appId && "SQUARE_APP_ID", !locationId && "SQUARE_LOCATION_ID", !accessToken && "SQUARE_ACCESS_TOKEN"].filter(Boolean).join(", ");
    console.warn("[invoices-pay] Missing Square env vars:", missing);
    return json(res, 503, {
      ok: false,
      error: "Online payment is not configured yet. Please call (409) 554-3392 to pay.",
    });
  }

  try {
    const body = await readBody(req);
    const { token, source_id, amount_cents } = body;

    if (!token || typeof token !== "string" || token.length < 8) {
      return json(res, 400, { ok: false, error: "Invalid invoice token." });
    }
    if (!source_id || typeof source_id !== "string") {
      return json(res, 400, { ok: false, error: "Payment source required." });
    }
    const amountCents = parseInt(amount_cents, 10);
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      return json(res, 400, { ok: false, error: "Invalid payment amount." });
    }

    const invoices = await readTab("Invoices");
    const inv = invoices.find((i) => i.public_token === token);
    if (!inv) return json(res, 404, { ok: false, error: "Invoice not found." });

    const sc = String(inv.status_code || "").toLowerCase();
    if (sc === "paid") {
      return json(res, 409, { ok: false, error: "This invoice is already paid." });
    }
    if (sc === "void") {
      return json(res, 409, { ok: false, error: "This invoice is void and cannot be paid." });
    }

    const balance = round2(Number(inv.balance_due || 0));
    if (balance <= 0) {
      return json(res, 409, { ok: false, error: "No balance due on this invoice." });
    }

    // Charge must match balance due (to the cent)
    const expectedCents = Math.round(balance * 100);
    if (amountCents !== expectedCents) {
      return json(res, 400, {
        ok: false,
        error: `Amount mismatch. Expected ${expectedCents} cents, got ${amountCents}.`,
      });
    }

    // Deterministic idempotency key: same source_id on same invoice always yields
    // the same key — prevents duplicate charges on retries before sheet update flips status.
    const idempotencyKey = `inv-${inv.id}-${source_id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
    const squareResp = await squareRequest(
      "POST",
      "/v2/payments",
      {
        idempotency_key: idempotencyKey,
        source_id,
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: locationId,
        reference_id: inv.invoice_number || inv.id,
        note: `Invoice ${inv.invoice_number || inv.id} — Vickery Electric`,
      },
      accessToken
    );

    if (squareResp.status !== 200 || !squareResp.body?.payment) {
      const errMsg =
        squareResp.body?.errors?.[0]?.detail ||
        squareResp.body?.errors?.[0]?.code ||
        "Payment declined. Please try again or call (409) 554-3392.";
      console.error("[invoices-pay] Square error:", JSON.stringify(squareResp.body));
      return json(res, 402, { ok: false, error: errMsg });
    }

    const payment = squareResp.body.payment;
    const paymentId = payment.id;
    const now = new Date().toISOString();
    const newPaid = round2(Number(inv.paid_amount || 0) + balance);

    // Update invoice in sheet
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:AZ5000",
    });
    const values = resp.data.values || [];
    const headers = values[0] || [];
    const idCol = headers.indexOf("id");

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || "") === inv.id) { rowIndex = r; break; }
    }

    if (rowIndex >= 0) {
      const sheetRow = rowIndex + 1;
      const updates = [];
      const setCell = (field, value) => {
        const ci = headers.indexOf(field);
        if (ci >= 0) updates.push({ range: `Invoices!${colLetter(ci)}${sheetRow}`, values: [[String(value)]] });
      };

      setCell("status_code",   "paid");
      setCell("paid_amount",   String(newPaid));
      setCell("balance_due",   "0");
      setCell("paid_at",       now);
      setCell("updated_at",    now);
      setCell("payment_ref",   paymentId);
      setCell("payment_method","card");

      if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: updates },
        });
      }
    }

    logAudit({
      actor:       "customer",
      action:      "ONLINE_PAYMENT",
      entity_type: "invoice",
      entity_id:   inv.id,
      note:        `square_id=${paymentId} amount=${balance} token=${token.slice(0, 8)}…`,
      source:      "public",
    });

    json(res, 200, {
      ok: true,
      payment_id: paymentId,
      amount_paid: balance,
      invoice_number: inv.invoice_number || inv.id,
    });
  } catch (err) {
    console.error("[invoices-pay]", err.message);
    json(res, 500, { ok: false, error: "Payment processing error. Please call (409) 554-3392." });
  }
}

module.exports = { handlePublicPay };
