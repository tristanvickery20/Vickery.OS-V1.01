// lib/lifecycle.js
// Read-only VE OS lifecycle helpers.
// This module does not write to Sheets or change stored statuses.

const VE_OS_LIFECYCLE_ORDER = [
  "New Lead",
  "Qualified",
  "Quoted",
  "Needs Review",
  "Accepted",
  "Scheduled",
  "Prepped",
  "In Progress",
  "Complete",
  "Invoiced",
  "Paid",
  "Closed",
  "Review Requested",
  "Retention",
];

const QUEUE_TO_CHECKLIST_RULES = [
  { match: /accepted quotes not scheduled/i, key: "accepted_not_scheduled", stage: "Accepted → Scheduled", severity: "critical", title: "Accepted work is not scheduled", reason: "Accepted quotes should be scheduled before they go stale.", href: "/crm/schedule" },
  { match: /scheduled jobs missing assigned tech/i, key: "scheduled_missing_assignment", stage: "Scheduled → Prepped", severity: "critical", title: "Scheduled work is missing an assigned tech", reason: "Scheduled jobs need a clear owner before dispatch.", href: "/crm/schedule" },
  { match: /jobs missing required deposit/i, key: "scheduled_missing_deposit", stage: "Accepted/Scheduled → Prepped", severity: "critical", title: "Deposit-required work is missing deposit", reason: "Deposit-required jobs should not move forward without payment or an intentional override.", href: "/clients" },
  { match: /completed jobs not invoiced/i, key: "completed_not_invoiced", stage: "Complete → Invoiced", severity: "critical", title: "Completed work is not invoiced", reason: "Completed jobs should be invoiced quickly so cash is not delayed.", href: "/invoices" },
  { match: /completed jobs missing time entries/i, key: "completed_missing_time", stage: "Complete → Invoiced", severity: "warning", title: "Completed work is missing time entries", reason: "Missing time entries make job costing and closeout unreliable.", href: "/crm/time" },
  { match: /open invoices/i, key: "invoiced_not_paid", stage: "Invoiced → Paid", severity: "warning", title: "Invoices are open or unpaid", reason: "Open invoices should be followed until collected.", href: "/invoices" },
  { match: /sent invoices not paid/i, key: "sent_invoices_not_paid", stage: "Invoiced → Paid", severity: "warning", title: "Sent invoices are not paid", reason: "Sent but unpaid invoices should be followed until collected.", href: "/invoices" },
  { match: /overdue invoices/i, key: "overdue_invoices", stage: "Invoiced → Paid", severity: "critical", title: "Invoices are overdue", reason: "Overdue invoices need collection follow-up.", href: "/invoices?status=overdue" },
  { match: /paid jobs not closed/i, key: "paid_not_closed", stage: "Paid → Closed", severity: "warning", title: "Paid jobs are not closed", reason: "Paid jobs should be closed after job costing, review request, and retention handoff are handled.", href: "/clients" },
];

const LIMITED_CHECKS = [
  { key: "scheduled_missing_confirmation", stage: "Scheduled → Prepped", title: "Confirmation check limited", reason: "No dedicated customer-confirmation field was found in current schedule data.", href: "/crm/schedule" },
  { key: "scheduled_missing_prep_materials", stage: "Scheduled → Prepped", title: "Prep/materials gate limited", reason: "No dedicated prep or materials-ready field was found for current jobs.", href: "/crm/schedule" },
  { key: "completed_missing_photos_or_notes", stage: "Complete → Invoiced", title: "Final notes/photos gate limited", reason: "No dedicated final-notes or final-photo field was found in current job data.", href: "/clients" },
  { key: "review_request_missing", stage: "Closed → Review Requested", title: "Review-request tracking limited", reason: "No per-job review-request field was found in current job data.", href: "/reviews" },
  { key: "retention_handoff_missing", stage: "Review Requested → Retention", title: "Retention handoff not clearly implemented yet", reason: "No per-job retention or future follow-up field was found in current job data.", href: "/clients" },
];

function rawStatus(value) {
  return String(value || "").toLowerCase().trim().replace(/[-\s]+/g, "_");
}

