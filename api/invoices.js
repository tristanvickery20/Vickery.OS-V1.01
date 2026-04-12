// api/invoices.js
const url = require("url");
const crypto = require("crypto");
const { readTab } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");
const { getConfig } = require("../lib/config");
const provider = require("../lib/accounting");
const { sendSms, buildMessage, INVOICE_TEMPLATES } = require("../lib/sms");

function genPublicToken() {
  return crypto.randomBytes(16).toString("hex");
}

function getPublicBaseUrl() {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "";
  if (domain) return `https://${domain}`;
  return "";
}

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

// Parse sheet row number from Google Sheets updatedRange like "Invoices!A150:Z150"
function parseInsertedRow(updatedRange) {
  if (!updatedRange) return -1;
  const m = updatedRange.match(/!A(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

// After appending a row, update provider_ref and provider_name cells in-place
async function backfillProviderRef(sheets, spreadsheetId, headers, insertedRow, providerRef, providerName) {
  if (insertedRow < 1 || !providerRef) return;
  const updates = [];
  const setField = (field, value) => {
    const ci = headers.indexOf(field);
    if (ci >= 0) updates.push({ range: `Invoices!${colLetter(ci)}${insertedRow}`, values: [[String(value)]] });
  };
  setField("provider_ref", providerRef);
  setField("provider_name", providerName || "");
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    }).catch(err => console.error("[invoice] provider_ref backfill failed:", err.message));
  }
}

/* =========================
   GET LIST
   Supports ?status=, ?q=, ?client_id=, ?lead_id=
========================= */
async function handleGetInvoices(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const status    = normalize(parsed.query.status);
    const q         = normalize(parsed.query.q);
    const clientId  = normalize(parsed.query.client_id);
    const leadId    = normalize(parsed.query.lead_id);

    const [invoices, clients, properties] = await Promise.all([
      readTab("Invoices"),
      readTab("Clients"),
      readTab("Properties"),
    ]);

    const clientMap = {};
    for (const c of clients) clientMap[c.id] = c;

    const propMap = {};
    for (const p of properties) propMap[p.id] = p;

    let rows = invoices.map((inv) => {
      const client = clientMap[inv.client_id] || {};
      const prop = propMap[inv.property_id] || {};

      const balance = num(inv.balance_due, 0);
      const due = inv.due_at ? new Date(inv.due_at) : null;
      const overdue =
        normalize(inv.status_code) === "sent" &&
        due &&
        due < new Date() &&
        balance > 0;

      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        status_code: inv.status_code,
        client_id: inv.client_id || "",
        lead_id: inv.lead_id || "",
        client_name: client.name || "",
        property_address: prop.address_line1 || "",
        total: inv.total || "0",
        paid_amount: inv.paid_amount || "0",
        balance_due: inv.balance_due || "0",
        deposit_applied: inv.deposit_applied || "0",
        issued_at: inv.issued_at || inv.created_at || "",
        sent_at: inv.sent_at || "",
        paid_at: inv.paid_at || "",
        due_at: inv.due_at || "",
        notes: inv.notes || "",
        provider_ref: inv.provider_ref || "",
        provider_name: inv.provider_name || "",
        subtotal: inv.subtotal || "0",
        tax_rate: inv.tax_rate || "0",
        tax_amount: inv.tax_amount || "0",
        overdue,
      };
    });

    // Filters
    if (clientId) {
      rows = rows.filter((r) => normalize(r.client_id) === clientId);
    }
    if (leadId) {
      rows = rows.filter((r) => normalize(r.lead_id) === leadId);
    }
    if (status && status !== "all") {
      if (status === "overdue") {
        rows = rows.filter((r) => r.overdue);
      } else {
        rows = rows.filter((r) => normalize(r.status_code) === status);
      }
    }
    if (q) {
      rows = rows.filter((r) =>
        [r.invoice_number, r.client_name, r.property_address]
          .some((f) => normalize(f).includes(q))
      );
    }

    rows.sort((a, b) =>
      new Date(b.issued_at || 0) - new Date(a.issued_at || 0)
    );

    json(res, 200, { ok: true, invoices: rows });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   CREATE (from Request/client model)
   Order: validate → write CRM row → call provider → backfill provider_ref
