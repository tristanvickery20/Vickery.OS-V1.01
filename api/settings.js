// api/settings.js — Notifications, QuickBooks, and Staff & Access settings
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
      smsReminderEnabled:    cfg.notif_sms_reminder_enabled    !== "false",
      reviewRequestEnabled:  cfg.notif_review_request_enabled  !== "false",
      reviewDelayDays:       Number(cfg.notif_review_delay_days || 3),
      ccOwnerEnabled:        cfg.notif_cc_owner_enabled        === "true",
      overdueHoursBefore:    Number(cfg.notif_overdue_hours_before || 0),
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
    if (body.smsReminderEnabled   !== undefined) pairs.notif_sms_reminder_enabled   = String(!!body.smsReminderEnabled);
    if (body.reviewRequestEnabled !== undefined) pairs.notif_review_request_enabled = String(!!body.reviewRequestEnabled);
    if (body.reviewDelayDays      !== undefined) pairs.notif_review_delay_days      = String(Number(body.reviewDelayDays) || 3);
    if (body.ccOwnerEnabled       !== undefined) pairs.notif_cc_owner_enabled       = String(!!body.ccOwnerEnabled);
    if (body.overdueHoursBefore   !== undefined) pairs.notif_overdue_hours_before   = String(Number(body.overdueHoursBefore) || 0);
    await setConfigKeys(pairs);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// QUICKBOOKS
// ─────────────────────────────────────────────────────────────

// GET /api/settings/quickbooks
async function handleGetQuickBooks(req, res) {
  try {
    const cfg = await getConfig();
    const connected = cfg.qb_connected === "true";
    json(res, 200, {
      ok: true,
      connected,
      // Never expose secrets — only show presence
      hasClientId:       !!cfg.qb_client_id,
      hasClientSecret:   !!cfg.qb_client_secret,
      realmId:           cfg.qb_realm_id || "",
      autoSyncExpenses:  cfg.qb_auto_sync_expenses === "true",
      autoSyncTime:      cfg.qb_auto_sync_time     === "true",
      environment:       cfg.qb_environment        || "sandbox",
      connectedAt:       cfg.qb_connected_at       || "",
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/settings/quickbooks — save credentials + toggles
async function handleSaveQuickBooks(req, res) {
  try {
    const body = await readBody(req);
    const pairs = {};

    if (body.clientId     !== undefined && body.clientId     !== "") pairs.qb_client_id     = String(body.clientId);
    if (body.clientSecret !== undefined && body.clientSecret !== "") pairs.qb_client_secret = String(body.clientSecret);
    if (body.realmId      !== undefined) pairs.qb_realm_id      = String(body.realmId || "");
    if (body.environment  !== undefined) pairs.qb_environment   = body.environment === "production" ? "production" : "sandbox";
    if (body.autoSyncExpenses !== undefined) pairs.qb_auto_sync_expenses = String(!!body.autoSyncExpenses);
    if (body.autoSyncTime     !== undefined) pairs.qb_auto_sync_time     = String(!!body.autoSyncTime);

    // If credentials were provided and complete, mark as connected
    if (body.clientId && body.clientSecret && body.realmId) {
      pairs.qb_connected    = "true";
      pairs.qb_connected_at = new Date().toISOString();
    }

    await setConfigKeys(pairs);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// DELETE /api/settings/quickbooks — disconnect (clear credentials)
async function handleDisconnectQuickBooks(req, res) {
  try {
    await setConfigKeys({
      qb_connected:    "false",
      qb_client_id:    "",
      qb_client_secret: "",
      qb_realm_id:     "",
      qb_connected_at: "",
    });
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
      const raw = cfg.staff_default_permissions || "";
      if (raw) defaultPermissions = JSON.parse(raw);
    } catch { /* use defaults */ }

    json(res, 200, {
      ok: true,
      defaultPermissions,
      requireApproval: cfg.staff_require_approval === "true",
    });
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
      pairs.staff_default_permissions = JSON.stringify(body.defaultPermissions);
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
// QB PUSH UTILITY — called by expenses.js and time.js after save
// ─────────────────────────────────────────────────────────────

// Push an expense record to QuickBooks.
// When QB credentials are fully set up, this will call the QB API.
// Until then it logs the attempt so the hook is in place.
async function pushExpenseToQuickBooks(entry) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_auto_sync_expenses !== "true") return;
    if (cfg.qb_connected !== "true" || !cfg.qb_client_id || !cfg.qb_realm_id) {
      console.log(`[QB] Expense sync skipped — not connected (${entry.id} $${entry.amount} ${entry.vendor})`);
      return;
    }
    // TODO: replace with real QB API call when OAuth is configured
    console.log(`[QB] Push expense → QB (stub): id=${entry.id} amount=$${entry.amount} vendor=${entry.vendor} date=${entry.date}`);
  } catch (err) {
    console.error("[QB] pushExpenseToQuickBooks error:", err.message);
  }
}

// Push a time entry record to QuickBooks.
async function pushTimeToQuickBooks(entry) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_auto_sync_time !== "true") return;
    if (cfg.qb_connected !== "true" || !cfg.qb_client_id || !cfg.qb_realm_id) {
      console.log(`[QB] Time sync skipped — not connected (${entry.id} ${entry.minutes}min tech=${entry.tech_id})`);
      return;
    }
    // TODO: replace with real QB API call when OAuth is configured
    console.log(`[QB] Push time entry → QB (stub): id=${entry.id} minutes=${entry.minutes} tech=${entry.tech_id} date=${entry.date}`);
  } catch (err) {
    console.error("[QB] pushTimeToQuickBooks error:", err.message);
  }
}

module.exports = {
  handleGetNotifications,
  handleSaveNotifications,
  handleGetQuickBooks,
  handleSaveQuickBooks,
  handleDisconnectQuickBooks,
  handleGetStaffSettings,
  handleSaveStaffSettings,
  pushExpenseToQuickBooks,
  pushTimeToQuickBooks,
};
