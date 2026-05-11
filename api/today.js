// api/today.js — /api/today and /api/week endpoints for the Today/This Week dashboard
const { getSheetsClient } = require("../lib/sheets");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(str.includes("T") ? str : str + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateStr(d) {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateString, days) {
  const base = new Date(dateString + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + days);
  return dateStr(base);
}

async function fetchRows(sheets, spreadsheetId, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const vals = resp.data.values || [];
    if (vals.length < 2) return { headers: vals[0] || [], rows: [] };
    return { headers: vals[0], rows: vals.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function mapRow(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
  return obj;
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, "_");
}

function hasHeader(data, names) {
  const headers = data.headers || [];
  return names.some((n) => headers.includes(n));
}

function firstValue(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== "") return row[n];
  }
  return "";
}

function moneyValue(row, names) {
  return num(firstValue(row, names));
}

function isPaidInvoice(inv) {
  const status = normalizeStatus(firstValue(inv, ["status_code", "status"]));
  const total = moneyValue(inv, ["total", "invoiced_amount", "amount"]);
  const paid = moneyValue(inv, ["paid_amount", "amount_paid"]);
  const balance = moneyValue(inv, ["balance_due"]);
  return status === "paid" || (total > 0 && paid >= total) || (balance === 0 && paid > 0);
}

function isInvoiceOpen(inv) {
  const status = normalizeStatus(firstValue(inv, ["status_code", "status"]));
  if (["paid", "void", "cancelled", "canceled", "deleted"].includes(status)) return false;
  const total = moneyValue(inv, ["total", "invoiced_amount", "amount"]);
  const paid = moneyValue(inv, ["paid_amount", "amount_paid"]);
  const balance = moneyValue(inv, ["balance_due"]);
  if (balance > 0) return true;
  if (total > 0 && paid < total) return true;
  return ["sent", "draft", "open", "unpaid", "partially_paid"].includes(status);
}

// Build a 7-day strip starting from today (UTC)
function buildWeekDays(todayStr) {
  const days = [];
  const base = new Date(todayStr + "T00:00:00Z");
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    days.push({
      date: dateStr(d),
      label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day:   d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }),
      event_count: 0,
      task_count: 0,
      is_today: i === 0,
    });
  }
  return days;
}

function makeQueueItem(systemKey, system, severity, title, count, reason, href, status) {
  return {
    system_key: systemKey,
    system,
    severity,
    title,
    count,
    reason,
    href: href || "",
    status: status || "active",
  };
}