========================= */
async function handleCreateInvoice(req, res) {
  try {
    const body = await readBody(req);
    const request_id = String(body.request_id || "").trim();
    if (!request_id) {
      return json(res, 400, { ok: false, error: "request_id required." });
    }

    const rid = genRequestId();
    const now = new Date().toISOString();

    const [requests, invoices, config] = await Promise.all([
      readTab("Requests"),
      readTab("Invoices"),
      getConfig(),
    ]);

    const reqRow = requests.find((r) => r.id === request_id);
    if (!reqRow) {
      return json(res, 404, { ok: false, error: "Request not found." });
    }

    if (normalize(reqRow.status_code) !== "complete") {
      return json(res, 409, {
        ok: false,
        code: "REQUIRES_COMPLETE",
        message: "Request must be Complete before invoicing.",
      });
    }

    const subtotal = round2(num(body.subtotal, NaN));
    if (!isFinite(subtotal) || subtotal <= 0) {
      return json(res, 400, { ok: false, error: "Invalid subtotal." });
    }

    const tax_rate = round2(num(body.tax_rate, 0));
    const tax_amount = round2(subtotal * (tax_rate / 100));
    const total = round2(subtotal + tax_amount);

    const deposit_received = round2(num(reqRow.deposit_received, 0));
    const deposit_applied =
      body.deposit_applied !== undefined
        ? round2(num(body.deposit_applied, 0))
        : Math.min(deposit_received, total);

    const balance_due = round2(total - deposit_applied);

    const invoice_number = "INV-" + String(new Date().getTime()).slice(-6);
    const id = "INV-" + Date.now();

    // Step 1: Write CRM row first (provider_ref blank — will be backfilled)
    const rowObj = {
      id,
      created_at: now,
      updated_at: now,
      invoice_number,
      status_code: "draft",
      client_id: reqRow.client_id,
      property_id: reqRow.property_id,
      request_id,
      job_id: "",
      lead_id: "",
      issued_at: now,
      due_at: body.due_at || "",
      subtotal: String(subtotal),
      tax_rate: String(tax_rate),
      tax_amount: String(tax_amount),
      total: String(total),
      paid_amount: "0",
      balance_due: String(balance_due),
      deposit_applied: String(deposit_applied),
      notes: String(body.notes || ""),
      snapshot_json: JSON.stringify({
        request_summary: reqRow.summary,
        created_at: now,
      }),
      sent_at: "",
      paid_at: "",
      void_at: "",
      provider_ref: "",
      provider_name: "",
    };

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!1:1",
    });
    const headers = headersResp.data.values[0];
    const row = headers.map((h) => rowObj[h] != null ? rowObj[h] : "");

    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Invoices!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    const insertedRow = parseInsertedRow(
      appendResult.data.updates && appendResult.data.updates.updatedRange
    );

    // Step 2: Call accounting provider
    const providerResult = await provider.createInvoice({
      invoice_number,
      invoice_id: id,
      customer_name: reqRow.client_id || "",
      total,
      subtotal,
      tax_amount,
      notes: String(body.notes || ""),
      line_items: [{ description: reqRow.summary || "Services", amount: subtotal }],
    }).catch(() => ({ ok: false, provider_ref: "" }));

    // Step 3: Backfill provider_ref into the row we just appended
    if (providerResult.ok && providerResult.provider_ref && insertedRow > 0) {
      await backfillProviderRef(sheets, spreadsheetId, headers, insertedRow, providerResult.provider_ref, provider.name);
    }

    logAudit({
      actor: "admin",
      action: "CREATE_INVOICE",
      entity_type: "invoice",
      entity_id: id,
      note: `provider=${provider.name} ref=${providerResult.provider_ref || "none"}`,
      source: "crm",
      request_id: rid,
    });

    if (reqRow.client_id) {
      touchClient(reqRow.client_id).catch(() => {});
    }

    json(res, 201, {
      ok: true,
      invoice_id: id,
      invoice_number,
      provider_ref: providerResult.provider_ref || "",
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   CREATE FROM LEAD (old Leads model — no request_id required)
   Also works for client-only invoices (pass client_id, omit lead_id)
   Order: validate → write CRM row → call provider → backfill provider_ref
========================= */
async function handleCreateInvoiceFromLead(req, res) {
  try {
    const body = await readBody(req);
    const lead_id  = String(body.lead_id  || "").trim();
    const client_id = String(body.client_id || "").trim();

    if (!lead_id && !client_id) {
      return json(res, 400, { ok: false, error: "lead_id or client_id required." });
    }

    const subtotal = round2(num(body.subtotal, NaN));
    if (!isFinite(subtotal) || subtotal <= 0) {
      return json(res, 400, { ok: false, error: "subtotal must be a positive number." });
    }

    const rid = genRequestId();
    const now = new Date().toISOString();
    const tax_rate = round2(num(body.tax_rate, 0));
    const tax_amount = round2(subtotal * (tax_rate / 100));
    const total = round2(subtotal + tax_amount);
    const deposit_applied = round2(Math.min(num(body.deposit_applied, 0), total));
    const balance_due = round2(Math.max(0, total - deposit_applied));

    const invoice_number = "INV-" + String(new Date().getTime()).slice(-6);
    const id = "INV-" + Date.now();
    const customerName = String(body.customer_name || lead_id || client_id);

    // Step 1: Write CRM row first (provider_ref blank — will be backfilled)
    const rowObj = {
      id,
      created_at: now,
      updated_at: now,
      invoice_number,
      status_code: "draft",
      client_id,
      property_id: "",
      request_id: "",
      job_id: "",
      lead_id,
      issued_at: now,
      due_at: String(body.due_at || ""),
      subtotal: String(subtotal),
      tax_rate: String(tax_rate),
      tax_amount: String(tax_amount),
      total: String(total),
      paid_amount: "0",
      balance_due: String(balance_due),
      deposit_applied: String(deposit_applied),
      notes: String(body.notes || ""),
      snapshot_json: JSON.stringify({
        lead_id: lead_id || null,
        customer_name: customerName,
        created_at: now,
      }),
      sent_at: "",
      paid_at: "",
      void_at: "",
      provider_ref: "",
      provider_name: "",
    };

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!1:1",
    });
    const headers = headersResp.data.values[0];
    const row = headers.map((h) => rowObj[h] != null ? rowObj[h] : "");

    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Invoices!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    const insertedRow = parseInsertedRow(
      appendResult.data.updates && appendResult.data.updates.updatedRange
    );

    // Step 2: Call accounting provider
    const providerResult = await provider.createInvoice({
      invoice_number,
      invoice_id: id,
      customer_name: customerName,
      total,
      subtotal,
      tax_amount,
      notes: String(body.notes || ""),
      line_items: [{ description: "Electrical Services", amount: subtotal }],
    }).catch(() => ({ ok: false, provider_ref: "" }));

    // Step 3: Backfill provider_ref into the appended row
    if (providerResult.ok && providerResult.provider_ref && insertedRow > 0) {
      await backfillProviderRef(sheets, spreadsheetId, headers, insertedRow, providerResult.provider_ref, provider.name);
    }

    logAudit({
      actor: "admin",
      action: "CREATE_INVOICE",
      entity_type: "invoice",
      entity_id: id,
      note: `lead_id=${lead_id || "—"} client_id=${client_id || "—"} provider=${provider.name} ref=${providerResult.provider_ref || "none"}`,
      source: "crm",
      request_id: rid,
    });

    if (client_id) touchClient(client_id).catch(() => {});

    json(res, 201, {
      ok: true,
      invoice_id: id,
      invoice_number,
      provider_ref: providerResult.provider_ref || "",
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   SEND INVOICE — POST /api/invoices/:id/send
========================= */
async function handleSendInvoice(req, res) {
  try {
    const clean = req.url.replace(/\?.*$/, "");
    const id = decodeURIComponent(
      clean.replace("/api/invoices/", "").replace("/send", "")
    );
    const rid = genRequestId();
    const now = new Date().toISOString();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:AZ5000",
    });
    const values = resp.data.values || [];
    if (values.length <= 1) return json(res, 404, { ok: false, error: "Not found." });

    const headers = values[0];
    const idCol = headers.indexOf("id");

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || "") === id) { rowIndex = r; break; }
    }
    if (rowIndex < 0) return json(res, 404, { ok: false, error: "Invoice not found." });

    const inv = {};
    for (let i = 0; i < headers.length; i++) {
      inv[headers[i]] = values[rowIndex][i] != null ? String(values[rowIndex][i]) : "";
    }

    if (normalize(inv.status_code) === "void") {
      return json(res, 409, { ok: false, code: "VOID", message: "Cannot send a void invoice." });
    }

    // Ensure public_token exists (generate if missing)
    let publicToken = inv.public_token || "";
    if (!publicToken) {
      publicToken = genPublicToken();
    }
    const baseUrl = getPublicBaseUrl();
    const publicUrl = baseUrl
      ? `${baseUrl}/invoice/${publicToken}`
      : `/invoice/${publicToken}`;

    // Call accounting provider to send the invoice
    await provider.sendInvoice({
      provider_ref:   inv.provider_ref    || "",
      invoice_number: inv.invoice_number  || "",
      customer_name:  inv.customer_name   || "",
      customer_email: inv.email_sent_to   || "",
    }).catch(() => {});

    const sheetRow = rowIndex + 1;
    const updates = [];

    const setCell = (field, value) => {
      const ci = headers.indexOf(field);
      if (ci < 0) return;
      updates.push({
        range: `Invoices!${colLetter(ci)}${sheetRow}`,
        values: [[String(value)]],
      });
    };

    setCell("status_code", "sent");
    setCell("sent_at",     now);
    setCell("updated_at",  now);
    setCell("public_token", publicToken);

    // SMS the customer if phone is on file
    let smsSent = false;
    const customerPhone = inv.customer_phone || "";
    if (customerPhone) {
      const body = buildMessage(INVOICE_TEMPLATES.INVOICE_CUSTOMER, {
        invoice_number: inv.invoice_number || id,
        invoice_url:    publicUrl,
      });
      smsSent = await sendSms(customerPhone, body).catch(() => false);
      if (smsSent) {
        setCell("sms_sent_at", now);
        setCell("sms_sent_to", customerPhone);
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    logAudit({
      actor:       "admin",
      action:      "SEND_INVOICE",
      entity_type: "invoice",
      entity_id:   id,
      note:        `sms=${smsSent} phone=${customerPhone || "none"} url=${publicUrl}`,
      source:      "crm",
      request_id:  rid,
    });

    json(res, 200, { ok: true, sent_at: now, public_url: publicUrl, sms_sent: smsSent });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   SYNC INVOICE STATUS — POST /api/invoices/:id/sync-status
   Calls provider.getInvoiceStatus and updates local status if changed.
========================= */
async function handleSyncInvoiceStatus(req, res) {
  try {
    const clean = req.url.replace(/\?.*$/, "");
    const id = decodeURIComponent(
      clean.replace("/api/invoices/", "").replace("/sync-status", "")
    );
    const rid = genRequestId();
    const now = new Date().toISOString();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:AZ5000",
    });
    const values = resp.data.values || [];
    if (values.length <= 1) return json(res, 404, { ok: false, error: "Not found." });

    const headers = values[0];
    const idCol = headers.indexOf("id");

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || "") === id) { rowIndex = r; break; }
    }
    if (rowIndex < 0) return json(res, 404, { ok: false, error: "Invoice not found." });

    const inv = {};
    for (let i = 0; i < headers.length; i++) {
      inv[headers[i]] = values[rowIndex][i] != null ? String(values[rowIndex][i]) : "";
    }

    const providerResult = await provider.getInvoiceStatus({
      provider_ref: inv.provider_ref || "",
    }).catch(() => ({ ok: false }));

    if (!providerResult.ok) {
      return json(res, 200, { ok: true, synced: false, reason: "provider_unavailable", local_status: inv.status_code });
    }

    const providerStatus = normalize(providerResult.status);
    const localStatus = normalize(inv.status_code);

    // Map provider status to our internal statuses
    const STATUS_MAP = { draft: "draft", sent: "sent", paid: "paid", void: "void" };
    const mappedStatus = STATUS_MAP[providerStatus] || localStatus;

    if (mappedStatus === localStatus) {
      return json(res, 200, { ok: true, synced: true, status_code: localStatus, changed: false });
    }

    const sheetRow = rowIndex + 1;
    const updates = [];
    const setCell = (field, value) => {
      const ci = headers.indexOf(field);
      if (ci >= 0) updates.push({ range: `Invoices!${colLetter(ci)}${sheetRow}`, values: [[String(value)]] });
    };

    setCell("status_code", mappedStatus);
    setCell("updated_at", now);
    if (mappedStatus === "paid" && !inv.paid_at) setCell("paid_at", now);

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    logAudit({
      actor: "system",
      action: "SYNC_INVOICE_STATUS",
      entity_type: "invoice",
      entity_id: id,
      field: "status_code",
      old_value: localStatus,
      new_value: mappedStatus,
      note: `provider=${provider.name}`,
      source: "crm",
      request_id: rid,
    });

    json(res, 200, { ok: true, synced: true, status_code: mappedStatus, changed: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   GET DETAIL
========================= */
async function handleGetInvoiceById(req, res) {
  try {
    const id = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/invoices/", "")
    );

    const invoices = await readTab("Invoices");
    const inv = invoices.find((i) => i.id === id);

    if (!inv) return json(res, 404, { ok: false, error: "Not found." });

    json(res, 200, { ok: true, invoice: inv });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   UPDATE (notes / status_code only)
========================= */
async function handleUpdateInvoice(req, res) {
  try {
    const id = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/invoices/", "")
    );
    const body = await readBody(req);
    const rid = genRequestId();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:AZ5000",
    });

    const values = resp.data.values || [];
    if (values.length <= 1) {
      return json(res, 404, { ok: false, error: "Not found." });
    }

    const headers = values[0];
    const idCol = headers.indexOf("id");

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (values[r][idCol] === id) {
        rowIndex = r;
        break;
      }
    }

    if (rowIndex < 0) {
      return json(res, 404, { ok: false, error: "Not found." });
    }

    const sheetRow = rowIndex + 1;
    const updates = [];

    for (const key of ["notes", "status_code"]) {
      if (body[key] !== undefined) {
        const col = headers.indexOf(key);
        if (col >= 0) {
          updates.push({
            range: `Invoices!${colLetter(col)}${sheetRow}`,
            values: [[String(body[key])]],
          });
        }
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates,
        },
      });

      logAudit({
        actor: "admin",
        action: "UPDATE_INVOICE",
        entity_type: "invoice",
        entity_id: id,
        source: "crm",
        request_id: rid,
      });
    }

    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   PUBLIC INVOICE — GET /api/invoice/public/:token
   No auth required — used by the public /invoice/:token page
