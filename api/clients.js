const { readTab, parseISODateSafe, normalizeStr } = require("../lib/readTab");
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

    const [clientsTab, leadsTab, snapshots, bookings, staffRows] = await Promise.all([
      readTab("Clients").catch(() => []),
      readTab("Leads").catch(() => []),
      readTab("QuoteSnapshots").catch(() => []),
      readTab("Bookings").catch(() => []),
      readTab("Staff").catch(() => []),
    ]);
    const staffById = {};
    const staffByName = {};
    for (const s of staffRows) {
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

    // Build name lookup from QuoteSnapshots (prefer "locked" event)
    const snapByQuoteId = {}, snapByPhone = {};
    for (const s of snapshots) {
      const qid   = stripHtml(s.quote_id      || "").trim();
      const sName = stripHtml(s.customer_name || "").trim();
      const sPhone= stripHtml(s.phone         || "").replace(/\D/g, "");
      const isPref= (s.event_type || "") === "locked";
      const entry = { name: sName, phone: sPhone, email: stripHtml(s.email || "").trim(), address: stripHtml(s.address || "").trim() };
      if (qid   && (!snapByQuoteId[qid]   || isPref)) snapByQuoteId[qid]   = entry;
      if (sPhone && sName && (!snapByPhone[sPhone] || isPref)) snapByPhone[sPhone] = entry;
    }

    // Build name lookup from Bookings — guaranteed to have customer_name
    const bookingByQuoteId = {}, bookingByPhone = {}, bookingCrewByQuoteId = {}, bookingCrewByPhone = {};
    for (const b of bookings) {
      const qid   = stripHtml(b.quote_id       || "").trim();
      const bName = stripHtml(b.customer_name  || "").trim();
      const bPhone= stripHtml(b.phone          || "").replace(/\D/g, "");
      const entry = { name: bName, phone: bPhone, email: stripHtml(b.email || "").trim(), address: stripHtml(b.address || "").trim() };
      const fallbackIds = [b.assigned_tech_id, b.assigned_tech_ids].filter(Boolean).join(",");
      const crew = resolveCrewDisplay(b.assigned_crew_names || b.assigned_to || fallbackIds);
      if (qid   && bName && !bookingByQuoteId[qid])    bookingByQuoteId[qid]   = entry;
      if (qid   && crew && !bookingCrewByQuoteId[qid]) bookingCrewByQuoteId[qid] = crew;
      if (bPhone && bName && !bookingByPhone[bPhone])  bookingByPhone[bPhone]  = entry;
      if (bPhone && crew && !bookingCrewByPhone[bPhone]) bookingCrewByPhone[bPhone] = crew;
    }

    function enrichAndShape(l, idField, statusField, addressField) {
      let name    = stripHtml(l.name    || "").trim();
      let phone   = stripHtml(l.phone   || "").trim();
      let email   = stripHtml(l.email   || "").trim();
      let address = stripHtml(l[addressField || "address"] || l.address || l.primary_address || "").trim();
      const status = stripHtml(l[statusField] || l.status || l.status_code || "").trim();
      let assignedTo = stripHtml(l.assigned_to || "").trim();

      // Enrich missing fields via 4-layer lookup
      if (!name || !phone || !email) {
        const cleanPh = phone.replace(/\D/g, "");
        const qid     = stripHtml(l.last_quote_id || "").trim();
        const src =
          (qid     && snapByQuoteId[qid])    ||
          (cleanPh && snapByPhone[cleanPh])   ||
          (qid     && bookingByQuoteId[qid])  ||
          (cleanPh && bookingByPhone[cleanPh]);
        if (src) {
          if (!name    && src.name)    name    = src.name;
          if (!phone   && src.phone)   phone   = src.phone;
          if (!email   && src.email)   email   = src.email;
          if (!address && src.address) address = src.address;
        }
      }

      if (!assignedTo) {
        const cleanPh = phone.replace(/\D/g, "");
        const qid     = stripHtml(l.last_quote_id || "").trim();
        assignedTo = (qid && bookingCrewByQuoteId[qid]) || (cleanPh && bookingCrewByPhone[cleanPh]) || assignedTo;
      }

      return {
        id:              stripHtml(l[idField] || l.id || ""),
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
        notes:           l.notes || l.job_description || "",
        created_at:      l.created_at || "",
      };
    }

    // CRM-created leads live in the Clients tab — these take priority
    const seenIds = new Set();
    const clientsRows = clientsTab.map(l => {
      const shaped = enrichAndShape(l, "id", "status_code", "address");
      seenIds.add(shaped.id);
      if (l.lead_id) seenIds.add(stripHtml(l.lead_id));
      return shaped;
    });

    // Legacy quote-flow leads from the Leads tab — skip any already in Clients
    const leadsRows = leadsTab
      .filter(l => {
        const rawId = stripHtml(l.id || "").trim();
        return rawId && !seenIds.has(rawId);
      })
      .map(l => enrichAndShape(l, "id", "status", "address"));

    let results = [...clientsRows, ...leadsRows];

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
    const [clients, properties] = await Promise.all([readTab("Clients"), readTab("Properties")]);

    const client = clients.find((c) => c.id === clientId);
    if (!client) return json(res, 404, { ok: false, error: "Client not found" });

    const props = properties.filter((p) => p.client_id === clientId);
    const prop = props.find(
      (p) => p.is_primary === "true" || p.is_primary === "1" || p.is_primary === "yes"
    ) || props.sort((a, b) => {
      const da = parseISODateSafe(a.updated_at) || parseISODateSafe(a.created_at) || new Date(0);
      const db = parseISODateSafe(b.updated_at) || parseISODateSafe(b.created_at) || new Date(0);
      return db - da;
    })[0] || null;

    json(res, 200, {
      ok: true,
      client: {
        id: client.id,
        name: client.name || "",
        phone: client.phone || "",
        email: client.email || "",
        sms_opt_in: client.sms_opt_in || "",
        job_description: client.job_description || "",
        status_code: client.status_code || "",
        created_at: client.created_at || "",
        updated_at: client.updated_at || "",
        last_activity_at: client.last_activity_at || "",
        primary_property: prop
          ? {
              id: prop.id,
              address_line1: prop.address_line1 || "",
              address_line2: prop.address_line2 || "",
              city: prop.city || "",
              state: prop.state || "",
              zip: prop.zip || "",
              lat: prop.lat || "",
              lng: prop.lng || "",
              notes: prop.notes || "",
            }
          : null,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientRequests(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/requests")[0]);
    const rows = await readTab("Requests");
    const filtered = sortDescByCreated(rows.filter((r) => r.client_id === clientId));
    json(res, 200, {
      ok: true,
      requests: filtered.map((r) => ({
        id: r.id,
        created_at: r.created_at || "",
        updated_at: r.updated_at || "",
        summary: r.summary || "",
        status_code: r.status_code || "",
        deposit_required: r.deposit_required || "",
        deposit_received: r.deposit_received || "",
        estimated_value: r.estimated_value || "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientQuotes(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/quotes")[0]);
    const rows = await readTab("Quotes");
    const filtered = sortDescByCreated(
      rows.filter((r) => (r.client_id || r.lead_id || "") === clientId)
    );
    json(res, 200, {
      ok: true,
      quotes: filtered.map((r) => ({
        id: r.quote_id || r.id || "",
        created_at: r.created_at || "",
        status_code: r.status_code || "",
        quoted_price: r.quoted_price || "",
        service_key: r.service_key || "",
        pricing_version: r.pricing_version || "",
        request_id: r.request_id || "",
      })),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClientJobs(req, res) {
  try {
    const clientId = decodeURIComponent(req.url.split("/api/clients/")[1].split("/jobs")[0]);
    const rows = await readTab("Jobs");
    const filtered = sortDescByCreated(rows.filter((r) => r.client_id === clientId));
    json(res, 200, {
      ok: true,
      jobs: filtered.map((r) => ({
        id: r.id,
        created_at: r.created_at || "",
        status_code: r.status_code || "",
        description: r.description || "",
        completed_at: r.completed_at || "",
        request_id: r.request_id || "",
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

    const [requests, quotes, jobs, bookings, invoices, payments] = await Promise.all([
      readTab("Requests").catch(() => []),
      readTab("Quotes").catch(() => []),
      readTab("Jobs").catch(() => []),
      readTab("Bookings").catch(() => []),
      readTab("Invoices").catch(() => []),
      readTab("Payments").catch(() => []),
    ]);

    const events = [];

    // Requests (Lead stage)
    for (const r of requests.filter(x => x.client_id === clientId)) {
      events.push({
        type: "request",
        event_id: r.id,
        date: r.created_at || "",
        label: r.summary || "Service Request",
        status: r.status_code || "",
        amount: r.estimated_value || "",
        link: null,
      });
    }

    // Quotes
    for (const q of quotes.filter(x => (x.client_id || x.lead_id || "") === clientId)) {
      events.push({
        type: "quote",
        event_id: q.quote_id || q.id || "",
        date: q.created_at || "",
        label: "Quote" + (q.service_key ? " \u00b7 " + q.service_key : ""),
        status: q.status_code || "",
        amount: q.quoted_price || "",
        link: null,
      });
    }

    // Bookings (scheduled appointments)
    for (const b of bookings.filter(x => x.client_id === clientId || x.phone === (clientId))) {
      const bookingId = b.booking_id || b.id || "";
      events.push({
        type: "booking",
        event_id: bookingId,
        date: b.scheduled_datetime || b.created_at || "",
        label: "Booking" + (b.address ? " \u00b7 " + b.address : ""),
        status: b.status || "scheduled",
        amount: b.final_price || "",
        link: bookingId ? "/crm/schedule?booking=" + encodeURIComponent(bookingId) : null,
        assigned_to: b.assigned_tech_id || "",
      });
    }

    // Jobs
    for (const j of jobs.filter(x => x.client_id === clientId)) {
      events.push({
        type: "job",
        event_id: j.id,
        date: j.created_at || "",
        label: j.description || "Job",
        status: j.status_code || "",
        amount: "",
        link: null,
        completed_at: j.completed_at || "",
      });
    }

    // Invoices
    const clientInvoices = invoices.filter(x => x.client_id === clientId);
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
    const totalInvoiced = clientInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
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

module.exports = {
  handleGetClients,
  handleGetClientById,
  handleGetClientRequests,
  handleGetClientQuotes,
  handleGetClientJobs,
  handleGetClientNotes,
  handleGetClientAttachments,
  handleGetClientTimeline,
};
