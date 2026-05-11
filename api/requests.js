// api/requests.js — Requests tab removed (architecture cleanup 2026-05-11).
// Leads are now self-contained. All request-related endpoints return 410 Gone.

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const GONE = { ok: false, error: "Requests tab removed. Use Leads API instead." };

async function handleGetRequests(req, res)      { json(res, 410, GONE); }
async function handleCreateRequest(req, res)    { json(res, 410, GONE); }
async function handleUpdateRequest(req, res)    { json(res, 410, GONE); }
async function handleGetRequestById(req, res)   { json(res, 410, GONE); }
async function handleDeleteRequest(req, res)    { json(res, 410, GONE); }

module.exports = {
  handleGetRequests,
  handleCreateRequest,
  handleUpdateRequest,
  handleGetRequestById,
  handleDeleteRequest,
};
