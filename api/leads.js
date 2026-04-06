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

// Canonical lead source categories — normalize any incoming value to the nearest match
const CANONICAL_SOURCES = [
  "GBP", "Organic SEO", "LSA", "Google Ads", "Direct",
  "Referral", "Yard Sign", "Truck Wrap", "Repeat Customer",
  "Facebook", "Manual Outreach", "Other",
];

function normalizeLeadSource(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (!s) return "";
  // Exact match first (case-insensitive)
  const exact = CANONICAL_SOURCES.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  // Partial/keyword match
  const sl = s.toLowerCase();
  if (sl.includes("gbp") || sl.includes("google business") || sl.includes("google maps")) return "GBP";
  if (sl.includes("lsa") || sl.includes("local service")) return "LSA";
  if (sl.includes("google ad")) return "Google Ads";
  if (sl.includes("organic") || sl.includes("seo")) return "Organic SEO";
  if (sl.includes("facebook") || sl.includes("fb") || sl.includes("meta")) return "Facebook";
  if (sl.includes("referral") || sl.includes("referred") || sl.includes("word of mouth")) return "Referral";
  if (sl.includes("yard sign") || sl.includes("sign")) return "Yard Sign";
  if (sl.includes("truck") || sl.includes("wrap") || sl.includes("van")) return "Truck Wrap";
  if (sl.includes("repeat") || sl.includes("returning") || sl.includes("previous")) return "Repeat Customer";
  if (sl.includes("direct") || sl.includes("walk") || sl.includes("call")) return "Direct";
  if (sl.includes("outreach") || sl.includes("door") || sl.includes("hanger")) return "Manual Outreach";
  return "Other";
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

    // Read Clients tab (CRM-created), legacy Leads tab (quoter-created), Time, Expenses, Config, Snapshots, Bookings
    const [clientsData, leadsTabData, timeData, expData, config, snapshotsData, bookingsData] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "Clients!A1:ZZ5000"),
      fetchTabRows(sheets, spreadsheetId, "Leads!A1:Z5000"),
      fetchTabRows(sheets, spreadsheetId, "Time!A1:H2000"),
      fetchTabRows(sheets, spreadsheetId, "Expenses!A1:J2000"),
      getConfig(),
      fetchTabRows(sheets, spreadsheetId, "QuoteSnapshots!A:U").catch(() => ({ headers: [], rows: [] })),
      fetchTabRows(sheets, spreadsheetId, "Bookings!A:P").catch(() => ({ headers: [], rows: [] })),
    ]);

    const idx = toIndexMap(clientsData.headers);

    const laborRateTech = Number(config.labor_rate_tech || 50);
    const { laborMinutesByLead, expenseCostByLead } = buildFinancialLookups(timeData, expData);

    // Build leads from Clients tab
    const clientLeads = (clientsData.rows || [])
      .filter((r) => r && r.length && String(getCellByHeader(r, idx, "id") || "").trim() !== "")
      .map((r) => {
        const leadId = String(getCellByHeader(r, idx, "lead_id") || "").trim() || String(getCellByHeader(r, idx, "id") || "").trim();
        const createdAt = String(getCellByHeader(r, idx, "created_at") || "");
        const statusCode = String(getCellByHeader(r, idx, "status_code") || "");

        const lead = {
          id: leadId,
          _raw_id: String(getCellByHeader(r, idx, "id") || ""),
          _source: "clients",
          created_at: createdAt,
          name: String(getCellByHeader(r, idx, "name") || ""),
          phone: String(getCellByHeader(r, idx, "phone") || ""),
          address: String(getCellByHeader(r, idx, "primary_address") || getCellByHeader(r, idx, "address") || ""),
          job_type: "",
          deposit_required: false,
          estimated_value: parseNum(getCellByHeader(r, idx, "estimated_value") || 0),
          status: statusCode || String(getCellByHeader(r, idx, "status") || ""),
          status_code: statusCode,
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
          sms_opt_in: String(getCellByHeader(r, idx, "sms_opt_in") || ""),
          lead_id: String(getCellByHeader(r, idx, "lead_id") || ""),
          job_number: String(getCellByHeader(r, idx, "job_number") || ""),
        };
        attachFinancials(lead, laborMinutesByLead, expenseCostByLead, laborRateTech);
        return lead;
      });

    // Track all IDs already covered by Clients tab to avoid duplicates
    const coveredIds = new Set();
    for (const l of clientLeads) {
      coveredIds.add(l.id);
      if (l.lead_id) coveredIds.add(l.lead_id);
      if (l._raw_id) coveredIds.add(l._raw_id);
    }

    // Build leads from the legacy Leads tab (quoter-created records not already in Clients)
    const lidx = toIndexMap(leadsTabData.headers);
    const legacyLeads = (leadsTabData.rows || [])
      .filter((r) => {
        if (!r || !r.length) return false;
        const rawId = String(getCellByHeader(r, lidx, "id") || "").trim();
        return rawId !== "" && !coveredIds.has(rawId);
      })
      .map((r) => {
        const rawId = String(getCellByHeader(r, lidx, "id") || "").trim();
        const statusRaw = String(getCellByHeader(r, lidx, "status") || "");

        const lead = {
          id: rawId,
          _raw_id: rawId,
          _source: "leads_tab",
          created_at: String(getCellByHeader(r, lidx, "created_at") || ""),
          name: String(getCellByHeader(r, lidx, "name") || ""),
          phone: String(getCellByHeader(r, lidx, "phone") || ""),
          address: String(getCellByHeader(r, lidx, "address") || ""),
          job_type: String(getCellByHeader(r, lidx, "job_type") || ""),
          deposit_required: false,
          estimated_value: parseNum(getCellByHeader(r, lidx, "estimated_value") || 0),
          status: statusRaw,
          status_code: statusRaw,
          quoted_price: parseNum(getCellByHeader(r, lidx, "quoted_price") || 0),
          deposit_received: 0,
          invoiced_amount: 0,
          paid_amount: 0,
          scheduled_date: String(getCellByHeader(r, lidx, "scheduled_date") || ""),
          assigned_to: String(getCellByHeader(r, lidx, "assigned_to") || ""),
          notes: String(getCellByHeader(r, lidx, "notes") || ""),
          schedule_window: "",
          schedule_preference: "",
          duration_minutes: 0,
          deposit_override: false,
          invoice_date: "",
          paid_date: "",
          pricing_version: String(getCellByHeader(r, lidx, "pricing_version") || ""),
          last_quote_id: String(getCellByHeader(r, lidx, "last_quote_id") || ""),
          quote_snapshot_json: "",
          email: String(getCellByHeader(r, lidx, "email") || ""),
          job_description: String(getCellByHeader(r, lidx, "job_description") || ""),
          sms_opt_in: "",
          lead_id: rawId,
          job_number: "",
        };
        attachFinancials(lead, laborMinutesByLead, expenseCostByLead, laborRateTech);
        return lead;
      });

    // Build QuoteSnapshot lookup — two indexes:
    //   1. by quote_id  (for leads that have last_quote_id set)
    //   2. by phone     (fallback — phone is always captured)
    // Prefer "locked" event rows so we get the name the customer typed at lock time.
    const snapIdx       = toIndexMap(snapshotsData.headers);
    const snapByQuoteId = {};
    const snapByPhone   = {};
    for (const r of (snapshotsData.rows || [])) {
      const qid     = String(getCellByHeader(r, snapIdx, "quote_id")      || "").trim();
      const evtType = String(getCellByHeader(r, snapIdx, "event_type")    || "");
      const sName   = String(getCellByHeader(r, snapIdx, "customer_name") || "").trim();
      const sPhone  = String(getCellByHeader(r, snapIdx, "phone")         || "").replace(/\D/g, "");
      const sEmail  = String(getCellByHeader(r, snapIdx, "email")         || "").trim();
      const sAddr   = String(getCellByHeader(r, snapIdx, "address")       || "").trim();
      const entry   = { name: sName, phone: sPhone, email: sEmail, address: sAddr };

      if (qid && (!snapByQuoteId[qid] || evtType === "locked")) {
        snapByQuoteId[qid] = entry;
      }
      if (sPhone && sName && (!snapByPhone[sPhone] || evtType === "locked")) {
        snapByPhone[sPhone] = entry;
      }
    }

    // Also index Bookings by quote_id → { name, phone, email, address }
    // Bookings is the source the Schedule page uses — guaranteed to have the name.
    const bkIdx        = toIndexMap(bookingsData.headers);
    const bookingByQuoteId = {};
    const bookingByPhone   = {};
    // schedByQuoteId stores the LATEST non-cancelled booking per quote_id for scheduling enrichment
    const schedByQuoteId   = {};
    for (const r of (bookingsData.rows || [])) {
      const bqid  = String(getCellByHeader(r, bkIdx, "quote_id")          || "").trim();
      const bName = String(getCellByHeader(r, bkIdx, "customer_name")     || "").trim();
      const bPh   = String(getCellByHeader(r, bkIdx, "phone")             || "").replace(/\D/g, "");
      const bAddr = String(getCellByHeader(r, bkIdx, "address")           || "").trim();
      const bEmail= String(getCellByHeader(r, bkIdx, "email")             || "").trim();
      const bStat = String(getCellByHeader(r, bkIdx, "status")            || "").toLowerCase();
      const bDt   = String(getCellByHeader(r, bkIdx, "scheduled_datetime")|| "").trim();
      const bBlk  = String(getCellByHeader(r, bkIdx, "schedule_block")    || "").trim();
      const bDur  = String(getCellByHeader(r, bkIdx, "duration_minutes")  || "").trim();
      const bEntry = { name: bName, phone: bPh, email: bEmail, address: bAddr };
      if (bqid && bName && !bookingByQuoteId[bqid]) bookingByQuoteId[bqid] = bEntry;
      if (bPh  && bName && !bookingByPhone[bPh])    bookingByPhone[bPh]    = bEntry;
      // Only index scheduling for active (non-cancelled) bookings
      if (bqid && bDt && bStat !== "cancelled" && !schedByQuoteId[bqid]) {
        schedByQuoteId[bqid] = { scheduled_datetime: bDt, schedule_block: bBlk, duration_minutes: bDur };
      }
    }

    // Enrich any lead missing contact info or scheduling:
    // Priority: 1) quote_id in snapshots  2) phone in snapshots  3) quote_id in bookings  4) phone in bookings
    const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").trim();
    for (const lead of [...clientLeads, ...legacyLeads]) {
      // Strip any HTML that may have been stored in phone/email/name
      lead.name    = stripHtml(lead.name);
      lead.phone   = stripHtml(lead.phone);
      lead.email   = stripHtml(lead.email);
      lead.address = stripHtml(lead.address);

      // Enrich contact fields
      const cleanLeadPhone = lead.phone.replace(/\D/g, "");
      const src =
        (lead.last_quote_id && snapByQuoteId[lead.last_quote_id]) ||
        (cleanLeadPhone      && snapByPhone[cleanLeadPhone])       ||
        (lead.last_quote_id && bookingByQuoteId[lead.last_quote_id]) ||
        (cleanLeadPhone      && bookingByPhone[cleanLeadPhone]);
      if (src) {
        if (!lead.name    && src.name)    lead.name    = src.name;
        if (!lead.phone   && src.phone)   lead.phone   = src.phone;
        if (!lead.email   && src.email)   lead.email   = src.email;
        if (!lead.address && src.address) lead.address = src.address;
      }

      // Enrich scheduling from Bookings (fills in what updateLeadSchedule may have missed)
      if (lead.last_quote_id && schedByQuoteId[lead.last_quote_id]) {
        const sched = schedByQuoteId[lead.last_quote_id];
        if (!lead.scheduled_date || lead.scheduled_date === "") {
          // Extract date portion from ISO datetime e.g. "2026-04-10T13:00:00"
          lead.scheduled_date = sched.scheduled_datetime.slice(0, 10);
        }
        if (!lead.schedule_window || lead.schedule_window === "") {
          lead.schedule_window = sched.schedule_block;
        }
        if (!lead.duration_minutes || lead.duration_minutes === 0) {
          lead.duration_minutes = Number(sched.duration_minutes) || 0;
        }
        // If lead status is still "New" but there's a booking, upgrade to Scheduled
        if (lead.status && lead.status.toLowerCase() === "new") {
          lead.status = "Scheduled";
        }
      }
    }

    const leads = [...clientLeads, ...legacyLeads]
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

      // Marketing attribution fields (normalize source to canonical set)
      setCellByHeader(row, idx, "lead_source", normalizeLeadSource(data.lead_source));
      setCellByHeader(row, idx, "referring_customer", data.referring_customer || "");

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

