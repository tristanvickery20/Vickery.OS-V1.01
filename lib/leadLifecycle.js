// lib/leadLifecycle.js
// Leads is the canonical lifecycle row. Bookings and QuoteSnapshots are support tabs:
// - Bookings = scheduler capacity / visual segments
// - QuoteSnapshots = quote audit history
// Any lifecycle fields needed by CRM screens are mirrored into Leads here.

const { colToLetter, invalidateCache } = require("./sheets");
const { ensureTabHeaders } = require("./sheetsSchema");

const REQUIRED_LEAD_LIFECYCLE_HEADERS = [
  "id", "created_at", "name", "phone", "email", "address",
  "job_type", "estimated_value", "status", "quoted_price",
  "scheduled_date", "scheduled_datetime", "assigned_to", "notes",
  "schedule_window", "duration_minutes", "pricing_version",
  "last_quote_id", "quote_snapshot_json",
  "booking_id", "booking_group_id", "schedule_block",
  "block_allocated_minutes", "is_continuation", "booking_status",
];

function nowIso() { return new Date().toISOString(); }
function str(v) { return String(v ?? "").trim(); }
function cleanPhone(v) { return str(v).replace(/\D/g, ""); }
function toIdx(headers) { return Object.fromEntries((headers || []).map((h, i) => [str(h), i]).filter(([h]) => h)); }
function get(row, idx, key) { return idx[key] == null ? "" : str(row[idx[key]]); }
function put(row, idx, key, value, { onlyBlank = false } = {}) {
  if (idx[key] == null) return;
  if (value == null) return;
  const v = String(value);
  if (onlyBlank && str(row[idx[key]])) return;
  while (row.length <= idx[key]) row.push("");
  row[idx[key]] = v;
}

async function ensureLeadLifecycleHeaders(sheets, spreadsheetId) {
  await ensureTabHeaders("Leads", spreadsheetId);
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!1:1" }).catch(() => ({ data: { values: [] } }));
  let headers = ((resp.data.values || [])[0] || []).map(str).filter(Boolean);
  if (!headers.length) headers = [...REQUIRED_LEAD_LIFECYCLE_HEADERS];

  const missing = REQUIRED_LEAD_LIFECYCLE_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    headers = [...headers, ...missing];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Leads!1:1",
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [headers] },
    });
    invalidateCache(spreadsheetId, "Leads");
  }
  return headers;
}

function buildQuoteSnapshotJson(snapshot = {}, extra = {}) {
  if (!snapshot || Object.keys(snapshot).length === 0) return "";
  const compact = {
    quote_id: snapshot.quote_id || extra.quote_id || "",
    event_type: snapshot.event_type || "locked",
    job_type_id: snapshot.job_type_id || "",
    selected_options_json: snapshot.selected_options_json || "",
    selected_addons_json: snapshot.selected_addons_json || "",
    total_hours: snapshot.total_hours || "",
    labor_cost: snapshot.labor_cost || "",
    overhead_cost: snapshot.overhead_cost || "",
    material_allowance: snapshot.material_allowance || "",
    travel_fee: snapshot.travel_fee || "",
    final_price: snapshot.final_price || "",
    address_provided: snapshot.address_provided || "",
    pricing_version: snapshot.pricing_version || "",
    customer_name: snapshot.customer_name || "",
    phone: snapshot.phone || "",
    email: snapshot.email || "",
    address: snapshot.address || "",
    notes: snapshot.notes || "",
    ...extra,
  };
  return JSON.stringify(compact);
}

function findLeadRow(rows, idx, { leadId, quoteId, phone, email, bookingId }) {
  const phoneClean = cleanPhone(phone);
  const emailClean = str(email).toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (leadId && get(r, idx, "id") === leadId) return i;
    if (quoteId && get(r, idx, "last_quote_id") === quoteId) return i;
    if (bookingId && get(r, idx, "booking_id") === bookingId) return i;
  }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (phoneClean && cleanPhone(get(r, idx, "phone")) === phoneClean) return i;
    if (emailClean && get(r, idx, "email").toLowerCase() === emailClean) return i;
  }
  return -1;
}

