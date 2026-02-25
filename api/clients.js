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

async function handleGetClients(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const q = normalizeStr(parsed.query.q || "");
    const status = normalizeStr(parsed.query.status || "");
    const limitRaw = Number(parsed.query.limit) || 200;
    const limit = Math.min(Math.max(1, limitRaw), 500);

    const leads = await readTab("Leads");

    let results = leads.map((l) => ({
      id: l.id || "",
      client_id: l.client_id || "",
      job_number: pickJobNumber(l),
      name: l.name || "",
      phone: l.phone || "",
      address: l.address || "",
      status: l.status || "",
      estimated_value: l.estimated_value || "",
      scheduled_date: l.scheduled_date || "",
      assigned_to: l.assigned_to || "",
      notes: l.notes || "",
    }));

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
