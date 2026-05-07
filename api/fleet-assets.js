// api/fleet-assets.js — Basic CRUD for Sheets-backed fleet/tools/inventory records
const {
  RESOURCES,
  ensureFleetAssetSheets,
  listRecords,
  appendRecord,
  updateRecord,
  listAllFleetAssetData,
} = require("../lib/fleet-assets");

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function parsePath(req) {
  const path = req.url.split("?")[0];
  const rest = path.replace(/^\/api\/fleet-assets\/?/, "");
  const parts = rest.split("/").filter(Boolean);
  return { resource: parts[0] || "summary", id: parts[1] || "" };
}

async function handleFleetAssetsApi(req, res) {
  try {
    const { resource, id } = parsePath(req);

    if (resource === "summary" && req.method === "GET") {
      await ensureFleetAssetSheets();
      const data = await listAllFleetAssetData();
      return json(res, 200, { ok: true, ...data });
    }

    if (!RESOURCES[resource]) {
      return json(res, 404, { ok: false, error: "Unknown fleet asset resource" });
    }

    if (req.method === "GET" && !id) {
      const records = await listRecords(resource);
      return json(res, 200, { ok: true, resource, records });
    }

    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const record = await appendRecord(resource, body);
      return json(res, 201, { ok: true, resource, record });
    }

    if ((req.method === "PATCH" || req.method === "POST") && id) {
      const body = await readBody(req);
      const record = await updateRecord(resource, id, body);
      if (!record) return json(res, 404, { ok: false, error: "Record not found" });
      return json(res, 200, { ok: true, resource, record });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleFleetAssetsApi };
