// api/config-mapbox.js
// GET /api/config/mapbox — returns Mapbox public token for authenticated CRM or crew users
"use strict";
const { isAuthed } = require("../lib/auth");
const { getCrewSession } = require("../lib/staff");

function handleMapboxConfig(req, res) {
  const authed = isAuthed(req) || !!getCrewSession(req);
  if (!authed) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Not authenticated" }));
  }
  const token = process.env.MAPBOX_TOKEN || "";
  if (!token) {
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ ok: false, error: "Mapbox not configured — add MAPBOX_TOKEN secret" }));
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, token }));
}

module.exports = { handleMapboxConfig };