function buildOwnerActionQueue(ctx) {
  const {
    leads,
    bookings,
    timeEntries,
    expenses,
    invoices,
    quoteSnapshots,
    staffRows,
    payrollRuns,
    expenseClaims,
    dataPresence,
    today,
    timed_events,
    overdue_tasks,
    unscheduled_tasks,
  } = ctx;

  const systems = [
    { key: "A", system: "Admin / Owner" },
    { key: "B", system: "Sales / Estimator / Intake" },
    { key: "C", system: "Jobs / Scheduling / Closeout" },
    { key: "D", system: "HR / Payroll / People" },
    { key: "E", system: "Fleet / Tools / Inventory" },
    { key: "F", system: "Finance / Compliance / Strategy" },
  ].map((s) => ({ ...s, items: [] }));

  const byKey = Object.fromEntries(systems.map((s) => [s.key, s]));
  const add = (key, severity, title, count, reason, href, status) => {
    const bucket = byKey[key];
    bucket.items.push(makeQueueItem(key, bucket.system, severity, title, count, reason, href, status));
  };
  const addIf = (key, severity, title, count, reason, href) => {
    if (count > 0) add(key, severity, title, count, reason, href, "active");
  };

  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const tomorrow = addDays(today, 1);

  // A. Admin / Owner
  addIf("A", "critical", "Overdue tasks", overdue_tasks.length,
    "Open tasks are past due and need owner attention.", "/crm/dashboard");
  addIf("A", "warning", "Open unscheduled tasks", unscheduled_tasks.length,
    "These tasks are not done yet and should be assigned, scheduled, or cleared.", "/crm/dashboard");
  if (byKey.A.items.length === 0) {
    add("A", "info", "No urgent admin task blockers found", 0,
      "No overdue or open unscheduled task blockers were found in the current Tasks data.", "/crm/dashboard", "clear");
  }

  // B. Sales / Estimator / Intake
  if (!dataPresence.leads) {
    add("B", "warning", "Lead data unavailable", null,
      "The Leads tab could not be read, so sales/intake queue counts cannot be calculated.", "/clients", "unavailable");
  } else {
    const salesNewStatuses = new Set(["new", "lead", "consult_request"]);
    const newLeads = leads.filter((l) => salesNewStatuses.has(normalizeStatus(l.status)) || !String(l.status || "").trim()).length;
    const quoteFollowups = leads.filter((l) => ["estimate_sent", "quoted", "awaiting_response"].includes(normalizeStatus(l.status))).length;
    const acceptedNotScheduled = leads.filter((l) => ["accepted", "approved"].includes(normalizeStatus(l.status)) && !String(l.scheduled_date || "").trim()).length;
    const sourceFieldExists = hasHeader(dataPresence.leadsData, ["lead_source", "source", "utm_source"]);
    const missingSource = sourceFieldExists
      ? leads.filter((l) => !String(firstValue(l, ["lead_source", "source", "utm_source"])).trim()).length
      : null;

    addIf("B", "critical", "New leads needing response", newLeads,
      "New leads should be contacted quickly before they go cold.", "/clients");
    addIf("B", "warning", "Quotes needing follow-up", quoteFollowups,
      "Quoted or awaiting-response leads need follow-up to convert.", "/clients");
    addIf("B", "critical", "Accepted quotes not scheduled", acceptedNotScheduled,
      "Accepted/approved work should be scheduled before it stalls.", "/crm/schedule");

    if (missingSource !== null) {
      addIf("B", "info", "Leads missing source", missingSource,
        "Lead source is needed to measure which marketing channels are working.", "/clients");
    }

    if (dataPresence.quoteSnapshots) {
      const byQuote = {};
      for (const snap of quoteSnapshots) {
        const qid = String(snap.quote_id || "").trim();
        if (!qid) continue;
        if (!byQuote[qid]) byQuote[qid] = { events: new Set(), statuses: new Set() };
        byQuote[qid].events.add(normalizeStatus(snap.event_type));
        byQuote[qid].statuses.add(normalizeStatus(snap.status));
      }
      let manualReview = 0;
      let incompleteSessions = 0;
      for (const q of Object.values(byQuote)) {
        const statuses = Array.from(q.statuses).join(" ");
        if (q.events.has("blocked") || statuses.includes("manual_review") || statuses.includes("review_required")) manualReview++;
        if (q.events.has("start") && !q.events.has("locked") && !q.events.has("blocked")) incompleteSessions++;
      }
      addIf("B", "critical", "Manual review quote requests", manualReview,
        "These quote sessions were blocked or flagged for manual review.", "/clients");
      addIf("B", "info", "Incomplete estimator sessions", incompleteSessions,
        "These quote sessions started but do not show a locked quote event yet.", "/clients");
    } else {
      add("B", "info", "Estimator session audit unavailable", null,
        "QuoteSnapshots data was not available, so abandoned/incomplete estimator sessions cannot be counted.", "/clients", "unavailable");
    }

    if (byKey.B.items.length === 0) {
      add("B", "info", "No sales/intake blockers found", 0,
        "No new lead, follow-up, manual review, or accepted-not-scheduled blocker was found from available data.", "/clients", "clear");
    }
  }

  // C. Jobs / Scheduling / Closeout
  const tomorrowLeadJobs = leads.filter((l) => {
    const d = parseDate(l.scheduled_date);
    return d && dateStr(d) === tomorrow;
  }).length;
  const tomorrowBookings = bookings.filter((b) => {
    const dt = b.scheduled_datetime || b.date || "";
    const d = parseDate((dt.split && dt.split("T")[0]) || dt);
    return d && dateStr(d) === tomorrow;
  }).length;

  addIf("C", "info", "Today's jobs", timed_events.length,
    "These are scheduled for today and should be monitored through dispatch/closeout.", "/crm/schedule");
  addIf("C", "info", "Tomorrow's jobs", tomorrowLeadJobs + tomorrowBookings,
    "Tomorrow's work should be checked for assignment, materials, and confirmation.", "/crm/schedule");

  const scheduledLeadMissingTech = leads.filter((l) =>
    ["scheduled", "in_progress"].includes(normalizeStatus(l.status)) && !String(l.assigned_to || "").trim()
  ).length;
  const scheduledBookingMissingTech = bookings.filter((b) =>
    ["scheduled", "confirmed", "pending"].includes(normalizeStatus(b.status)) &&
    !String(b.assigned_tech || b.assigned_to || "").trim()
  ).length;
  addIf("C", "critical", "Scheduled jobs missing assigned tech", scheduledLeadMissingTech + scheduledBookingMissingTech,
    "Scheduled jobs should have a clear owner/tech before the day starts.", "/crm/schedule");

  const depositMissing = leads.filter((l) => {
    const status = normalizeStatus(l.status);
    const inPlay = ["approved", "scheduled", "in_progress", "deposit_required"].includes(status);
    const requiresDeposit = String(l.deposit_required || "").toLowerCase() === "true" ||
      status === "deposit_required" ||
      moneyValue(l, ["quoted_price", "estimated_value"]) >= 500;
    return inPlay && requiresDeposit && num(l.deposit_received) <= 0;
  }).length;
  addIf("C", "critical", "Jobs missing required deposit", depositMissing,
    "Deposit-required jobs should not move forward without deposit or an intentional override.", "/clients");

  const completedNotInvoiced = leads.filter((l) =>
    normalizeStatus(l.status) === "complete" && moneyValue(l, ["invoiced_amount"]) <= 0
  ).length;
  addIf("C", "critical", "Completed jobs not invoiced", completedNotInvoiced,
    "Completed work should be invoiced quickly to protect cash flow.", "/invoices");

  const paidNotClosed = leads.filter((l) => normalizeStatus(l.status) === "paid").length;
  addIf("C", "warning", "Paid jobs not closed", paidNotClosed,
    "Paid jobs should be administratively closed after closeout is complete.", "/clients");

  if (dataPresence.time) {
    const timeLeadIds = new Set(timeEntries.map((t) => String(t.lead_id || "").trim()).filter(Boolean));
    const doneJobsMissingTime = leads.filter((l) =>
      ["complete", "paid", "closed"].includes(normalizeStatus(l.status)) &&
      String(l.id || "").trim() &&
      !timeLeadIds.has(String(l.id || "").trim())
    ).length;
    addIf("C", "warning", "Completed jobs missing time entries", doneJobsMissingTime,
      "Missing time entries make job costing and bonus decisions unreliable.", "/crm/time");
  } else {
    add("C", "info", "Time-entry audit unavailable", null,
      "The Time tab could not be read, so missing-time checks cannot be calculated.", "/crm/time", "unavailable");
  }

  if (byKey.C.items.length === 0) {
    add("C", "info", "No job/scheduling blockers found", 0,
      "No scheduling, deposit, time-entry, or closeout blocker was found from available data.", "/crm/schedule", "clear");
  }

  // D. HR / Payroll / People
  if (dataPresence.staff) {
    const pendingStaff = staffRows.filter((s) => ["pending", "pending_approval"].includes(normalizeStatus(s.status))).length;
    addIf("D", "critical", "Staff approvals pending", pendingStaff,
      "Pending staff accounts should be approved or rejected so access is controlled.", "/crm/staff");

    const criticalFields = ["hire_date", "employment_status", "department_id", "designation_id"].filter((h) => dataPresence.staffData.headers.includes(h));
    if (criticalFields.length > 0) {
      const activeStaffMissingHr = staffRows.filter((s) => {
        const status = normalizeStatus(s.status);
        if (["inactive", "terminated", "rejected"].includes(status)) return false;
        return criticalFields.some((field) => !String(s[field] || "").trim());
      }).length;
      addIf("D", "warning", "Staff records missing HR fields", activeStaffMissingHr,
        "Incomplete HR fields weaken payroll, reporting, and accountability.", "/people/employees");
    }
  } else {
    add("D", "info", "Staff data unavailable", null,
      "The Staff tab could not be read, so staff approval and HR field checks cannot be calculated.", "/crm/staff", "unavailable");
  }

  if (dataPresence.payrollRuns) {
    const pendingRuns = payrollRuns.filter((r) =>
      ["draft", "pending", "processing", "open"].includes(normalizeStatus(r.status))
    ).length;
    addIf("D", "warning", "Payroll runs need review", pendingRuns,
      "Draft, pending, or processing payroll runs should be reviewed before payroll is finalized.", "/people/payroll/runs");
  } else {
    add("D", "info", "Payroll runs unavailable", null,
      "HR_PayrollRuns data was not available, so payroll-run checks cannot be calculated.", "/people/payroll/runs", "unavailable");
  }

  if (dataPresence.expenseClaims) {
    const pendingClaims = expenseClaims.filter((c) =>
      ["submitted", "pending", "open"].includes(normalizeStatus(c.status))
    ).length;
    addIf("D", "warning", "Expense claims need review", pendingClaims,
      "Submitted expense claims should be reviewed before they affect payroll or reimbursements.", "/people/expense-claims");
  }

  if (byKey.D.items.length === 0) {
    add("D", "info", "No HR/payroll blockers found", 0,
      "No staff, payroll-run, or expense-claim blocker was found from available data.", "/people/employees", "clear");
  }

  // E. Fleet / Tools / Inventory
  if (!process.env.TRACCAR_URL || !process.env.TRACCAR_TOKEN) {
    add("E", "warning", "Fleet tracking not connected", null,
      "TRACCAR_URL/TRACCAR_TOKEN are not configured, so live fleet status is unavailable.", "/crm/fleet", "unavailable");
  } else {
    add("E", "info", "Fleet tracking configured", null,
      "Traccar settings are present. Use Live Fleet for current GPS status.", "/crm/fleet", "connected");
  }
  add("E", "info", "Tools/inventory system not clearly implemented yet", null,
    "No dedicated tools, asset, maintenance, or truck-stock module is clearly implemented in the current repo.", "/crm/fleet", "unavailable");

  // F. Finance / Compliance / Strategy
  if (dataPresence.invoices) {
    const openInvoices = invoices.filter(isInvoiceOpen).length;
    const sentUnpaid = invoices.filter((inv) =>
      ["sent", "open", "unpaid", "partially_paid"].includes(normalizeStatus(firstValue(inv, ["status_code", "status"]))) &&
      !isPaidInvoice(inv)
    ).length;
    const overdueInvoices = invoices.filter((inv) => {
      if (!isInvoiceOpen(inv)) return false;
      const due = parseDate(firstValue(inv, ["due_at", "due_date"]));
      return due && due.getTime() < todayMs;
    }).length;
    addIf("F", "warning", "Open invoices", openInvoices,
      "Open invoices should be monitored until paid.", "/invoices");
    addIf("F", "critical", "Overdue invoices", overdueInvoices,
      "Overdue invoices need collection follow-up.", "/invoices?status=overdue");
    addIf("F", "warning", "Sent invoices not paid", sentUnpaid,
      "Sent but unpaid invoices should be followed until collected.", "/invoices");
  } else {
    add("F", "info", "Invoice data unavailable", null,
      "The Invoices tab could not be read, so invoice risk checks cannot be calculated.", "/invoices", "unavailable");
  }

  if (dataPresence.expenses && hasHeader(dataPresence.expensesData, ["receipt_url", "receipt", "receipt_link"])) {
    const missingReceipts = expenses.filter((e) =>
      num(e.amount) > 0 && !String(firstValue(e, ["receipt_url", "receipt", "receipt_link"])).trim()
    ).length;
    addIf("F", "warning", "Expenses missing receipts", missingReceipts,
      "Expenses without receipts weaken records and closeout proof.", "/crm/expenses");
  } else {
    add("F", "info", "Receipt audit unavailable", null,
      "Expense receipt fields were not clearly available, so missing-receipt checks cannot be calculated.", "/crm/expenses", "unavailable");
  }

  add("F", "info", "Compliance reminders not clearly implemented yet", null,
    "License, insurance, EOR, permit, and tax reminder records were not found in the current dashboard data.", "/crm/settings", "unavailable");

  const activeCount = systems.reduce((sum, s) =>
    sum + s.items.filter((i) => i.status === "active" && Number(i.count) > 0).length, 0
  );

  for (const s of systems) {
    s.status = s.items.some((i) => i.status === "active" && i.severity === "critical")
      ? "critical"
      : s.items.some((i) => i.status === "active" && i.severity === "warning")
        ? "warning"
        : s.items.some((i) => i.status === "unavailable")
          ? "partial"
          : "clear";
  }

  return {
    generated_at: new Date().toISOString(),
    total_active_items: activeCount,
    systems,
  };
}

async function handleToday(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const [
      leadsData,
      tasksData,
      bookingsData,
      timeData,
      expensesData,
      invoicesData,
      quoteSnapshotsData,
      staffData,
      payrollRunsData,
      expenseClaimsData,
    ] = await Promise.all([
      fetchRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchRows(sheets, spreadsheetId, "Tasks!A1:L5000"),
      fetchRows(sheets, spreadsheetId, "Bookings!A1:Z").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, spreadsheetId, "TimeEntries!A1:L5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, spreadsheetId, "Expenses!A1:J5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, spreadsheetId, "Invoices!A1:AZ5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, spreadsheetId, "QuoteSnapshots!A1:Z5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, require("../lib/hrSheetClient").hrSpreadsheetId(), "Staff!A1:AZ5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, require("../lib/hrSheetClient").hrSpreadsheetId(), "HR_PayrollRuns!A1:AZ5000").catch(() => ({ headers: [], rows: [] })),
      fetchRows(sheets, require("../lib/hrSheetClient").hrSpreadsheetId(), "HR_ExpenseClaims!A1:AZ5000").catch(() => ({ headers: [], rows: [] })),
    ]);

    const today = todayLocal();
    const todayMs = new Date(today + "T00:00:00Z").getTime();

    // ── Parse leads ──
    const leads = leadsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(leadsData.headers, r))
      .map((l) => {
        l.estimated_value = num(l.estimated_value);
        l.quoted_price    = num(l.quoted_price);
        l.deposit_received = num(l.deposit_received);
        l.invoiced_amount = num(l.invoiced_amount);
        l.paid_amount = num(l.paid_amount);
        return l;
      });

    // ── Parse bookings (from schedule system) ──
    const bookings = bookingsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(bookingsData.headers, r))
      .filter((b) => {
        const s = String(b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });

    // ── Parse tasks ──
    const tasks = tasksData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(tasksData.headers, r))
      .map((t) => ({
        task_id:     t.task_id || "",
        title:       t.title || "",
        due_date:    t.due_date || "",
        assigned_to: t.assigned_to || "",
        priority:    t.priority || "medium",
        notes:       t.notes || "",
        status:      String(t.status || "Open").toLowerCase(),
        related_lead_id: t.related_lead_id || "",
        type:        t.type || "Task",
      }))
      .filter((t) => t.status !== "done" && t.status !== "complete" && t.status !== "closed");

    const timeEntries = timeData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(timeData.headers, r));

    const expenses = expensesData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(expensesData.headers, r));

    const invoices = invoicesData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(invoicesData.headers, r));

    const quoteSnapshots = quoteSnapshotsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(quoteSnapshotsData.headers, r));

    const staffRows = staffData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(staffData.headers, r));

    const payrollRuns = payrollRunsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(payrollRunsData.headers, r));

    const expenseClaims = expenseClaimsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(expenseClaimsData.headers, r));

    // ── Today events from Leads ──
    const todayLeads = leads.filter((l) => {
      const d = parseDate(l.scheduled_date);
      return d && dateStr(d) === today;
    });

    // ── Overdue leads (past scheduled_date, still open) ──
    const overdueStatuses = new Set(["overdue"]);
    const openStatuses    = new Set(["scheduled", "in_progress", "active", "approved", "deposit_required"]);
    const overdueLeads = leads.filter((l) => {
      const d = parseDate(l.scheduled_date);
      if (!d) return false;
      const s = String(l.status || "").toLowerCase();
      return d.getTime() < todayMs && (overdueStatuses.has(s) || openStatuses.has(s));
    });

    // ── Today bookings (from Bookings sheet) ──
    const todayBookings = bookings.filter((b) => {
      const dt = b.scheduled_datetime || b.date || "";
      const d = parseDate(dt.split("T")[0] || dt);
      return d && dateStr(d) === today;
    });

    // ── Build timed_events (leads + bookings for today) ──
    const timedEventsMap = new Map();

    for (const l of todayLeads) {
      const timeHint = String(l.scheduled_time || l.start_time || "").trim();
      timedEventsMap.set("lead_" + l.id, {
        id:           l.id || "",
        type:         "lead",
        event_type:   l.job_type || "Job",
        name:         l.name || "(No name)",
        address:      l.address || "",
        assigned_to:  l.assigned_to || "",
        status:       l.status || "",
        value:        l.quoted_price || l.estimated_value || 0,
        scheduled_date: l.scheduled_date || "",
        time_hint:    timeHint,
        sort_key:     timeHint || "23:59",
        link:         "/crm/lead?id=" + encodeURIComponent(l.id || ""),
      });
    }

    for (const b of todayBookings) {
      const dt = b.scheduled_datetime || "";
      const timePart = dt.includes("T") ? dt.split("T")[1].slice(0, 5) : "";
      timedEventsMap.set("booking_" + (b.booking_id || b.id), {
        id:           b.booking_id || b.id || "",
        type:         "booking",
        event_type:   b.job_type || "Booking",
        name:         b.customer_name || b.name || "(No name)",
        address:      b.address || "",
        assigned_to:  b.assigned_tech || b.assigned_to || "",
        status:       b.status || "Scheduled",
        value:        num(b.final_price || b.estimated_price || 0),
        scheduled_date: (dt || "").split("T")[0],
        time_hint:    timePart,
        sort_key:     timePart || "23:59",
        link:         "/crm/schedule",
      });
    }

    const timed_events = Array.from(timedEventsMap.values())
      .sort((a, b) => a.sort_key.localeCompare(b.sort_key));

    // ── Overdue tasks ──
    const overdue_tasks = tasks.filter((t) => {
      if (!t.due_date) return false;
      const d = parseDate(t.due_date);
      return d && d.getTime() < todayMs;
    }).sort((a, b) => {
      const pa = { high: 0, medium: 1, low: 2 }[a.priority] ?? 1;
      const pb = { high: 0, medium: 1, low: 2 }[b.priority] ?? 1;
      return pa - pb;
    });

    // ── Unscheduled tasks (open, no past due_date, or due today) ──
    const unscheduled_tasks = tasks.filter((t) => {
      if (!t.due_date) return true;
      const d = parseDate(t.due_date);
      if (!d) return true;
      return d.getTime() >= todayMs;
    }).sort((a, b) => {
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      const pa = { high: 0, medium: 1, low: 2 }[a.priority] ?? 1;
      const pb = { high: 0, medium: 1, low: 2 }[b.priority] ?? 1;
      return pa - pb;
    });

    // ── Sidebar overdue count (overdue tasks + leads past scheduled date that are still open) ──
    const overdue_count = overdue_tasks.length + overdueLeads.length;

    // ── Week strip (next 7 days) ──
    const week_days = buildWeekDays(today);
    for (const day of week_days) {
      // Count leads scheduled on that day
      day.event_count = leads.filter((l) => {
        const d = parseDate(l.scheduled_date);
        return d && dateStr(d) === day.date;
      }).length + bookings.filter((b) => {
        const dt = b.scheduled_datetime || b.date || "";
        const d = parseDate(dt.split("T")[0] || dt);
        return d && dateStr(d) === day.date;
      }).length;

      // Count open tasks due on that day
      day.task_count = tasks.filter((t) => {
        if (!t.due_date) return false;
        const d = parseDate(t.due_date);
        return d && dateStr(d) === day.date;
      }).length;
    }

    const owner_action_queue = buildOwnerActionQueue({
      leads,
      bookings,
      timeEntries,
      expenses,
      invoices,
      quoteSnapshots,
      staffRows,
      payrollRuns,
      expenseClaims,
      dataPresence: {
        leads: leadsData.headers.length > 0,
        leadsData,
        time: timeData.headers.length > 0,
        expenses: expensesData.headers.length > 0,
        expensesData,
        invoices: invoicesData.headers.length > 0,
        quoteSnapshots: quoteSnapshotsData.headers.length > 0,
        staff: staffData.headers.length > 0,
        staffData,
        payrollRuns: payrollRunsData.headers.length > 0,
        expenseClaims: expenseClaimsData.headers.length > 0,
      },
      today,
      timed_events,
      overdue_tasks,
      unscheduled_tasks,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      today,
      timed_events,
      overdue_tasks,
      unscheduled_tasks,
      overdue_count,
      week_days,
      owner_action_queue,
    }));
  } catch (e) {
    console.error("[api/today] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// GET /api/week?date=YYYY-MM-DD — returns full event+task detail for a specific day
async function handleWeekDay(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const url = new URL("http://x" + req.url);
    const date = url.searchParams.get("date") || todayLocal();

    const [leadsData, tasksData, bookingsData] = await Promise.all([
      fetchRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchRows(sheets, spreadsheetId, "Tasks!A1:L5000"),
      fetchRows(sheets, spreadsheetId, "Bookings!A1:Z").catch(() => ({ headers: [], rows: [] })),
    ]);

    const leads = leadsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(leadsData.headers, r));

    const bookings = bookingsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(bookingsData.headers, r))
      .filter((b) => {
        const s = String(b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });

    const tasks = tasksData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(tasksData.headers, r))
      .filter((t) => {
        const s = String(t.status || "Open").toLowerCase();
        return s !== "done" && s !== "complete" && s !== "closed";
      });

    const dayLeads = leads
      .filter((l) => {
        const d = parseDate(l.scheduled_date);
        return d && dateStr(d) === date;
      })
      .map((l) => ({
        id: l.id || "",
        type: "lead",
        event_type: l.job_type || "Job",
        name: l.name || "(No name)",
        address: l.address || "",
        assigned_to: l.assigned_to || "",
        status: l.status || "",
        value: num(l.quoted_price || l.estimated_value || 0),
        time_hint: String(l.scheduled_time || l.start_time || "").trim(),
        link: "/crm/lead?id=" + encodeURIComponent(l.id || ""),
      }));

    const dayBookings = bookings
      .filter((b) => {
        const dt = b.scheduled_datetime || b.date || "";
        const d = parseDate(dt.split("T")[0] || dt);
        return d && dateStr(d) === date;
      })
      .map((b) => {
        const dt = b.scheduled_datetime || "";
        const timePart = dt.includes("T") ? dt.split("T")[1].slice(0, 5) : "";
        return {
          id: b.booking_id || b.id || "",
          type: "booking",
          event_type: b.job_type || "Booking",
          name: b.customer_name || b.name || "(No name)",
          address: b.address || "",
          assigned_to: b.assigned_tech || b.assigned_to || "",
          status: b.status || "Scheduled",
          value: num(b.final_price || b.estimated_price || 0),
          time_hint: timePart,
          link: "/crm/schedule",
        };
      });

    const events = [...dayLeads, ...dayBookings].sort((a, b) =>
      (a.time_hint || "23:59").localeCompare(b.time_hint || "23:59")
    );

    const dayTasks = tasks
      .filter((t) => {
        if (!t.due_date) return false;
        const d = parseDate(t.due_date);
        return d && dateStr(d) === date;
      });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, date, events, tasks: dayTasks }));
  } catch (e) {
    console.error("[api/week] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleToday, handleWeekDay };
