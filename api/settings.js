// api/settings.js — Notifications and Staff & Access settings
// QuickBooks has been removed from this stack. CRM is the source of truth.
const { getConfig, setConfigKeys } = require("../lib/config");

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

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

// GET /api/settings/notifications
async function handleGetNotifications(req, res) {
  try {
    const cfg = await getConfig();
    json(res, 200, {
      ok: true,
      smsEnabled:           cfg.sms_enabled           === "true",
      smsProvider:          cfg.sms_provider           || "twilio",
      newLeadAlert:         cfg.notify_new_lead        !== "false",
      scheduledAlert:       cfg.notify_scheduled       !== "false",
      depositAlert:         cfg.notify_deposit         !== "false",
      reviewAlert:          cfg.notify_review          !== "false",
      reviewReminderDays:   Number(cfg.review_reminder_days || "3"),
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/settings/notifications
async function handleSaveNotifications(req, res) {
  try {
    const body = await readBody(req);
    const pairs = {};
    if (body.smsEnabled           !== undefined) pairs.sms_enabled           = String(!!body.smsEnabled);
    if (body.smsProvider          !== undefined) pairs.sms_provider           = String(body.smsProvider || "twilio");
    if (body.newLeadAlert         !== undefined) pairs.notify_new_lead        = String(!!body.newLeadAlert);
    if (body.scheduledAlert       !== undefined) pairs.notify_scheduled       = String(!!body.scheduledAlert);
    if (body.depositAlert         !== undefined) pairs.notify_deposit         = String(!!body.depositAlert);
    if (body.reviewAlert          !== undefined) pairs.notify_review          = String(!!body.reviewAlert);
    if (body.reviewReminderDays   !== undefined) pairs.review_reminder_days   = String(Number(body.reviewReminderDays) || 3);
    await setConfigKeys(pairs);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// STAFF & ACCESS
// ─────────────────────────────────────────────────────────────

// GET /api/settings/staff
async function handleGetStaffSettings(req, res) {
  try {
    const cfg = await getConfig();
    let defaultPermissions = ["jobs", "time", "expenses"];
    try {
      const raw = cfg.default_permissions || "";
      if (raw) defaultPermissions = JSON.parse(raw);
    } catch { /* use built-in defaults */ }

    const requireApproval = cfg.staff_require_approval !== "false";
    json(res, 200, { ok: true, defaultPermissions, requireApproval });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/settings/staff
async function handleSaveStaffSettings(req, res) {
  try {
    const body = await readBody(req);
    const pairs = {};
    if (Array.isArray(body.defaultPermissions)) {
      pairs.default_permissions = JSON.stringify(body.defaultPermissions);
    }
    if (body.requireApproval !== undefined) {
      pairs.staff_require_approval = String(!!body.requireApproval);
    }
    await setConfigKeys(pairs);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// PUSH STUBS — QB removed; these are kept as no-ops so expenses.js
// and time.js don't need changes.
// ─────────────────────────────────────────────────────────────

async function pushExpenseToQuickBooks() {
  // QuickBooks removed — CRM tracks all expenses internally.
}

async function pushTimeToQuickBooks() {
  // QuickBooks removed — CRM tracks all time entries internally.
}

module.exports = {
  handleGetNotifications,
  handleSaveNotifications,
  handleGetStaffSettings,
  handleSaveStaffSettings,
  pushExpenseToQuickBooks,
  pushTimeToQuickBooks,
};
