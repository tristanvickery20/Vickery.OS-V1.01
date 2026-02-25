// api/invoices.js
const url = require("url");
const { readTab } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");
const { getConfig } = require("../lib/config");

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

/* =========================
   GET LIST
========================= */
async function handleGetInvoices(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const status = normalize(parsed.query.status);
    const q = normalize(parsed.query.q);

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
        client_name: client.name || "",
        property_address: prop.address_line1 || "",
        total: inv.total || "0",
        balance_due: inv.balance_due || "0",
        issued_at: inv.issued_at || inv.created_at || "",
        due_at: inv.due_at || "",
        overdue,
      };
    });

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
   CREATE
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

    const paid_amount = 0;
    const balance_due = round2(total - deposit_applied);

    const invoice_number =
      "INV-" +
      String(new Date().getTime()).slice(-6);

    const id = "INV-" + Date.now();

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
      issued_at: now,
      due_at: body.due_at || "",
      subtotal: String(subtotal),
      tax_rate: String(tax_rate),
      tax_amount: String(tax_amount),
      total: String(total),
      paid_amount: String(paid_amount),
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
    };

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!1:1",
    });
    const headers = headersResp.data.values[0];

    const row = headers.map((h) => rowObj[h] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Invoices!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    logAudit({
      actor: "admin",
      action: "CREATE_INVOICE",
      entity_type: "invoice",
      entity_id: id,
      source: "crm",
      request_id: rid,
    });

    if (reqRow.client_id) {
      touchClient(reqRow.client_id).catch(() => {});
    }

    json(res, 201, { ok: true, invoice_id: id });
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
   UPDATE (Draft/Sent/Void)
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
      range: "Invoices!A1:Z5000",
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

module.exports = {
  handleGetInvoices,
  handleCreateInvoice,
  handleGetInvoiceById,
  handleUpdateInvoice,
};