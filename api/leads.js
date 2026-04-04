// api/leads.js (UNIFIED: writes/reads from Clients tab)
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { getConfig } = require("../lib/config");

function nowIso() {
  return new Date().toISOString();
}

function newLeadId() {
  return "LEAD-" + Date.now();
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function normalizeStr(v) {
  return String(v || "").trim();
}

function parseNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchTabRows(sheets, spreadsheetId, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = resp.data.values || [];
    if (values.length < 2) return { headers: values[0] || [], rows: [] };
    return { headers: values[0], rows: values.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function buildFinancialLookups(timeData, expData) {
  const timeHeaders = timeData.headers || [];
  const tLeadIdx = timeHeaders.indexOf("lead_id");
  const tMinIdx = timeHeaders.indexOf("minutes");

  const laborMinutesByLead = {};
  if (tLeadIdx >= 0 && tMinIdx >= 0) {
    for (const row of timeData.rows || []) {
      const lid = String(row[tLeadIdx] || "").trim();
      if (!lid) continue;
      laborMinutesByLead[lid] = (laborMinutesByLead[lid] || 0) + Number(row[tMinIdx] || 0);
    }
  }

  const expHeaders = expData.headers || [];
  const eLeadIdx = expHeaders.indexOf("lead_id");
  const eAmtIdx = expHeaders.indexOf("amount");

  const expenseCostByLead = {};
  if (eLeadIdx >= 0 && eAmtIdx >= 0) {
    for (const row of expData.rows || []) {
      const lid = String(row[eLeadIdx] || "").trim();
      if (!lid) continue;
      expenseCostByLead[lid] = (expenseCostByLead[lid] || 0) + Number(row[eAmtIdx] || 0);
    }
  }

  return { laborMinutesByLead, expenseCostByLead };
}

function attachFinancials(lead, laborMinutesByLead, expenseCostByLead, laborRateTech) {
  const totalMinutes = laborMinutesByLead[lead.id] || 0;
  const laborCost = Math.round(((totalMinutes / 60) * laborRateTech) * 100) / 100;
  const expenseCost = Math.round((expenseCostByLead[lead.id] || 0) * 100) / 100;
  const totalCost = Math.round((laborCost + expenseCost) * 100) / 100;

  const revenue = lead.invoiced_amount > 0 ? lead.invoiced_amount : lead.quoted_price;
  const grossProfit = Math.round((revenue - totalCost) * 100) / 100;
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : null;

  lead.labor_cost = laborCost;
  lead.expense_cost = expenseCost;
  lead.total_cost = totalCost;
  lead.gross_profit = grossProfit;
  lead.gross_margin_pct = grossMarginPct;
}

function toIndexMap(headers) {
  const map = {};
  (headers || []).forEach((h, i) => {
    const key = String(h || "").trim();
    if (key) map[key] = i;
  });
  return map;
}

function getCellByHeader(row, idxMap, header) {
  const idx = idxMap[header];
  if (idx === undefined) return "";
  return row?.[idx] ?? "";
}

function setCellByHeader(row, idxMap, header, value) {
  const idx = idxMap[header];
  if (idx === undefined) return; // header not present; we won't crash
  while (row.length <= idx) row.push("");
  row[idx] = value;
}

function nextCId(existingClientIds) {
  // expects ids like C-0001
  let maxN = 0;
  for (const id of existingClientIds) {
    const m = String(id || "").match(/^C-(\d+)$/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) maxN = Math.max(maxN, n);
  }
  return "C-" + pad4(maxN + 1);
}

function nextJobNumber(existingJobNums) {
  // expects J-0001
  let maxN = 0;
  for (const j of existingJobNums) {
    const m = String(j || "").match(/^J-(\d+)$/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) maxN = Math.max(maxN, n);
  }
  return "J-" + pad4(maxN + 1);
}

async function handleGetLeads(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    // We now treat "Leads" view as a pipeline view of Clients.
    const [clientsData, timeData, expData, config] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "Clients!A1:ZZ5000"),
      fetchTabRows(sheets, spreadsheetId, "Time!A1:H2000"),
      fetchTabRows(sheets, spreadsheetId, "Expenses!A1:J2000"),
      getConfig(),
    ]);

    const idx = toIndexMap(clientsData.headers);

    const laborRateTech = Number(config.labor_rate_tech || 50);
    const { laborMinutesByLead, expenseCostByLead } = buildFinancialLookups(timeData, expData);

    const leads = (clientsData.rows || [])
      .filter((r) => r && r.length && String(getCellByHeader(r, idx, "id") || "").trim() !== "")
      .map((r) => {
        // Important: lead.id must match Time/Expenses lead_id.
        const leadId = String(getCellByHeader(r, idx, "lead_id") || "").trim() || String(getCellByHeader(r, idx, "id") || "").trim();

        const createdAt = String(getCellByHeader(r, idx, "created_at") || "");
        const statusCode = String(getCellByHeader(r, idx, "status_code") || "");

        const lead = {
          id: leadId,
          created_at: createdAt,
          name: String(getCellByHeader(r, idx, "name") || ""),
          phone: String(getCellByHeader(r, idx, "phone") || ""),
          address: String(getCellByHeader(r, idx, "primary_address") || ""), // optional column if you add later
          job_type: "",

          // keep old shape so existing UI doesn't explode
          deposit_required: false,
          estimated_value: parseNum(getCellByHeader(r, idx, "estimated_value") || 0),

          // old UI expects "status"
          status: statusCode || "",

          quoted_price: parseNum(getCellByHeader(r, idx, "quoted_price") || 0),
          deposit_received: parseNum(getCellByHeader(r, idx, "deposit_received") || 0),
          invoiced_amount: parseNum(getCellByHeader(r, idx, "invoiced_amount") || 0),
          paid_amount: parseNum(getCellByHeader(r, idx, "paid_amount") || 0),

          scheduled_date: String(getCellByHeader(r, idx, "scheduled_date") || ""),
          assigned_to: String(getCellByHeader(r, idx, "assigned_to") || ""),
          notes: String(getCellByHeader(r, idx, "notes") || ""),
          schedule_window: String(getCellByHeader(r, idx, "schedule_window") || ""),
          schedule_preference: String(getCellByHeader(r, idx, "schedule_preference") || ""),
          duration_minutes: parseNum(getCellByHeader(r, idx, "duration_minutes") || 0),
          deposit_override: String(getCellByHeader(r, idx, "deposit_override") || "").toLowerCase() === "true",
          invoice_date: String(getCellByHeader(r, idx, "invoice_date") || ""),
          paid_date: String(getCellByHeader(r, idx, "paid_date") || ""),
          pricing_version: String(getCellByHeader(r, idx, "pricing_version") || ""),
          last_quote_id: String(getCellByHeader(r, idx, "last_quote_id") || ""),
          quote_snapshot_json: String(getCellByHeader(r, idx, "quote_snapshot_json") || ""),

          email: String(getCellByHeader(r, idx, "email") || ""),
          job_description: String(getCellByHeader(r, idx, "job_description") || ""),
          status_code: statusCode,
          sms_opt_in: String(getCellByHeader(r, idx, "sms_opt_in") || ""),

          // extra fields you already started showing on /clients
          lead_id: String(getCellByHeader(r, idx, "lead_id") || ""),
          job_number: String(getCellByHeader(r, idx, "job_number") || ""),
        };

        attachFinancials(lead, laborMinutesByLead, expenseCostByLead, laborRateTech);
        return lead;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, leads }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Lead Get Error: " + error.message);
  }
}

