const { postToAppsScript } = require("../lib/appsScriptClient");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON in request body"));
      }
    });
    req.on("error", reject);
  });
}

async function handleAppsLeadCreate(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    if (!process.env.APPS_SCRIPT_URL || !process.env.APPS_SCRIPT_SECRET) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Server misconfigured: Apps Script env vars not set" }));
    }

    const data = await readBody(req);

    const payload = {
      secret: process.env.APPS_SCRIPT_SECRET,
      action: "lead.create",
      name: data.name || "",
      phone: data.phone || "",
      address: data.address || "",
      job_type: data.job_type || "small_job",
      estimated_value: Number(data.estimated_value || 0),
      notes: data.notes || "",
    };

    const result = await postToAppsScript(payload);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleAppsLeadCreate };
