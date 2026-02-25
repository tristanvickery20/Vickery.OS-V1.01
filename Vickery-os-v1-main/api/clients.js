const { readTab, parseISODateSafe, normalizeStr } = require("../lib/readTab");
const url = require("url");

function bestDate(client) {
  return (
    parseISODateSafe(client.last_activity_at) ||
    parseISODateSafe(client.updated_at) ||
    parseISODateSafe(client.created_at) ||
    new Date(0)
  );
}

function pickPrimaryProperty(properties, clientId) {
  const props = properties.filter((p) => p.client_id === clientId);
  if (props.length === 0) return null;

  const primary = props.find(
    (p) => p.is_primary === "true" || p.is_primary === "1" || p.is_primary === "yes"
  );
  if (primary) return primary;

  return props.sort((a, b) => {
    const da = parseISODateSafe(a.updated_at) || parseISODateSafe(a.created_at) || new Date(0);
    const db = parseISODateSafe(b.updated_at) || parseISODateSafe(b.created_at) || new Date(0);
    return db - da;
  })[0];
}

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

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function pickJobNumberFromLeadId(leadId) {
  // Deterministic: prefer last 6 digits if present; else fallback to last 6 chars.
  const s = String(leadId || "").trim();
  if (!s) return "";
  const nums = s.replace(/\D/g, "");
  if (nums.length >= 6) return nums.slice(-6);
  return s.length >= 6 ? s.slice(-6) : s;
}

function pickBestLeadForClient(leads, client) {
  // Deterministic join (no schema changes):
  // 1) phone exact match (digits only)
  // 2) email exact match (lower)
  // 3) name substring match
  // If multiple matches -> newest created_at wins.

  const cPhone = digitsOnly(client.phone);
  const cEmail = normalizeStr(client.email);
  const cName = normalizeStr(client.name);

  const withCreated = (l) => ({
    lead: l,
    d: parseISODateSafe(l.created_at) || new Date(0),
  });

  // phone
  if (cPhone) {
    const matches = leads
      .filter((l) => digitsOnly(l.phone) && digitsOnly(l.phone) === cPhone)
      .map(withCreated)
      .sort((a, b) => b.d - a.d);
    if (matches.length) return matches[0].lead;
  }

  // email
  if (cEmail) {
    const matches = leads
      .filter((l) => normalizeStr(l.email) && normalizeStr(l.email) === cEmail)
      .map(withCreated)
      .sort((a, b) => b.d - a.d);
    if (matches.length) return matches[0].lead;
  }

  // name contains (either direction)
  if (cName) {
    const matches = leads
      .filter((l) => {
        const ln = normalizeStr(l.name);
        if (!ln) return false;
        return ln.includes(cName) || cName.includes(ln);
      })
      .map(withCreated)
      .sort((a, b) => b.d - a.d);
    if (matches.length) return matches[0].lead;
  }

  return null;
}

async function handleGetClients(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const q = normalizeStr(parsed.query.q || "");
    const status = normalizeStr(parsed.query.status || "");
    const limitRaw = Number(parsed.query.limit) || 200;
    const limit = Math.min(Math.max(1, limitRaw), 500);

    // NEW: include Leads to enrich list rows (scheduled_date, estimated_value, job_number)
    const [clients, properties, leads] = await Promise.all([
      readTab("Clients"),
      readTab("Properties"),
      readTab("Leads"),
    ]);

    const propsByClient = {};
    for (const p of properties) {
      const cid = p.client_id || "";
      if (!cid) continue;
      if (!propsByClient[cid]) propsByClient[cid] = [];
      propsByClient[cid].push(p);
    }

    let results = clients.map((c) => {
      const prop = pickPrimaryProperty(properties, c.id);
      const bestLead = pickBestLeadForClient(leads, c);

      return {
        id: c.id || "",
        name: c.name || "",
        phone: c.phone || "",
        email: c.email || "",
        status_code: c.status_code || "",
        last_activity_at: c.last_activity_at || "",
        job_description: c.job_description || "",

        // NEW FIELDS (for your “thin card” row):
        scheduled_date: bestLead ? (bestLead.scheduled_date || "") : "",
        estimated_value: bestLead ? (bestLead.estimated_value || "") : "",
        lead_id: bestLead ? (bestLead.id || "") : "",
        job_number: bestLead ? pickJobNumberFromLeadId(bestLead.id) : "",

        most_recent_property: prop
          ? {
              id: prop.id || "",
              address_line1: prop.address_line1 || "",
              city: prop.city || "",
              state: prop.state || "",
              zip: prop.zip || "",
            }
          : null,

        _allProps: propsByClient[c.id] || [],
      };
    });

    if (status && status !== "all") {
      results = results.filter((c) => normalizeStr(c.status_code) === status);
    }

    if (q) {
      results = results.filter((c) => {
        const fields = [
          c.name,
          c.phone,
          c.email,
          c.job_description,
          c.scheduled_date,
          c.estimated_value,
          c.job_number,
        ];

        for (const p of c._allProps) {
          fields.push(p.address_line1, p.city, p.state, p.zip);
        }
        return fields.some((f) => normalizeStr(f).includes(q));
      });
    }

    results.sort((a, b) => bestDate(b) - bestDate(a));
    results = results.slice(0, limit);
    const output = results.map(({ _allProps, ...rest }) => rest);

    json(res, 200, { ok: true, clients: output });
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

    const prop = pickPrimaryProperty(properties, clientId);

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