async function handleCreateLead(req, res) {
  try {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const data = body ? JSON.parse(body) : {};

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      // Read Clients so we can safely generate next C-#### and J-####.
      const clientsData = await fetchTabRows(sheets, spreadsheetId, "Clients!A1:ZZ5000");
      const headers = clientsData.headers || [];
      const idx = toIndexMap(headers);

      const existingClientIds = (clientsData.rows || []).map((r) => getCellByHeader(r, idx, "id"));
      const existingJobNums = (clientsData.rows || []).map((r) => getCellByHeader(r, idx, "job_number"));

      const clientId = nextCId(existingClientIds);
      const jobNumber = nextJobNumber(existingJobNums);
      const leadId = newLeadId();
      const createdAt = nowIso();

      // Build a row that matches existing header length (so we don't misalign).
      const row = new Array(headers.length).fill("");

      // Required core fields (from your Ticket 10 schema)
      setCellByHeader(row, idx, "id", clientId);
      setCellByHeader(row, idx, "created_at", createdAt);
      setCellByHeader(row, idx, "updated_at", createdAt);
      setCellByHeader(row, idx, "name", normalizeStr(data.name));
      setCellByHeader(row, idx, "phone", normalizeStr(data.phone));
      setCellByHeader(row, idx, "email", normalizeStr(data.email));
      setCellByHeader(row, idx, "sms_opt_in", data.sms_opt_in ? String(data.sms_opt_in) : "");
      setCellByHeader(row, idx, "job_description", data.job_description || data.notes || "");
      setCellByHeader(row, idx, "status_code", data.status_code || "awaiting_response");
      setCellByHeader(row, idx, "last_activity_at", createdAt);

      // Unified/pipeline extras (if headers exist)
      setCellByHeader(row, idx, "lead_id", leadId);
      setCellByHeader(row, idx, "job_number", jobNumber);
      setCellByHeader(row, idx, "assigned_to", data.assigned_to || "");
      setCellByHeader(row, idx, "scheduled_date", data.scheduled_date || "");
      setCellByHeader(row, idx, "estimated_value", String(Number(data.estimated_value || 0)));
      setCellByHeader(row, idx, "notes", data.notes || "");

      // Optional shortcut if you add later
      if (idx["primary_address"] !== undefined) {
        setCellByHeader(row, idx, "primary_address", data.address || "");
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Clients!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [row] },
      });

      // Return a "lead" object so existing callers don't break
      const lead = {
        id: leadId,            // important for Time/Expenses lead_id compatibility
        client_id: clientId,   // new linkage
        job_number: jobNumber,
        created_at: createdAt,
        name: normalizeStr(data.name),
        phone: normalizeStr(data.phone),
        address: data.address || "",
        job_type: data.job_type || "small_job",
        deposit_required: false,
        estimated_value: Number(data.estimated_value || 0),
        status: data.status_code || "awaiting_response",
        quoted_price: Number(data.quoted_price || 0),
        deposit_received: Number(data.deposit_received || 0),
        invoiced_amount: Number(data.invoiced_amount || 0),
        paid_amount: Number(data.paid_amount || 0),
        scheduled_date: data.scheduled_date || "",
        assigned_to: data.assigned_to || "",
        notes: data.notes || "",
        schedule_window: data.schedule_window || "",
        schedule_preference: data.schedule_preference || "",
        duration_minutes: Number(data.duration_minutes || 0),
        deposit_override: Boolean(data.deposit_override),
        invoice_date: "",
        paid_date: "",
        pricing_version: data.pricing_version || "",
        last_quote_id: data.last_quote_id || "",
        quote_snapshot_json: data.quote_snapshot_json || "",
      };

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, lead }));

      logAudit({
        action: "client.create_unified",
        entity_type: "client",
        entity_id: clientId,
        field: "*",
        new_value: JSON.stringify({
          client_id: clientId,
          lead_id: leadId,
          job_number: jobNumber,
          name: lead.name,
          phone: lead.phone,
          status_code: data.status_code || "awaiting_response",
          estimated_value: lead.estimated_value,
        }),
        source: "crm-new",
        request_id: genRequestId(),
      }).catch(() => {});
    });
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Lead Create Error: " + error.message);
  }
}

module.exports = { handleCreateLead, handleGetLeads };