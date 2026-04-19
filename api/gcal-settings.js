// api/gcal-settings.js — Google Calendar sync settings and status endpoints
const {
  getGCalStatus,
  saveGCalSettings,
  bootstrapCalendars,
  runReverseSync,
} = require("../lib/googleCalendar");

async function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// GET /api/gcal/status — return current sync status + settings
async function handleGCalStatus(req, res) {
  try {
    const status = await getGCalStatus();
    json(res, 200, { ok: true, ...status });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/gcal/settings — save gcal settings { enabled, personalId, timezone }
async function handleGCalSaveSettings(req, res) {
  try {
    const body = await readBody(req);
    await saveGCalSettings({
      enabled:    body.enabled,
      personalId: body.personalId,
      timezone:   body.timezone,
    });
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/gcal/bootstrap — (re)create managed calendars
async function handleGCalBootstrap(req, res) {
  try {
    const result = await bootstrapCalendars();
    json(res, 200, { ok: true, result });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/gcal/sync — manual trigger of reverse sync
async function handleGCalSync(req, res) {
  try {
    json(res, 200, { ok: true, message: "Reverse sync started" });
    setImmediate(() => runReverseSync().catch((e) => console.error("[gcal/sync]", e.message)));
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGCalStatus,
  handleGCalSaveSettings,
  handleGCalBootstrap,
  handleGCalSync,
};