// ── Lead snapshot breakdown ──────────────────────────────────────────────────
// GET /api/lead-snapshot?quote_id=XXX
// Returns the customer's quote answers resolved to human-readable labels,
// plus pricing summary, for display on the CRM lead detail page.
async function handleGetLeadSnapshot(req, res) {
  try {
    const qs       = new URL(req.url, "http://x").searchParams;
    const quoteId  = (qs.get("quote_id") || "").trim();
    if (!quoteId) return json400(res, "quote_id required");

    const sheets        = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const [snapData, estCfg] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "QuoteSnapshots!A:U"),
      require("../lib/estimatorModulesConfig").getEstimatorConfig().catch(() => ({ modulesById: {}, services: [] })),
    ]);

    const { modulesById, services } = estCfg;

    // Assembly-ID → Service-ID fallback map (snapshot stores e.g. "A001", labels use "RECESSED_LIGHTING")
    let ASSEMBLY_TO_SERVICE = {};
    try { ASSEMBLY_TO_SERVICE = require("../lib/serviceClassification").ASSEMBLY_TO_SERVICE || {}; } catch { /* ignore */ }

    // Find best snapshot row — prefer "locked" event, otherwise any row for that quote_id
    const allRows = (snapData.rows || []).map(r => {
      const obj = {};
      (snapData.headers || []).forEach((h, i) => { obj[String(h).trim()] = String(r[i] ?? ""); });
      return obj;
    }).filter(r => r.quote_id === quoteId);

    const snap = allRows.find(r => r.event_type === "locked") || allRows[allRows.length - 1];
    if (!snap) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Snapshot not found" }));
    }

    // Resolve job type label — snapshot may store assembly ID ("A001") or service_id ("RECESSED_LIGHTING")
    const resolvedServiceId = ASSEMBLY_TO_SERVICE[snap.job_type_id] || snap.job_type_id;
    const svc = (services || []).find(s => s.service_id === resolvedServiceId);
    const jobTypeLabel = svc ? svc.service_name : resolvedServiceId || "Unknown Service";

    // Parse selected_options_json — shape: { answers: { MODULE_ID: "value" }, qty, classification }
    let answers = {};
    let qty = 1;
    let classification = "";
    let selectedAddons = [];
    try {
      const raw = JSON.parse(snap.selected_options_json || "{}");
      if (Array.isArray(raw)) {
        // Old format — nothing useful to show
      } else {
        answers        = raw.answers        || {};
        qty            = raw.qty            || 1;
        classification = raw.classification || "";
      }
    } catch { /* ignore */ }

    try { selectedAddons = JSON.parse(snap.selected_addons_json || "[]"); } catch { selectedAddons = []; }

    // Modules to suppress (photo uploads / internal only)
    const SKIP_MODULES = new Set(["WORK_AREA_PHOTOS", "PANEL_PHOTO", "UNCERTAINTY_BUFFER"]);

    // Resolve each answer to a human-readable Q&A pair
    const qaLines = [];
    for (const [moduleId, value] of Object.entries(answers)) {
      if (!value || value === "_unsure" || value === "" || SKIP_MODULES.has(moduleId)) continue;
      const mod = modulesById[moduleId];
      const question = mod ? mod.question : moduleId.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      let answer = String(value);
      if (mod && mod.options && mod.options.length) {
        const opt = mod.options.find(o => o.value === value || o.option_id === value);
        if (opt) answer = opt.label || String(value);
      }
      qaLines.push({ question, answer });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      quote_id:       snap.quote_id,
      job_type_id:    snap.job_type_id,
      job_type_label: jobTypeLabel,
      qty:            Number(qty) || 1,
      classification,
      customer_name:  snap.customer_name,
      phone:          snap.phone,
      email:          snap.email,
      address:        snap.address,
      notes:          snap.notes,
      pricing: {
        final_price:        parseNum(snap.final_price),
        total_hours:        parseNum(snap.total_hours),
        labor_cost:         parseNum(snap.labor_cost),
        material_allowance: parseNum(snap.material_allowance),
        travel_fee:         parseNum(snap.travel_fee),
        overhead_cost:      parseNum(snap.overhead_cost),
      },
      answers: qaLines,
      addons: selectedAddons,
    }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

function json400(res, msg) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: msg }));
}

module.exports = { handleCreateLead, handleGetLeads, handleGetLeadSnapshot };