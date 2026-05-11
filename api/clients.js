const { readTab, parseISODateSafe, normalizeStr } = require("../lib/readTab");
const { getSheetsClient, colToLetter, invalidateCache } = require("../lib/sheets");
const { hrSpreadsheetId } = require("../lib/hrSheetClient");
const { logAudit, genRequestId } = require("../lib/audit");
const url = require("url");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sortDescByCreated(arr) {
  return arr.sort((a, b) => {
    const da = parseISODateSafe(a.created_at) || new Date(0);
    const db = parseISODateSafe(b.created_at) || new Date(0);
    return db - da;
  });
}

function pickJobNumber(lead) {
  if (lead.job_number && String(lead.job_number).trim()) return String(lead.job_number).trim();
  const s = String(lead.id || "").trim();
  if (!s) return "";
  const nums = s.replace(/\D/g, "");
  if (nums.length >= 6) return nums.slice(-6);
  return s.length >= 6 ? s.slice(-6) : s;
}

function bestSortDate(lead) {
  return (
    parseISODateSafe(lead.scheduled_date) ||
    parseISODateSafe(lead.created_at) ||
    new Date(0)
  );
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

async function handleGetClients(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const q = normalizeStr(parsed.query.q || "");
    const status = normalizeStr(parsed.query.status || "");
    const limitRaw = Number(parsed.query.limit) || 200;
    const limit = Math.min(Math.max(1, limitRaw), 500);

    const sheets = await getSheetsClient();
    const [leadsTab, staffRawResp] = await Promise.all([
      readTab("Leads").catch(() => []),
      sheets.spreadsheets.values.get({ spreadsheetId: hrSpreadsheetId(), range: "Staff!A:Z" }).catch(() => ({ data: { values: [] } })),
    ]);
    const _staffValues = staffRawResp.data.values || [];
    const staffRows = _staffValues.length > 1
      ? _staffValues.slice(1).map(r => Object.fromEntries((_staffValues[0] || []).map((h, i) => [h, String(r[i] || "")])))
      : [];

    const staffById = {};
    const staffByName = {};
    for (const s of (staffRows || [])) {
      const sid = stripHtml(s.staff_id || "").trim();
      const full = `${stripHtml(s.first_name || "").trim()} ${stripHtml(s.last_name || "").trim()}`.trim();
      if (sid && full) staffById[sid] = full;
      if (full) staffByName[full.toLowerCase()] = full;
    }
    function resolveCrewDisplay(rawCrew) {
      const parts = String(rawCrew || "").split(",").map(x => stripHtml(x).trim()).filter(Boolean);
      if (!parts.length) return "";
      return parts.map((p) => staffById[p] || staffByName[p.toLowerCase()] || p).join(", ");
    }

    function enrichAndShape(l) {
      let name    = stripHtml(l.name    || "").trim();
      let phone   = stripHtml(l.phone   || "").trim();
      let email   = stripHtml(l.email   || "").trim();
      let address = stripHtml(l.address || "").trim();
      const status = stripHtml(l.status || l.status_code || "").trim();
      let assignedTo = stripHtml(l.assigned_to || "").trim();
      if (assignedTo) assignedTo = resolveCrewDisplay(assignedTo);

      return {
        id:              stripHtml(l.id || ""),
        client_id:       stripHtml(l.client_id || l.id || ""),
        job_number:      pickJobNumber(l),
        name,
        phone,
        email,
        address,
        status,
        estimated_value: l.estimated_value || "",
        scheduled_date:  l.scheduled_date  || "",
        assigned_to:     assignedTo || "",
        notes:           l.notes || "",
        created_at:      l.created_at || "",
      };
    }

    let results = leadsTab
      .filter(l => stripHtml(l.id || "").trim())
      .map(l => enrichAndShape(l));

    if (status && status !== "all") {
      results = results.filter((r) => normalizeStr(r.status) === status);
    }

    if (q) {
      results = results.filter((r) => {
        const fields = [r.name, r.phone, r.address, r.notes, r.assigned_to, r.job_number, r.client_id];
        return fields.some((f) => normalizeStr(f).includes(q));
      });
    }

    // Sort before grouping so within each phone group the first entry = most recent lead
    results.sort((a, b) => bestSortDate(b) - bestSortDate(a));

    // ── Group by normalized phone: one card per customer ──────────────────────
    const phoneGroups = new Map(); // normPhone → [records, sorted most-recent-first]
    const noPhoneCards = [];       // no phone → one card each (can't group without key)

    for (const r of results) {
      const normPhone = r.phone.replace(/\D/g, "");
      if (!normPhone) {
        noPhoneCards.push({ ...r, job_count: 1 });
      } else {
        if (!phoneGroups.has(normPhone)) phoneGroups.set(normPhone, []);
        phoneGroups.get(normPhone).push(r);
      }
    }

    const grouped = [];
    for (const [, group] of phoneGroups) {
      if (group.length === 1) {
        grouped.push({ ...group[0], job_count: 1 });
        continue;
      }
      // Representative = most recent lead (first after sort above)
      const rep = group[0];
      // Most-complete name = longest non-empty string across the group
      const bestName = group.reduce((best, r) => {
        const n = stripHtml(r.name || "").trim();
        return n.length > best.length ? n : best;
      }, "");
      // Most-complete address = longest non-empty string
      const bestAddress = group.reduce((best, r) => {
        const a = stripHtml(r.address || "").trim();
        return a.length > best.length ? a : best;
      }, "");
      // Sum estimated values
      const totalValue = group.reduce((sum, r) => {
        const v = Number(r.estimated_value);
        return sum + (isFinite(v) && v > 0 ? v : 0);
      }, 0);
      // Most recent scheduled date across all group members
      const bestScheduled = group.reduce((best, r) => {
        if (!r.scheduled_date) return best;
        if (!best) return r.scheduled_date;
        return new Date(r.scheduled_date) > new Date(best) ? r.scheduled_date : best;
      }, "");

      grouped.push({
        ...rep,
        name:                  bestName    || rep.name,
        address:               bestAddress || rep.address,
        estimated_value:       totalValue  || "",
        total_estimated_value: totalValue  || "",
        scheduled_date:        bestScheduled || rep.scheduled_date,
        job_count:             group.length,
      });
    }

    // Interleave grouped + no-phone cards, re-sort, then limit
    results = [...grouped, ...noPhoneCards];
    results.sort((a, b) => bestSortDate(b) - bestSortDate(a));
    results = results.slice(0, limit);

    json(res, 200, { ok: true, clients: results });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientById(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1]);
    const leads = await readTab("Leads");

    const lead = leads.find((l) => l.id === clientId);
    if (!lead) return json(res, 404, { ok: false, error: "Client not found" });

    json(res, 200, {
      ok: true,
      client: {
        id: lead.id,
        name: lead.name || "",
        phone: lead.phone || "",
        email: lead.email || "",
        sms_opt_in: lead.sms_opt_in || "",
        job_description: lead.notes || "",
        status_code: lead.status || "",
        created_at: lead.created_at || "",
        updated_at: lead.updated_at || lead.created_at || "",
        last_activity_at: lead.updated_at || lead.created_at || "",
        primary_property: lead.address ? {
          id: lead.id,
          address_line1: lead.address || "",
          address_line2: "",
          city: "",
          state: "",
          zip: "",
          lat: "",
          lng: "",
          notes: "",
        } : null,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientRequests(req, res) {
  // Requests tab is removed — leads are self-contained. Return empty list.
  json(res, 200, { ok: true, requests: [] });
}

async function handleGetClientQuotes(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/quotes")[0]);
    const rows = await readTab("QuoteSnapshots").catch(() => []);
    const filtered = sortDescByCreated(
      rows.filter((r) => (r.lead_id || r.client_id || r.quote_id || "") === clientId)
    );
    json(res, 200, {
      ok: true,
      quotes: filtered.map((r) => ({
        id: r.quote_id || r.event_id || "",
        created_at: r.created_at || "",
        status_code: r.status || "",
        quoted_price: r.final_price || "",
        service_key: r.job_type_id || "",
        pricing_version: r.pricing_version || "",
        request_id: "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientJobs(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/jobs")[0]);
    const leads = await readTab("Leads");
    // Each Lead IS a job — return all leads belonging to this client/phone group
    const lead = leads.find(l => l.id === clientId);
    const phone = lead ? lead.phone : "";
    const related = leads.filter(l => l.id === clientId || (phone && l.phone === phone));
    json(res, 200, {
      ok: true,
      jobs: sortDescByCreated(related).map((r) => ({
        id: r.id,
        created_at: r.created_at || "",
        status_code: r.status || "",
        description: r.notes || r.job_type || "",
        completed_at: r.paid_date || r.invoice_date || "",
        request_id: "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientNotes(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/notes")[0]);
    const rows = await readTab("Notes");
    const filtered = sortDescByCreated(
      rows.filter((r) => r.entity_type === "client" && r.entity_id === clientId)
    );
    json(res, 200, {
      ok: true,
      notes: filtered.map((r) => ({
        id: r.id,
        created_at: r.created_at || "",
        author: r.author || "",
        body: r.body || "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientAttachments(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/attachments")[0]);
    const rows = await readTab("Attachments");
    const filtered = sortDescByCreated(
      rows.filter((r) => r.entity_type === "client" && r.entity_id === clientId)
    );
    json(res, 200, {
      ok: true,
      attachments: filtered.map((r) => ({
        id: r.id,
        created_at: r.created_at || "",
        file_url: r.file_url || "",
        file_type: r.file_type || "",
        category: r.category || "",
        uploaded_by: r.uploaded_by || "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/clients/:id/timeline
// Returns a unified, chronologically-sorted timeline of all client events:
// requests, quotes, jobs, invoices, and payments — each with a type, date, amount, and status.
async function handleGetClientTimeline(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/timeline")[0]);

    const [leads, invoices, payments] = await Promise.all([
      readTab("Leads").catch(() => []),
      readTab("Invoices").catch(() => []),
      readTab("Payments").catch(() => []),
    ]);

    const lead = leads.find(l => l.id === clientId) || {};
    const phone = lead.phone || "";
    const relatedLeads = leads.filter(l => l.id === clientId || (phone && l.phone === phone));

    const events = [];

    // Each related lead is a job event
    for (const r of relatedLeads) {
      events.push({
        type: "request",
        event_id: r.id,
        date: r.created_at || "",
        label: r.notes || r.job_type || "Service Request",
        status: r.status || "",
        amount: r.estimated_value || "",
        link: null,
      });
    }

    // Quotes from QuoteSnapshots
    const snapshots = await readTab("QuoteSnapshots").catch(() => []);
    for (const q of snapshots.filter(x => (x.lead_id || x.client_id || "") === clientId)) {
      events.push({
        type: "quote",
        event_id: q.quote_id || q.event_id || "",
        date: q.created_at || "",
        label: "Quote" + (q.service_key ? " \u00b7 " + q.service_key : ""),
        status: q.status_code || "",
        amount: q.quoted_price || "",
        link: null,
      });
    }

    // Bookings: now stored as columns on Leads — include scheduled leads as booking events
    for (const r of relatedLeads.filter(x => x.booking_id || x.scheduled_date)) {
      if (!r.booking_id) continue;
      events.push({
        type: "booking",
        event_id: r.booking_id,
        date: r.scheduled_date || r.created_at || "",
        label: "Booking" + (r.address ? " \u00b7 " + r.address : ""),
        status: r.booking_status || r.status || "scheduled",
        amount: r.quoted_price || r.estimated_value || "",
        link: r.booking_id ? "/crm/schedule?booking=" + encodeURIComponent(r.booking_id) : null,
        assigned_to: r.assigned_to || "",
      });
    }

    // Invoices
    const clientInvoices = invoices.filter(x => x.lead_id === clientId || x.client_id === clientId);
    const invoiceIds = new Set(clientInvoices.map(x => x.id));

    for (const inv of clientInvoices) {
      // Determine sync state: synced if provider_ref present, error if void with no ref after being sent
      const sc = String(inv.status_code || "").toLowerCase();
      const hasRef = inv.provider_ref && inv.provider_ref.trim() !== "";
      const syncState = hasRef ? "synced" : (sc === "void" ? "error" : "pending");

      events.push({
        type: "invoice",
        event_id: inv.id,
        date: inv.issued_at || inv.created_at || "",
        label: inv.invoice_number || "Invoice",
        status: inv.status_code || "",
        amount: inv.total || "",
        balance_due: inv.balance_due || "0",
        paid_amount: inv.paid_amount || "0",
        provider_ref: inv.provider_ref || "",
        sync_state: syncState,
        link: "/invoices/" + encodeURIComponent(inv.id),
      });
    }

    // Payments (for invoices belonging to this client)
    for (const pay of payments.filter(x => invoiceIds.has(x.invoice_id))) {
      events.push({
        type: "payment",
        event_id: pay.id,
        date: pay.payment_date || pay.created_at || "",
        label: "Payment" + (pay.method ? " \u00b7 " + pay.method : ""),
        status: "recorded",
        amount: pay.amount || "",
        method: pay.method || "",
        reference: pay.reference || "",
        invoice_id: pay.invoice_id || "",
        link: null,
      });
    }

    // Sort chronologically, newest first
    events.sort((a, b) => {
      const da = a.date ? new Date(a.date) : new Date(0);
      const db = b.date ? new Date(b.date) : new Date(0);
      return db - da;
    });

    // Balance summary
    const totalInvoiced = (clientInvoices || []).reduce((s, i) => s + Number(i.total || 0), 0);
    const totalPaid     = clientInvoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const openBalance   = Math.max(0, Math.round((totalInvoiced - totalPaid) * 100) / 100);

    json(res, 200, {
      ok: true,
      timeline: events,
      summary: {
        total_invoiced: Math.round(totalInvoiced * 100) / 100,
        total_paid:     Math.round(totalPaid * 100) / 100,
        open_balance:   openBalance,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function readTabRaw(sheets, spreadsheetId, tabName) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:AZ5000`,
    });
    const values = resp.data.values || [];
    const headers = values[0] || [];
    const rows = values.length >= 2 ? values.slice(1) : [];
    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

async function handleMergeClients(req, res) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");

    const primaryId   = String(body.primary_id   || "").trim();
    const secondaryId = String(body.secondary_id || "").trim();

    if (!primaryId || !secondaryId) {
      return json(res, 400, { ok: false, error: "primary_id and secondary_id are required" });
    }
    if (primaryId === secondaryId) {
      return json(res, 400, { ok: false, error: "Cannot merge a record with itself" });
    }

    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "CRM_SHEET_ID not configured" });

    const sheets = await getSheetsClient();

    // Leads are self-contained — merge only operates on the Leads tab
    const leadsRaw = await readTabRaw(sheets, spreadsheetId, "Leads");

    const lh = leadsRaw.headers;
    const l_id    = lh.indexOf("id");
    const l_name  = lh.indexOf("name");
    const l_phone = lh.indexOf("phone");

    let primaryName = "";
    let primaryPhone = "";
    for (const row of leadsRaw.rows) {
      const rid = l_id >= 0 ? String(row[l_id] || "").trim() : "";
      if (rid === primaryId) {
        if (l_name  >= 0 && !primaryName)  primaryName  = String(row[l_name]  || "").trim();
        if (l_phone >= 0 && !primaryPhone) primaryPhone = String(row[l_phone] || "").trim();
      }
    }

    if (!primaryPhone) {
      return json(res, 404, { ok: false, error: "Primary record not found or has no phone number" });
    }
    const normPrimary = primaryPhone.replace(/\D/g, "");

    let secondaryPhone = "";
    for (const row of leadsRaw.rows) {
      const rid = l_id >= 0 ? String(row[l_id] || "").trim() : "";
      if (rid === secondaryId) {
        if (l_phone >= 0) secondaryPhone = String(row[l_phone] || "").trim();
        break;
      }
    }
    const normSecondary = secondaryPhone ? secondaryPhone.replace(/\D/g, "") : "";

    if (normPrimary && normSecondary && normPrimary === normSecondary) {
      return json(res, 400, { ok: false, error: "These records already share the same phone number and are already grouped together" });
    }

    let leadsUpdated = 0;
    const batchRequests = [];

    for (let i = 0; i < leadsRaw.rows.length; i++) {
      const row = leadsRaw.rows[i];
      const rid = l_id    >= 0 ? String(row[l_id]    || "").trim() : "";
      const rph = l_phone >= 0 ? String(row[l_phone] || "").replace(/\D/g, "") : "";
      const inGroup = rid === secondaryId || (normSecondary && rph === normSecondary);
      if (!inGroup) continue;
      const sheetRow = i + 2;
      if (l_phone >= 0) batchRequests.push({ range: `Leads!${colToLetter(l_phone)}${sheetRow}`, values: [[primaryPhone]] });
      if (l_name >= 0 && primaryName) batchRequests.push({ range: `Leads!${colToLetter(l_name)}${sheetRow}`, values: [[primaryName]] });
      leadsUpdated++;
    }

    if (leadsUpdated === 0) {
      return json(res, 404, { ok: false, error: "No rows found for the secondary record — merge aborted" });
    }

    if (batchRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: batchRequests },
      });
    }

    invalidateCache(spreadsheetId, "Leads");

    await logAudit({
      actor: "staff",
      action: "merge_clients",
      entity_type: "client",
      entity_id: primaryId,
      field: "merge",
      old_value: secondaryId,
      new_value: primaryId,
      note: `Merged secondary record ${secondaryId} (phone: ${secondaryPhone || "none"}) into primary ${primaryId} (phone: ${primaryPhone}). Updated ${leadsUpdated} lead row(s).`,
      source: "crm",
      request_id: genRequestId(),
    });

    json(res, 200, {
      ok: true,
      primary_id: primaryId,
      secondary_id: secondaryId,
      leads_updated: leadsUpdated,
      clients_updated: 0,
      message: `Merged ${secondaryId} into ${primaryId}. Updated ${leadsUpdated} row(s).`,
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetClients,
  handleGetClientById,
  handleGetClientRequests,
  handleGetClientQuotes,
  handleGetClientJobs,
  handleGetClientNotes,
  handleGetClientAttachments,
  handleGetClientTimeline,
  handleMergeClients,
};
