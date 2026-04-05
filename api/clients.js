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

    const [leads, snapshots, bookings] = await Promise.all([
      readTab("Leads"),
      readTab("QuoteSnapshots").catch(() => []),
      readTab("Bookings").catch(() => []),
    ]);

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

    // Build name lookup from Bookings — this is what the Schedule page uses
    const bookingByQuoteId = {}, bookingByPhone = {};
    for (const b of bookings) {
      const qid   = stripHtml(b.quote_id       || "").trim();
      const bName = stripHtml(b.customer_name  || "").trim();
      const bPhone= stripHtml(b.phone          || "").replace(/\D/g, "");
      const entry = { name: bName, phone: bPhone, email: stripHtml(b.email || "").trim(), address: stripHtml(b.address || "").trim() };
      if (qid   && bName && !bookingByQuoteId[qid])    bookingByQuoteId[qid]   = entry;
      if (bPhone && bName && !bookingByPhone[bPhone])  bookingByPhone[bPhone]  = entry;
    }

    let results = leads.map((l) => {
      let name    = stripHtml(l.name    || "").trim();
      let phone   = stripHtml(l.phone   || "").trim();
      let email   = stripHtml(l.email   || "").trim();
      let address = stripHtml(l.address || "").trim();

      // Enrich missing fields — 4-layer lookup
      if (!name || !phone || !email) {
        const cleanPh = phone.replace(/\D/g, "");
        const qid     = (l.last_quote_id || "").trim();
        const src =
          (qid     && snapByQuoteId[qid])      ||
          (cleanPh && snapByPhone[cleanPh])     ||
          (qid     && bookingByQuoteId[qid])    ||
          (cleanPh && bookingByPhone[cleanPh]);
        if (src) {
          if (!name    && src.name)    name    = src.name;
          if (!phone   && src.phone)   phone   = src.phone;
          if (!email   && src.email)   email   = src.email;
          if (!address && src.address) address = src.address;
        }
      }

      return {
        id: l.id || "",
        client_id: l.client_id || "",
        job_number: pickJobNumber(l),
        name,
        phone,
        address,
        status: l.status || "",
        estimated_value: l.estimated_value || "",
        scheduled_date: l.scheduled_date || "",
        assigned_to: l.assigned_to || "",
        notes: l.notes || "",
      };
    });

    if (status && status !== "all") {
      results = results.filter((r) => normalizeStr(r.status) === status);
    }

    if (q) {
      results = results.filter((r) => {
        const fields = [r.name, r.phone, r.address, r.notes, r.assigned_to, r.job_number, r.client_id];
        return fields.some((f) => normalizeStr(f).includes(q));
      });
    }

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

module.exports = {
  handleGetClients,
  handleGetClientById,
  handleGetClientRequests,
  handleGetClientQuotes,
  handleGetClientJobs,
  handleGetClientNotes,
  handleGetClientAttachments,
};
