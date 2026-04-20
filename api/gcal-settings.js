// api/gcal-settings.js — Google Calendar sync settings and status endpoints
const {
  getGCalStatus,
  saveGCalSettings,
  bootstrapCalendars,
  runReverseSync,
  backfillToGCal,
  verifyPersonalCalendar,
  shareCalendarsWithUser,
  registerWatchChannels,
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

// POST /api/gcal/verify-personal — test service account freebusy access to personal calendar
async function handleGCalVerifyPersonal(req, res) {
  try {
    const body = await readBody(req);
    const calId = body.calendarId || "";
    const result = await verifyPersonalCalendar(calId);
    json(res, 200, { ok: true, ...result });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message });
  }
}

// POST /api/gcal/share-with — share Vickery Jobs + Vickery Internal with a user's Gmail
async function handleGCalShareWithUser(req, res) {
  try {
    const body  = await readBody(req);
    const email = (body.email || "").trim();
    if (!email) return json(res, 400, { ok: false, error: "email is required" });
    const results = await shareCalendarsWithUser(email);
    const allOk   = results.every(r => r.ok);
    const shared  = results.filter(r => r.ok).map(r => r.label).join(" and ");
    const message = allOk
      ? `"${shared}" shared with ${email}. They'll appear in Google Calendar within a minute.`
      : results.filter(r => !r.ok).map(r => `${r.label}: ${r.error}`).join("; ");
    json(res, allOk ? 200 : 207, { ok: allOk, results, message });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message });
  }
}

// POST /api/gcal/backfill — push all existing CRM items with no gcal_event_id to Google Calendar
async function handleGCalBackfill(req, res) {
  try {
    json(res, 200, { ok: true, message: "Backfill started — this may take a minute." });
    setImmediate(async () => {
      try {
        const result = await backfillToGCal();
        console.log(`[gcal/backfill] Complete — pushed=${result.pushed} skipped=${result.skipped} errors=${result.errors}`);
      } catch (e) { console.error("[gcal/backfill]", e.message); }
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/gcal/watch-channels — register push-notification watch channels for Jobs + Internal
// Body: { webhookAddress: "https://your-domain/api/gcal-webhook" }
async function handleGCalRegisterWatchChannels(req, res) {
  try {
    const body = await readBody(req);
    const address = (body.webhookAddress || "").trim();
    const results = await registerWatchChannels(address);
    const allOk = results.every(r => r.ok);
    json(res, allOk ? 200 : 207, { ok: allOk, results });
  } catch (err) {
    json(res, 400, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGCalStatus,
  handleGCalSaveSettings,
  handleGCalBootstrap,
  handleGCalSync,
  handleGCalBackfill,
  handleGCalVerifyPersonal,
  handleGCalShareWithUser,
  handleGCalRegisterWatchChannels,
};