========================= */
async function handlePublicInvoice(req, res) {
  try {
    const token = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/invoice/public/", "")
    ).trim();
    if (!token || token.length < 8) {
      return json(res, 404, { ok: false, error: "Invalid token." });
    }

    const [invoices, clients, properties] = await Promise.all([
      readTab("Invoices"),
      readTab("Clients").catch(() => []),
      readTab("Properties").catch(() => []),
    ]);

    const inv = invoices.find(i => i.public_token === token);
    if (!inv) return json(res, 404, { ok: false, error: "Invoice not found." });

    const client = clients.find(c => c.id === inv.client_id) || {};
    const prop   = properties.find(p => p.id === inv.property_id) || {};

    const config = await getConfig().catch(() => ({}));

    // Return safe public subset (no internal tokens, no staff data)
    const out = {
      id:                inv.id,
      invoice_number:    inv.invoice_number,
      status_code:       inv.status_code,
      issued_at:         inv.issued_at,
      due_at:            inv.due_at,
      service_date:      inv.service_date || "",
      tech_name:         inv.tech_name || "",
      customer_name:     inv.customer_name || client.name || "",
      // Omit phone/email from public response for privacy
      service_address:   prop.address_line1 ? [prop.address_line1, prop.city, prop.state].filter(Boolean).join(", ") : "",
      property_address:  prop.address_line1 || "",
      subtotal:          inv.subtotal || "0",
      tax_rate:          inv.tax_rate  || "0",
      tax_amount:        inv.tax_amount|| "0",
      total:             inv.total     || "0",
      paid_amount:       inv.paid_amount    || "0",
      balance_due:       inv.balance_due    || "0",
      deposit_applied:   inv.deposit_applied|| "0",
      original_total:    inv.original_total || inv.total || "0",
      notes:             inv.notes || "",
      line_items_json:   inv.line_items_json    || "[]",
      change_orders_json:inv.change_orders_json || "[]",
    };

    const reviewUrl = config.google_review_url || process.env.GOOGLE_REVIEW_URL || "";

    json(res, 200, { ok: true, invoice: out, review_url: reviewUrl });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   ADD CHANGE ORDER — POST /api/invoices/:id/change-order
   Body: { description, amount, type: "add"|"deduct", created_by? }
========================= */
async function handleAddChangeOrder(req, res) {
  try {
    const id = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/invoices/", "").replace("/change-order", "")
    );
    const body = await readBody(req);

    const description = String(body.description || "").trim();
    const amount      = parseFloat(body.amount || 0);
    const type        = String(body.type || "add").toLowerCase() === "deduct" ? "deduct" : "add";
    const created_by  = String(body.created_by || "admin").trim();

    if (!description) return json(res, 400, { ok: false, error: "description required." });
    if (!isFinite(amount) || amount <= 0) return json(res, 400, { ok: false, error: "amount must be a positive number." });

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const now = new Date().toISOString();

    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Invoices!A1:AZ5000" });
    const values = resp.data.values || [];
    if (values.length <= 1) return json(res, 404, { ok: false, error: "Not found." });

    const headers = values[0];
    const idCol   = headers.indexOf("id");

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || "") === id) { rowIndex = r; break; }
    }
    if (rowIndex < 0) return json(res, 404, { ok: false, error: "Invoice not found." });

    const inv = {};
    for (let i = 0; i < headers.length; i++) {
      inv[headers[i]] = values[rowIndex][i] != null ? String(values[rowIndex][i]) : "";
    }

    if (normalize(inv.status_code) === "void") {
      return json(res, 409, { ok: false, error: "Cannot modify a void invoice." });
    }

    // Preserve original_total before the first change order
    const originalTotal = parseFloat(inv.original_total || inv.total || 0);

    // Parse and append change order
    const existingCOs = (() => { try { return JSON.parse(inv.change_orders_json || "[]"); } catch { return []; } })();
    const newCO = {
      id:           "CO-" + Date.now(),
      description,
      amount:       String(amount),
      type,
      created_at:   now,
      created_by,
    };
    existingCOs.push(newCO);

    // Recalculate total from original_total + all change orders
    const coTotal = existingCOs.reduce((sum, co) => {
      return sum + (co.type === "deduct" ? -Math.abs(parseFloat(co.amount||0)) : Math.abs(parseFloat(co.amount||0)));
    }, 0);
    const newTotal   = round2(originalTotal + coTotal);
    const depApplied = parseFloat(inv.deposit_applied || 0);
    const paidAmt    = parseFloat(inv.paid_amount     || 0);
    const newBalance = round2(Math.max(0, newTotal - depApplied - paidAmt));

    const sheetRow = rowIndex + 1;
    const updates  = [];
    const setCell  = (field, value) => {
      const ci = headers.indexOf(field);
      if (ci >= 0) updates.push({ range: `Invoices!${colLetter(ci)}${sheetRow}`, values: [[String(value)]] });
    };

    setCell("change_orders_json", JSON.stringify(existingCOs));
    setCell("total",              String(newTotal));
    setCell("balance_due",        String(newBalance));
    setCell("updated_at",         now);
    if (!inv.original_total) setCell("original_total", inv.total || "0");

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    logAudit({
      actor:       created_by,
      action:      "ADD_CHANGE_ORDER",
      entity_type: "invoice",
      entity_id:   id,
      note:        `${type} $${amount}: ${description}`,
      source:      "crm",
    });

    json(res, 200, { ok: true, change_order: newCO, new_total: newTotal, new_balance: newBalance });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetInvoices,
  handleCreateInvoice,
  handleCreateInvoiceFromLead,
  handleSendInvoice,
  handleSyncInvoiceStatus,
  handleGetInvoiceById,
  handleUpdateInvoice,
  handlePublicInvoice,
  handleAddChangeOrder,
};