const STATUS_RANK = {
  "": 0, Lead: 1, New: 1, "Estimate Sent": 2, Scheduled: 3,
  "In Progress": 4, Complete: 5, Invoiced: 6, Paid: 7, Closed: 8,
};
function chooseStatus(current, desired) {
  const c = str(current);
  const d = str(desired || "Scheduled");
  return (STATUS_RANK[d] || 0) >= (STATUS_RANK[c] || 0) ? d : c;
}
function leadIdForNewRow() {
  return `LEAD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function mirrorBookingToLead({ sheets, spreadsheetId, quoteId, leadId, snapshot = {}, booking = {}, desiredStatus = "Scheduled" }) {
  const guaranteedHeaders = await ensureLeadLifecycleHeaders(sheets, spreadsheetId);

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A1:BZ5000" });
  const rows = resp.data.values || [guaranteedHeaders];
  const headers = rows[0] && rows[0].length ? rows[0].map(str).filter(Boolean) : guaranteedHeaders;
  const idx = toIdx(headers);
  if (idx.id == null) throw new Error("Leads tab missing id header");

  const qid = str(quoteId || booking.quote_id || snapshot.quote_id);
  const resolvedLeadId = str(leadId || booking.lead_id || snapshot.lead_id);
  const rowIdx = findLeadRow(rows, idx, {
    leadId: resolvedLeadId,
    quoteId: qid,
    phone: booking.phone || snapshot.phone,
    email: booking.email || snapshot.email,
    bookingId: booking.booking_id,
  });

  const isNew = rowIdx < 0;
  const row = isNew ? new Array(headers.length).fill("") : [...(rows[rowIdx] || [])];
  while (row.length < headers.length) row.push("");

  const finalLeadId = isNew ? (resolvedLeadId || leadIdForNewRow()) : get(row, idx, "id");
  const start = str(booking.scheduled_datetime || booking.startIso || booking.start_iso);
  const scheduleBlock = str(booking.schedule_block || booking.block || booking.schedule_window);
  const status = String(booking.status || booking.booking_status || "").toLowerCase();
  const mappedStatus = status === "complete" ? "Complete" : desiredStatus;

  put(row, idx, "id", finalLeadId);
  put(row, idx, "created_at", nowIso(), { onlyBlank: true });
  put(row, idx, "last_quote_id", qid);
  put(row, idx, "name", booking.customer_name || snapshot.customer_name);
  put(row, idx, "phone", booking.phone || snapshot.phone);
  put(row, idx, "email", booking.email || snapshot.email);
  put(row, idx, "address", booking.address || snapshot.address);
  put(row, idx, "job_type", booking.job_type_id || snapshot.job_type_id);
  put(row, idx, "quoted_price", booking.final_price || snapshot.final_price);
  put(row, idx, "estimated_value", booking.final_price || snapshot.final_price);
  put(row, idx, "pricing_version", snapshot.pricing_version || booking.pricing_version);
  put(row, idx, "quote_snapshot_json", buildQuoteSnapshotJson(snapshot, { booking_id: booking.booking_id || "", lead_id: finalLeadId }));

  if (start) {
    put(row, idx, "scheduled_date", start.slice(0, 16));
    put(row, idx, "scheduled_datetime", start);
  }
  put(row, idx, "schedule_window", scheduleBlock);
  put(row, idx, "schedule_block", scheduleBlock);
  put(row, idx, "duration_minutes", booking.duration_minutes || snapshot.duration_minutes);
  put(row, idx, "booking_id", booking.booking_id);
  put(row, idx, "booking_group_id", booking.booking_group_id);
  put(row, idx, "block_allocated_minutes", booking.block_allocated_minutes);
  put(row, idx, "is_continuation", booking.is_continuation);
  put(row, idx, "booking_status", booking.status || booking.booking_status || "confirmed");
  put(row, idx, "assigned_to", booking.assigned_crew_names || booking.assigned_to);
  put(row, idx, "status", chooseStatus(get(row, idx, "status"), mappedStatus));

  const values = [row.slice(0, headers.length)];
  if (isNew) {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Leads!A:A", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values },
    });
  } else {
    const sheetRow = rowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `Leads!A${sheetRow}:${colToLetter(headers.length - 1)}${sheetRow}`,
      valueInputOption: "RAW", requestBody: { majorDimension: "ROWS", values },
    });
  }
  invalidateCache(spreadsheetId, "Leads");
  return finalLeadId;
}

async function enrichBookingsFromLeads({ sheets, spreadsheetId, bookings }) {
  await ensureLeadLifecycleHeaders(sheets, spreadsheetId);
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A1:BZ5000" }).catch(() => ({ data: { values: [] } }));
  const rows = resp.data.values || [];
  if (rows.length < 2) return bookings;
  const headers = (rows[0] || []).map(str).filter(Boolean);
  const byLead = new Map(), byQuote = new Map(), byBooking = new Map();
  rows.slice(1).forEach((r) => {
    const obj = Object.fromEntries(headers.map((h, i) => [h, r[i] || ""]));
    if (obj.id) byLead.set(obj.id, obj);
    if (obj.last_quote_id) byQuote.set(obj.last_quote_id, obj);
    if (obj.booking_id) byBooking.set(obj.booking_id, obj);
  });
  return bookings.map((b) => {
    const lead = byLead.get(b.lead_id) || byQuote.get(b.quote_id) || byBooking.get(b.booking_id);
    if (!lead) return b;
    return {
      ...b,
      lead_id: b.lead_id || lead.id || "",
      customer_name: lead.name || b.customer_name || "",
      phone: lead.phone || b.phone || "",
      email: lead.email || b.email || "",
      address: lead.address || b.address || "",
      assigned_crew_names: lead.assigned_to || b.assigned_crew_names || "",
      lead_status: lead.status || "",
    };
  });
}

module.exports = {
  mirrorBookingToLead,
  enrichBookingsFromLeads,
  buildQuoteSnapshotJson,
  ensureLeadLifecycleHeaders,
};