function normalizeLifecycleStatus(value) {
  const s = rawStatus(value);
  if (!s) return "Unknown";

  if (["new", "new_lead", "lead", "consult_request", "awaiting_response"].includes(s)) return "New Lead";
  if (["qualified"].includes(s)) return "Qualified";
  if (["quoted", "quote_sent", "estimate_sent", "proposal_sent"].includes(s)) return "Quoted";
  if (["needs_review", "manual_review", "review_required", "blocked"].includes(s)) return "Needs Review";
  if (["accepted", "approved", "quote_accepted"].includes(s)) return "Accepted";
  if (["scheduled", "booked", "confirmed"].includes(s)) return "Scheduled";
  if (["prepped", "ready", "ready_to_dispatch", "materials_ready"].includes(s)) return "Prepped";
  if (["in_progress", "started", "onsite", "active"].includes(s)) return "In Progress";
  if (["complete", "completed", "done"].includes(s)) return "Complete";
  if (["invoiced", "invoice_sent", "awaiting_payment", "unpaid", "partially_paid"].includes(s)) return "Invoiced";
  if (["paid", "payment_received"].includes(s)) return "Paid";
  if (["closed"].includes(s)) return "Closed";
  if (["review_requested", "review_sent"].includes(s)) return "Review Requested";
  if (["retention", "nurture", "follow_up", "followup"].includes(s)) return "Retention";

  return "Unknown";
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function firstValue(row, names) {
  for (const name of names) {
    if (!row || row[name] === undefined || row[name] === null) continue;
    const value = String(row[name]).trim();
    if (value !== "") return row[name];
  }
  return "";
}

function hasAnyHeader(data, names) {
  const headers = data && Array.isArray(data.headers) ? data.headers : [];
  return names.some((name) => headers.includes(name));
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const d = new Date(raw.includes("T") ? raw : raw + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTruthy(value) {
  return ["true", "yes", "y", "1", "complete", "completed", "ready", "confirmed", "sent"].includes(rawStatus(value));
}

function makeIssue({ key, stage, severity, title, count, reason, href, status, source }) {
  return {
    key,
    stage,
    severity: severity || "info",
    title,
    count,
    reason,
    href: href || "",
    status: status || (count > 0 ? "active" : "clear"),
    source: source || "lifecycle_helper",
  };
}

function makeLimited(key, stage, title, reason, href) {
  return makeIssue({
    key,
    stage,
    severity: "info",
    title,
    count: null,
    reason,
    href,
    status: "limited",
    source: "limited_current_data",
  });
}

function buildSummary(checks, source, note) {
  const activeCount = checks.filter((check) => check.status === "active" && Number(check.count) > 0).length;
  const criticalCount = checks.filter((check) => check.status === "active" && check.severity === "critical" && Number(check.count) > 0).length;
  const warningCount = checks.filter((check) => check.status === "active" && check.severity === "warning" && Number(check.count) > 0).length;
  const limitedCount = checks.filter((check) => check.status === "limited" || check.status === "unavailable").length;

  return {
    generated_at: new Date().toISOString(),
    lifecycle_order: VE_OS_LIFECYCLE_ORDER,
    source,
    note,
    active_count: activeCount,
    critical_count: criticalCount,
    warning_count: warningCount,
    limited_count: limitedCount,
    checks,
  };
}

function buildIdSet(rows, names) {
  const ids = new Set();
  for (const row of rows || []) {
    const id = String(firstValue(row, names)).trim();
    if (id) ids.add(id);
  }
  return ids;
}

function leadHasActiveBooking(lead, bookings) {
  const leadIds = ["id", "lead_id", "last_quote_id", "quote_id"]
    .map((name) => String(lead[name] || "").trim())
    .filter(Boolean);
  if (leadIds.length === 0) return false;

  return (bookings || []).some((booking) => {
    const status = rawStatus(booking.status);
    if (["cancelled", "canceled", "void", "deleted"].includes(status)) return false;
    const bookingIds = ["lead_id", "quote_id", "booking_id", "id"]
      .map((name) => String(booking[name] || "").trim())
      .filter(Boolean);
    return bookingIds.some((id) => leadIds.includes(id));
  });
}

function requiresDeposit(lead) {
  const status = rawStatus(lead.status || lead.status_code);
  const explicit = rawStatus(lead.deposit_required) === "true" || rawStatus(lead.deposit_required) === "yes";
  const override = rawStatus(lead.deposit_override) === "true" || rawStatus(lead.deposit_override) === "yes";
  const amount = num(firstValue(lead, ["quoted_price", "estimated_value", "final_price"]));
  return !override && (explicit || status === "deposit_required" || amount >= 500);
}

function isInvoicePaid(invoice) {
  const status = rawStatus(firstValue(invoice, ["status_code", "status"]));
  const total = num(firstValue(invoice, ["total", "invoiced_amount", "amount"]));
  const paid = num(firstValue(invoice, ["paid_amount", "amount_paid"]));
  const balance = num(firstValue(invoice, ["balance_due"]));
  return status === "paid" || (total > 0 && paid >= total) || (balance === 0 && paid > 0);
}

function isInvoiceOpen(invoice) {
  const status = rawStatus(firstValue(invoice, ["status_code", "status"]));
  if (["paid", "void", "cancelled", "canceled", "deleted"].includes(status)) return false;
  const total = num(firstValue(invoice, ["total", "invoiced_amount", "amount"]));
  const paid = num(firstValue(invoice, ["paid_amount", "amount_paid"]));
  const balance = num(firstValue(invoice, ["balance_due"]));
  return balance > 0 || (total > 0 && paid < total) || ["sent", "draft", "open", "unpaid", "partially_paid"].includes(status);
}

function buildCloseoutChecklistFromOwnerQueue(ownerActionQueue) {
  const byKey = {};
  const systems = Array.isArray(ownerActionQueue?.systems) ? ownerActionQueue.systems : [];

  for (const system of systems) {
    for (const item of (system.items || [])) {
      const title = String(item.title || "");
      const rule = QUEUE_TO_CHECKLIST_RULES.find((r) => r.match.test(title));
      if (!rule) continue;
      if (item.status !== "active" || !(Number(item.count) > 0)) continue;
      byKey[rule.key] = makeIssue({
        key: rule.key,
        stage: rule.stage,
        severity: item.severity || rule.severity,
        title: rule.title,
        count: item.count,
        reason: item.reason || rule.reason,
        href: item.href || rule.href,
        status: "active",
        source: "owner_action_queue",
      });
    }
  }

  const checks = QUEUE_TO_CHECKLIST_RULES.map((rule) => byKey[rule.key] || makeIssue({
    key: rule.key,
    stage: rule.stage,
    severity: rule.severity,
    title: rule.title,
    count: 0,
    reason: "No active blocker for this check was found in the current Owner Action Queue.",
    href: rule.href,
    status: "clear",
    source: "owner_action_queue",
  }));

  for (const limited of LIMITED_CHECKS) {
    checks.push(makeLimited(limited.key, limited.stage, limited.title, limited.reason, limited.href));
  }

  return buildSummary(
    checks,
    "owner_action_queue",
    "Server-side checklist derived from /api/today owner_action_queue. Counts are still based on existing Sheets-backed dashboard data; no stored statuses are changed."
  );
}

function buildCloseoutChecklist(ctx = {}) {
  if (ctx.ownerActionQueue && (!ctx.leads || ctx.useOwnerQueueFallback)) {
    return buildCloseoutChecklistFromOwnerQueue(ctx.ownerActionQueue);
  }

  const leads = Array.isArray(ctx.leads) ? ctx.leads : [];
  const bookings = Array.isArray(ctx.bookings) ? ctx.bookings : [];
  const timeEntries = Array.isArray(ctx.timeEntries) ? ctx.timeEntries : [];
  const expenses = Array.isArray(ctx.expenses) ? ctx.expenses : [];
  const invoices = Array.isArray(ctx.invoices) ? ctx.invoices : [];
  const dataPresence = ctx.dataPresence || {};
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const todayMs = new Date(today + "T00:00:00Z").getTime();

  const timeLeadIds = buildIdSet(timeEntries, ["lead_id", "job_id", "request_id"]);
  const expenseLeadIds = buildIdSet(expenses, ["lead_id", "job_id", "request_id"]);
  const invoiceLeadIds = buildIdSet(invoices, ["lead_id", "job_id", "request_id"]);

  const acceptedNotScheduled = leads.filter((lead) => {
    const stage = normalizeLifecycleStatus(lead.status_code || lead.status);
    return stage === "Accepted" && !String(lead.scheduled_date || "").trim() && !leadHasActiveBooking(lead, bookings);
  }).length;

  const scheduledMissingAssignment = leads.filter((lead) => {
    const stage = normalizeLifecycleStatus(lead.status_code || lead.status);
    return ["Scheduled", "Prepped", "In Progress"].includes(stage) && !String(lead.assigned_to || "").trim();
  }).length + bookings.filter((booking) => {
    const status = rawStatus(booking.status);
    return ["scheduled", "confirmed", "pending", "booked"].includes(status) && !String(booking.assigned_tech || booking.assigned_to || "").trim();
  }).length;

  const scheduledMissingDeposit = leads.filter((lead) => {
    const stage = normalizeLifecycleStatus(lead.status_code || lead.status);
    return ["Accepted", "Scheduled", "Prepped", "In Progress"].includes(stage) && requiresDeposit(lead) && num(lead.deposit_received) <= 0;
  }).length;

  const completedLeads = leads.filter((lead) => ["Complete", "Paid", "Closed"].includes(normalizeLifecycleStatus(lead.status_code || lead.status)));
  const completedNotInvoiced = completedLeads.filter((lead) => {
    const id = String(lead.id || lead.lead_id || "").trim();
    return normalizeLifecycleStatus(lead.status_code || lead.status) === "Complete" && num(lead.invoiced_amount) <= 0 && (!id || !invoiceLeadIds.has(id));
  }).length;

  const completedMissingTime = dataPresence.time === false ? null : completedLeads.filter((lead) => {
    const id = String(lead.id || lead.lead_id || "").trim();
    return id && !timeLeadIds.has(id);
  }).length;

  const completedMissingExpenses = dataPresence.expenses === false ? null : completedLeads.filter((lead) => {
    const id = String(lead.id || lead.lead_id || "").trim();
    return id && !expenseLeadIds.has(id);
  }).length;

  const openInvoices = invoices.filter(isInvoiceOpen).length;
  const overdueInvoices = invoices.filter((invoice) => {
    if (!isInvoiceOpen(invoice)) return false;
    const due = parseDate(firstValue(invoice, ["due_at", "due_date"]));
    return due && due.getTime() < todayMs;
  }).length;

  const paidNotClosed = leads.filter((lead) => normalizeLifecycleStatus(lead.status_code || lead.status) === "Paid").length;

  const checks = [
    makeIssue({ key: "accepted_not_scheduled", stage: "Accepted → Scheduled", severity: "critical", title: "Accepted work is not scheduled", count: acceptedNotScheduled, reason: "Accepted quotes should be scheduled before they go stale.", href: "/crm/schedule" }),
    makeIssue({ key: "scheduled_missing_assignment", stage: "Scheduled → Prepped", severity: "critical", title: "Scheduled work is missing an assigned tech", count: scheduledMissingAssignment, reason: "Scheduled jobs need a clear owner before dispatch.", href: "/crm/schedule" }),
    makeIssue({ key: "scheduled_missing_deposit", stage: "Accepted/Scheduled → Prepped", severity: "critical", title: "Deposit-required work is missing deposit", count: scheduledMissingDeposit, reason: "Deposit-required jobs should not move forward without payment or an intentional override.", href: "/clients" }),
  ];

  if (hasAnyHeader(dataPresence.bookingsData, ["customer_confirmed", "confirmation_status", "confirmed_at"])) {
    const missingConfirmation = bookings.filter((booking) => {
      const status = rawStatus(booking.status);
      if (!["scheduled", "booked", "pending"].includes(status)) return false;
      return !isTruthy(firstValue(booking, ["customer_confirmed", "confirmation_status", "confirmed_at"]));
    }).length;
    checks.push(makeIssue({ key: "scheduled_missing_confirmation", stage: "Scheduled → Prepped", severity: "warning", title: "Scheduled work is missing customer confirmation", count: missingConfirmation, reason: "Customer confirmation helps prevent wasted drive time and schedule chaos.", href: "/crm/schedule" }));
  } else {
    checks.push(makeLimited("scheduled_missing_confirmation", "Scheduled → Prepped", "Confirmation check limited", "No dedicated customer-confirmation field was found in current schedule data.", "/crm/schedule"));
  }

  if (hasAnyHeader(dataPresence.leadsData, ["prep_status", "materials_status", "materials_ready", "prep_ready", "prepped_at"])) {
    const missingPrep = leads.filter((lead) => {
      const stage = normalizeLifecycleStatus(lead.status_code || lead.status);
      if (!["Scheduled", "Prepped", "In Progress"].includes(stage)) return false;
      return !isTruthy(firstValue(lead, ["prep_status", "materials_status", "materials_ready", "prep_ready", "prepped_at"]));
    }).length;
    checks.push(makeIssue({ key: "scheduled_missing_prep_materials", stage: "Scheduled → Prepped", severity: "warning", title: "Scheduled work is missing prep/materials readiness", count: missingPrep, reason: "Jobs should be checked for materials and scope before the crew arrives.", href: "/crm/schedule" }));
  } else {
    checks.push(makeLimited("scheduled_missing_prep_materials", "Scheduled → Prepped", "Prep/materials gate limited", "No dedicated prep or materials-ready field was found for current jobs.", "/crm/schedule"));
  }

  checks.push(
    makeIssue({ key: "completed_not_invoiced", stage: "Complete → Invoiced", severity: "critical", title: "Completed work is not invoiced", count: completedNotInvoiced, reason: "Completed jobs should be invoiced quickly so cash is not delayed.", href: "/invoices" }),
    completedMissingTime === null
      ? makeLimited("completed_missing_time", "Complete → Invoiced", "Time-entry check unavailable", "Time data was not available, so missing-time checks cannot be calculated.", "/crm/time")
      : makeIssue({ key: "completed_missing_time", stage: "Complete → Invoiced", severity: "warning", title: "Completed work is missing time entries", count: completedMissingTime, reason: "Missing time entries make job costing and closeout unreliable.", href: "/crm/time" }),
    completedMissingExpenses === null
      ? makeLimited("completed_missing_expenses", "Complete → Invoiced", "Expense/material check unavailable", "Expense data was not available, so missing expense/material checks cannot be calculated.", "/crm/expenses")
      : makeIssue({ key: "completed_missing_expenses", stage: "Complete → Invoiced", severity: "info", title: "Completed work has no expense/material record", count: completedMissingExpenses, reason: "Expense/material records help preserve job-costing history. Some small jobs may legitimately have none.", href: "/crm/expenses" })
  );

  if (hasAnyHeader(dataPresence.leadsData, ["completion_notes", "final_notes", "closeout_notes", "final_photo_url", "completion_photo_url"])) {
    const missingFinalProof = completedLeads.filter((lead) => !String(firstValue(lead, ["completion_notes", "final_notes", "closeout_notes", "final_photo_url", "completion_photo_url"])).trim()).length;
    checks.push(makeIssue({ key: "completed_missing_photos_or_notes", stage: "Complete → Invoiced", severity: "warning", title: "Completed work is missing final notes/photos", count: missingFinalProof, reason: "Closeout proof protects the business if there is a callback or dispute.", href: "/clients" }));
  } else {
    checks.push(makeLimited("completed_missing_photos_or_notes", "Complete → Invoiced", "Final notes/photos gate limited", "No dedicated final-notes or final-photo field was found in current job data.", "/clients"));
  }

  checks.push(
    makeIssue({ key: "invoiced_not_paid", stage: "Invoiced → Paid", severity: "warning", title: "Invoices are open or unpaid", count: openInvoices, reason: "Open invoices should be followed until collected.", href: "/invoices" }),
    makeIssue({ key: "overdue_invoices", stage: "Invoiced → Paid", severity: "critical", title: "Invoices are overdue", count: overdueInvoices, reason: "Overdue invoices need collection follow-up.", href: "/invoices?status=overdue" }),
    makeIssue({ key: "paid_not_closed", stage: "Paid → Closed", severity: "warning", title: "Paid jobs are not closed", count: paidNotClosed, reason: "Paid jobs should be closed after job costing, review request, and retention handoff are handled.", href: "/clients" })
  );

  if (hasAnyHeader(dataPresence.leadsData, ["review_requested_at", "review_request_sent_at", "review_status"])) {
    const missingReview = leads.filter((lead) => ["Paid", "Closed"].includes(normalizeLifecycleStatus(lead.status_code || lead.status)) && !String(firstValue(lead, ["review_requested_at", "review_request_sent_at", "review_status"])).trim()).length;
    checks.push(makeIssue({ key: "review_request_missing", stage: "Closed → Review Requested", severity: "warning", title: "Review request is missing", count: missingReview, reason: "Closed or paid jobs should trigger a review request when appropriate.", href: "/reviews" }));
  } else {
    checks.push(makeLimited("review_request_missing", "Closed → Review Requested", "Review-request tracking limited", "No per-job review-request field was found in current job data.", "/reviews"));
  }

  if (hasAnyHeader(dataPresence.leadsData, ["retention_status", "retention_next_touch_at", "follow_up_date", "retention_handoff_at"])) {
    const missingRetention = leads.filter((lead) => normalizeLifecycleStatus(lead.status_code || lead.status) === "Closed" && !String(firstValue(lead, ["retention_status", "retention_next_touch_at", "follow_up_date", "retention_handoff_at"])).trim()).length;
    checks.push(makeIssue({ key: "retention_handoff_missing", stage: "Review Requested → Retention", severity: "info", title: "Retention handoff is missing", count: missingRetention, reason: "Closed jobs should land in a future follow-up or retention path.", href: "/clients" }));
  } else {
    checks.push(makeLimited("retention_handoff_missing", "Review Requested → Retention", "Retention handoff not clearly implemented yet", "No per-job retention or future follow-up field was found in current job data.", "/clients"));
  }

  return buildSummary(checks, "sheets_rows", "Server-side checklist generated from existing Sheets-backed rows when available. Stored statuses are not changed.");
}

module.exports = {
  VE_OS_LIFECYCLE_ORDER,
  normalizeLifecycleStatus,
  buildCloseoutChecklist,
  buildCloseoutChecklistFromOwnerQueue,
};
