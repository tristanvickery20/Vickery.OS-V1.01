const { getSheetsClient } = require("../lib/sheets");
const { getConfig }       = require("../lib/config");
const { getCrewSession }  = require("../lib/staff");
const { isAuthed }        = require("../lib/auth");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function fetchTabRows(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map((h) => String(h || "").trim().toLowerCase());
  const rows = values.slice(1).filter((r) => r && r.some((c) => String(c || "").trim() !== ""));
  return { headers, rows };
}

function getCell(row, headers, col) {
  const i = headers.indexOf(col);
  return i >= 0 ? String(row[i] ?? "") : "";
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(dateA, dateB) {
  const ms = Math.abs(dateB.getTime() - dateA.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function bonusTier(collectedRevenue) {
  if (collectedRevenue < 1000) return { label: "< $1k", amount: 50 };
  if (collectedRevenue < 5000) return { label: "$1k – $4,999", amount: 100 };
  return { label: "$5k+", amount: 150 };
}

const MATERIAL_TYPES = new Set(["material", "materials", "parts", "part", "equipment", "supply", "supplies"]);
const PERMIT_TYPES   = new Set(["permit", "permits", "inspection", "fee", "fees"]);
const SUB_TYPES      = new Set(["subcontractor", "sub", "subcontract"]);

async function handleBonusEligibility(req, res) {
  function json(code, data) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  const url       = new URL(req.url, "http://localhost");
  const leadId    = (url.searchParams.get("lead_id")    || "").trim();
  let   quoteId   = (url.searchParams.get("quote_id")   || "").trim();
  const bookingId = (url.searchParams.get("booking_id") || "").trim();
  if (!leadId && !quoteId && !bookingId) {
    return json(400, { ok: false, error: "lead_id, quote_id, or booking_id is required" });
  }

  // Auth: crew sessions may only query their own assigned jobs (must provide booking_id)
  const crewSession = getCrewSession(req);
  const crmAdmin    = isAuthed(req);
  if (crewSession && !crmAdmin && !bookingId) {
    return json(403, { ok: false, error: "Crew sessions must provide booking_id" });
  }

  try {
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;

    const [config, timeData, expData, leadsData, attachData, invoicesData, bookingsData] = await Promise.all([
      getConfig(),
      fetchTabRows(sheets, sid, "TimeEntries!A1:L2000"),
      fetchTabRows(sheets, sid, "Expenses!A1:J2000"),
      fetchTabRows(sheets, sid, "Leads!A1:BZ5000"),
      fetchTabRows(sheets, sid, "Attachments!A1:K5000").catch(() => ({ headers: [], rows: [] })),
      fetchTabRows(sheets, sid, "Invoices!A1:ZZ5000").catch(() => ({ headers: [], rows: [] })),
      bookingId
        ? fetchTabRows(sheets, sid, "Bookings!A1:ZZ2000").catch(() => ({ headers: [], rows: [] }))
        : Promise.resolve({ headers: [], rows: [] }),
    ]);
    // Leads are self-contained — clientsData alias points to leadsData
    const clientsData = leadsData;

    // ── Booking path: verify ownership + resolve quoteId ──
    if (bookingId) {
      const bIdx = {};
      (bookingsData.headers || []).forEach((h, i) => { bIdx[h] = i; });
      const bRow = (bookingsData.rows || []).find((r) =>
        String(r[bIdx["booking_id"]] ?? "").trim() === bookingId
      );
      if (crewSession && !crmAdmin) {
        // Crew sessions must be assigned to this booking
        if (!bRow) return json(403, { ok: false, error: "Booking not found or not authorized" });
        const techId  = String(bRow[bIdx["assigned_tech_id"]] ?? "").trim();
        const techIds = String(bRow[bIdx["assigned_tech_ids"]] ?? "").trim();
        const mine    = techId === crewSession.staffId
          || techIds.split(",").map((s) => s.trim()).includes(crewSession.staffId);
        if (!mine) return json(403, { ok: false, error: "Not authorized to view this job's bonus data" });
      }
      // Resolve quoteId from booking if not already provided
      if (bRow && !quoteId) {
        quoteId = String(bRow[bIdx["quote_id"]] ?? "").trim();
      }
    }

    const laborRateTech = num(config.labor_rate_tech || 50);
    const burdenPct     = num(config.burden_pct     || 0);
    const loadedRate    = laborRateTech * (1 + burdenPct / 100);

    // ── Lead record: search Clients tab first, then fall back to legacy Leads tab ──
    const cIdx = {};
    (clientsData.headers || []).forEach((h, i) => { cIdx[h] = i; });
    let lead     = null;
    let leadIdxMap = cIdx; // active column index map

    for (const row of clientsData.rows || []) {
      const lid  = String(row[cIdx["lead_id"]]      ?? "").trim();
      const id2  = String(row[cIdx["id"]]           ?? "").trim();
      const lqid = String(row[cIdx["last_quote_id"]]?? "").trim();
      const matches = (leadId  && (lid === leadId  || id2  === leadId))
                   || (quoteId && (lqid === quoteId || lid  === quoteId || id2 === quoteId));
      if (matches) { lead = row; break; }
    }

    // Fallback: search legacy Leads tab (for jobs not yet migrated to Clients)
    if (!lead) {
      const lIdx = {};
      (leadsData.headers || []).forEach((h, i) => { lIdx[h] = i; });
      for (const row of leadsData.rows || []) {
        const lid  = String(row[lIdx["id"]] ?? "").trim();
        const lqid = String(row[lIdx["last_quote_id"]] ?? row[lIdx["quote_id"]] ?? "").trim();
        const matches = (leadId  && lid  === leadId)
                     || (quoteId && (lqid === quoteId || lid === quoteId));
        if (matches) { lead = row; leadIdxMap = lIdx; break; }
      }
    }

    // Canonical lead ID used for Time/Expense/Attachment lookups
    const resolvedLeadId = lead
      ? (String(lead[leadIdxMap["lead_id"]] ?? lead[leadIdxMap["id"]] ?? "").trim() || leadId || quoteId)
      : (leadId || quoteId);

    // ── Time: sum WORK minutes for this lead (exclude drive/admin) ──
    const tLeadIdx  = timeData.headers.indexOf("lead_id");
    const tMinIdx   = timeData.headers.indexOf("minutes");
    const tCatIdx   = timeData.headers.indexOf("category");
    const NON_WORK  = new Set(["drive", "travel", "admin", "overhead"]);
    let totalMinutes  = 0;
    let timeEntries   = 0;
    if (tLeadIdx >= 0 && tMinIdx >= 0) {
      for (const row of timeData.rows) {
        const rowLid = String(row[tLeadIdx] || "").trim();
        if (rowLid !== resolvedLeadId) continue;
        const cat = tCatIdx >= 0 ? String(row[tCatIdx] || "").trim().toLowerCase() : "";
        if (NON_WORK.has(cat)) continue;
        totalMinutes += num(row[tMinIdx]);
        timeEntries++;
      }
    }
    const laborCost = Math.round(((totalMinutes / 60) * loadedRate) * 100) / 100;

    // ── Expenses: split by type for this lead ──
    const eLeadIdx = expData.headers.indexOf("lead_id");
    const eAmtIdx  = expData.headers.indexOf("amount");
    const eTypeIdx = expData.headers.indexOf("type");
    let directMaterials = 0;
    let directPermits   = 0;
    let directSub       = 0;
    if (eLeadIdx >= 0 && eAmtIdx >= 0) {
      for (const row of expData.rows) {
        if (String(row[eLeadIdx] || "").trim() !== resolvedLeadId) continue;
        const amt  = num(row[eAmtIdx]);
        const type = String(row[eTypeIdx] || "").trim().toLowerCase();
        if (MATERIAL_TYPES.has(type))    directMaterials += amt;
        else if (PERMIT_TYPES.has(type)) directPermits   += amt;
        else if (SUB_TYPES.has(type))    directSub       += amt;
      }
    }
    directMaterials = Math.round(directMaterials * 100) / 100;
    directPermits   = Math.round(directPermits * 100) / 100;
    directSub       = Math.round(directSub * 100) / 100;
    const directJobCost = Math.round((laborCost + directMaterials + directPermits + directSub) * 100) / 100;

    // ── Attachments: count photos for this lead ──
    let photoCount = 0;
    const aEntityIdIdx = attachData.headers.indexOf("entity_id");
    const aFileUrlIdx  = attachData.headers.indexOf("file_url");
    if (aEntityIdIdx >= 0) {
      for (const row of attachData.rows) {
        if (String(row[aEntityIdIdx] || "").trim() !== resolvedLeadId) continue;
        const url2 = String(row[aFileUrlIdx] || "").toLowerCase();
        if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(url2)) photoCount++;
      }
    }

    // ── Collected revenue: sum paid_amount from Invoices tab for this lead/booking ──
    // Matches by lead_id (canonical) OR booking_id (crew path — booking_id on invoice is exact match)
    const iLeadIdx = invoicesData.headers.indexOf("lead_id");
    const iPaidIdx = invoicesData.headers.indexOf("paid_amount");
    const iBkgIdx  = invoicesData.headers.indexOf("booking_id");
    let collectedRevenue = 0;
    if (iPaidIdx >= 0) {
      for (const row of invoicesData.rows) {
        const invLead = iLeadIdx >= 0 ? String(row[iLeadIdx] || "").trim() : "";
        const invBkg  = iBkgIdx  >= 0 ? String(row[iBkgIdx]  || "").trim() : "";
        const matches = (invLead && invLead === resolvedLeadId)
                     || (bookingId && invBkg === bookingId);
        if (!matches) continue;
        collectedRevenue += num(row[iPaidIdx]);
      }
    }
    collectedRevenue = Math.round(collectedRevenue * 100) / 100;

    // Use leadIdxMap (points to Clients or Leads tab, whichever matched)
    const leadStatus = lead ? String(lead[leadIdxMap["status_code"]] || lead[leadIdxMap["status"]] || "").toLowerCase() : "";
    const isComplete = ["complete", "closed", "paid"].includes(leadStatus);
    const unauthorizedDeviation = lead
      ? (String(lead[leadIdxMap["unauthorized_deviation"]] || "").toLowerCase() === "true")
      : false;

    // Completion date: prefer completed_at → paid_date → scheduled_date
    // completed_at is the canonical job-completion timestamp; paid_date marks when payment cleared;
    // scheduled_date is a last-resort proxy only (forward-looking, may pre-date actual completion).
    const completionDateStr = lead
      ? (String(lead[leadIdxMap["completed_at"]] || "") || String(lead[leadIdxMap["paid_date"]] || "") || String(lead[leadIdxMap["scheduled_date"]] || ""))
      : "";
    const completionDate = parseDate(completionDateStr);
    const now = new Date();
    const daysSinceCompletion = completionDate ? daysBetween(completionDate, now) : null;

    // ── Gross margin ──
    const grossMarginPct = collectedRevenue > 0
      ? Math.round(((collectedRevenue - directJobCost) / collectedRevenue) * 10000) / 100
      : null;

    // ── 4 bonus tests ──
    const marginOk = grossMarginPct !== null && grossMarginPct >= 40;
    const docOk    = timeEntries > 0 && photoCount >= 1;
    const budgetOk = !unauthorizedDeviation;

    // quality_ok = job done AND 14-day window has passed
    let qualityStatus = "pending";
    if (!isComplete) {
      qualityStatus = "not_complete";
    } else if (daysSinceCompletion !== null && daysSinceCompletion >= 14) {
      qualityStatus = "passed";
    } else {
      qualityStatus = "window_open";
    }
    const qualityOk = qualityStatus === "passed";

    const allPass    = marginOk && docOk && qualityOk && budgetOk;
    const tier       = allPass ? bonusTier(collectedRevenue) : null;
    const bonusAmt   = tier ? tier.amount : 0;

    // ── Compute overall status ──
    let status;
    if (!isComplete)               status = "not_complete";
    else if (!marginOk)            status = "margin_fail";
    else if (!docOk)               status = "doc_fail";
    else if (!budgetOk)            status = "budget_fail";
    else if (!qualityOk)           status = "pending_quality";
    else                           status = "earned";

    const daysRemainingInWindow = (isComplete && qualityStatus === "window_open" && daysSinceCompletion !== null)
      ? Math.max(0, Math.ceil(14 - daysSinceCompletion))
      : null;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      lead_id:               resolvedLeadId,
      loaded_rate:           loadedRate,
      total_minutes:         totalMinutes,
      time_entries:          timeEntries,
      labor_cost:            laborCost,
      direct_materials:      directMaterials,
      direct_permits:        directPermits,
      direct_sub:            directSub,
      direct_job_cost:       directJobCost,
      collected_revenue:     collectedRevenue,
      gross_margin_pct:      grossMarginPct,
      photo_count:           photoCount,
      completion_date:       completionDateStr || null,
      days_since_completion: daysSinceCompletion !== null ? Math.floor(daysSinceCompletion) : null,
      days_remaining_in_quality_window: daysRemainingInWindow,
      is_complete:           isComplete,
      tests: {
        margin_ok:  marginOk,
        doc_ok:     docOk,
        quality_ok: qualityOk,
        budget_ok:  budgetOk,
      },
      all_pass:    allPass,
      bonus_amount: bonusAmt,
      bonus_tier:   tier,
      status,
    }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleBonusEligibility };
