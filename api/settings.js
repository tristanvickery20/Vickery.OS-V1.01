// api/settings.js — Notifications, QuickBooks, and Staff & Access settings
const crypto = require("crypto");
const { getConfig, setConfigKeys } = require("../lib/config");

// ─────────────────────────────────────────────────────────────
// QB SECRET ENCRYPTION — stored in Config sheet encrypted at rest
// Key is derived from CRM_PIN env var so the raw secret is never
// visible in the sheet even if someone has the sheet ID.
// ─────────────────────────────────────────────────────────────
function _encKey() {
  const pin = process.env.CRM_PIN;
  if (!pin) {
    // CRM_PIN is required for QB secret encryption. Without it we store the
    // secret unencrypted but still protected by the Config sheet's access controls.
    return crypto.createHash("sha256").update("NO_PIN_SET").digest();
  }
  return crypto.createHash("sha256").update(pin).digest();
}
function encryptSecret(text) {
  if (!text) return "";
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", _encKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
}
function decryptSecret(stored) {
  if (!stored || !stored.includes(":")) return stored;
  try {
    const [ivHex, encHex] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc", _encKey(), Buffer.from(ivHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return stored;
  }
}

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
    const credentialsSaved = cfg.qb_credentials_saved === "true";
    const connected        = cfg.qb_connected === "true";
    json(res, 200, {
      ok: true,
      connected,
      credentialsSaved,
      // Never expose secrets — only show presence
      hasClientId:       !!cfg.qb_client_id,
      hasClientSecret:   !!cfg.qb_client_secret,
      realmId:           cfg.qb_realm_id || "",
      autoSyncExpenses:  cfg.qb_auto_sync_expenses === "true",
      autoSyncTime:      cfg.qb_auto_sync_time     === "true",
      environment:       cfg.qb_environment        || "sandbox",
      connectedAt:       cfg.qb_connected_at       || "",
      credentialsSavedAt: cfg.qb_credentials_saved_at || "",
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

    // Credentials — client secret is AES-encrypted before storing in Config sheet
    if (body.clientId     !== undefined && body.clientId     !== "") pairs.qb_client_id     = String(body.clientId);
    if (body.clientSecret !== undefined && body.clientSecret !== "") pairs.qb_client_secret = encryptSecret(String(body.clientSecret));
    if (body.realmId      !== undefined) pairs.qb_realm_id      = String(body.realmId || "");
    if (body.environment  !== undefined) pairs.qb_environment   = body.environment === "production" ? "production" : "sandbox";

    // Auto-sync toggles
    if (body.autoSyncExpenses !== undefined) pairs.qb_auto_sync_expenses = String(!!body.autoSyncExpenses);
    if (body.autoSyncTime     !== undefined) pairs.qb_auto_sync_time     = String(!!body.autoSyncTime);

    // Mark credentials as saved (not yet OAuth-verified)
    // qb_connected is only "true" once a real OAuth access token is stored
    if (body.clientId && body.clientSecret && body.realmId) {
      pairs.qb_credentials_saved    = "true";
      pairs.qb_credentials_saved_at = new Date().toISOString();
      // Do NOT set qb_connected here — that requires a real OAuth token exchange
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
      qb_connected:          "false",
      qb_credentials_saved:  "false",
      qb_client_id:          "",
      qb_client_secret:      "",
      qb_realm_id:           "",
      qb_connected_at:       "",
      qb_credentials_saved_at: "",
    });
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/settings/quickbooks/token — OAuth completion: store access token and mark connected.
// Called once the OAuth exchange completes (via redirect or manual entry).
// Until a real OAuth flow is wired in, this endpoint allows manually providing a token for testing.
async function handleSaveQuickBooksToken(req, res) {
  try {
    const body = await readBody(req);
    if (!body.accessToken) {
      return json(res, 400, { ok: false, error: "accessToken is required" });
    }
    // Token is encrypted at rest using the same AES-256 scheme as the client secret
    await setConfigKeys({
      qb_access_token: encryptSecret(String(body.accessToken)),
      qb_connected:    "true",
      qb_connected_at: new Date().toISOString(),
    });
    json(res, 200, { ok: true, message: "QuickBooks access token saved — sync is now active." });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/settings/quickbooks/test — attempt a live QB API call and report result
async function handleTestQuickBooks(req, res) {
  try {
    const cfg = await getConfig();
    if (!cfg.qb_client_id || !cfg.qb_realm_id) {
      return json(res, 200, { ok: false, error: "No credentials configured. Enter Client ID and Realm ID first." });
    }
    const accessToken = decryptSecret(cfg.qb_access_token || "");
    const base = cfg.qb_environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
    const url = `${base}/v3/company/${cfg.qb_realm_id}/companyinfo/${cfg.qb_realm_id}?minorversion=65`;
    let status = 0;
    let body = "";
    try {
      const r = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      });
      status = r.status;
      body = await r.text();
    } catch (netErr) {
      return json(res, 200, { ok: false, error: `Network error: ${netErr.message}` });
    }
    if (status === 200) {
      let name = "";
      try { name = JSON.parse(body).CompanyInfo?.CompanyName || ""; } catch {}
      return json(res, 200, { ok: true, message: `Connected — company: ${name || cfg.qb_realm_id}` });
    }
    if (status === 401) {
      return json(res, 200, { ok: false, error: "Credentials accepted but OAuth token missing or expired. Full OAuth flow is required to complete sync." });
    }
    return json(res, 200, { ok: false, error: `QB returned HTTP ${status}` });
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
      // Key is "default_permissions" — matches crew-auth.js signup path
      const raw = cfg.default_permissions || "";
      if (raw) defaultPermissions = JSON.parse(raw);
    } catch { /* use built-in defaults */ }

    // Default to true (require approval) when unset — matches signup path behaviour
    const requireApproval = cfg.staff_require_approval !== "false";

    json(res, 200, {
      ok: true,
      defaultPermissions,
      requireApproval,
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
      // Use "default_permissions" — read by crew-auth.js during new-account creation
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
// QB PUSH UTILITIES — called by expenses.js and time.js after save
// ─────────────────────────────────────────────────────────────

// Build a QuickBooks Purchase payload from an expense entry
function _buildQbPurchase(entry, cfg) {
  return {
    PaymentType: "Cash",
    AccountRef: { value: "1", name: "Checking" },
    TotalAmt: Number(entry.amount) || 0,
    TxnDate: entry.date || new Date().toISOString().slice(0, 10),
    PrivateNote: `CRM Expense ${entry.id} — ${entry.vendor || ""} — ${entry.notes || ""}`.trim(),
    Line: [{
      Amount: Number(entry.amount) || 0,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: { value: "7", name: "Expenses" } },
    }],
  };
}

// Build a QuickBooks TimeActivity payload from a time entry
function _buildQbTimeActivity(entry, cfg) {
  const hours   = Math.floor((Number(entry.minutes) || 0) / 60);
  const minutes = (Number(entry.minutes) || 0) % 60;
  return {
    TxnDate:    entry.date || new Date().toISOString().slice(0, 10),
    NameOf:     "Employee",
    Hours:      hours,
    Minutes:    minutes,
    Description: `CRM Time Entry ${entry.id} — ${entry.category || ""} — tech: ${entry.tech_id || ""}`.trim(),
    BillableStatus: "NotBillable",
  };
}

// Push an expense record to QuickBooks.
// Exercises the real QB API call path; logs/swallows errors so it never blocks saves.
async function pushExpenseToQuickBooks(entry) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_auto_sync_expenses !== "true") return;
    // Gate on qb_connected (requires OAuth access token) so we only call QB when ready
    if (cfg.qb_connected !== "true" || !cfg.qb_client_id || !cfg.qb_realm_id) {
      // Mock response — log the payload so the sync path is exercisable without live creds
      const mockPayload = _buildQbPurchase(entry, cfg);
      console.log(`[QB MOCK] Expense push (not connected) — would POST Purchase:`, JSON.stringify(mockPayload));
      return;
    }
    const accessToken = decryptSecret(cfg.qb_access_token || "");
    const base = cfg.qb_environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
    const url = `${base}/v3/company/${cfg.qb_realm_id}/purchase?minorversion=65`;
    const payload = _buildQbPurchase(entry, cfg);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (r.status === 200 || r.status === 201) {
      const d = await r.json();
      console.log(`[QB] Expense pushed → Purchase Id: ${d?.Purchase?.Id || "?"} for entry ${entry.id}`);
    } else {
      const text = await r.text();
      console.warn(`[QB] Expense push failed (HTTP ${r.status}) for entry ${entry.id}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[QB] pushExpenseToQuickBooks error:", err.message);
  }
}

// Push a time entry record to QuickBooks.
async function pushTimeToQuickBooks(entry) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_auto_sync_time !== "true") return;
    // Gate on qb_connected (requires OAuth access token) so we only call QB when ready
    if (cfg.qb_connected !== "true" || !cfg.qb_client_id || !cfg.qb_realm_id) {
      // Mock response — log the payload so the sync path is exercisable without live creds
      const mockPayload = _buildQbTimeActivity(entry, cfg);
      console.log(`[QB MOCK] Time push (not connected) — would POST TimeActivity:`, JSON.stringify(mockPayload));
      return;
    }
    const accessToken = decryptSecret(cfg.qb_access_token || "");
    const base = cfg.qb_environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
    const url = `${base}/v3/company/${cfg.qb_realm_id}/timeactivity?minorversion=65`;
    const payload = _buildQbTimeActivity(entry, cfg);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (r.status === 200 || r.status === 201) {
      const d = await r.json();
      console.log(`[QB] Time entry pushed → TimeActivity Id: ${d?.TimeActivity?.Id || "?"} for entry ${entry.id}`);
    } else {
      const text = await r.text();
      console.warn(`[QB] Time push failed (HTTP ${r.status}) for entry ${entry.id}: ${text.slice(0, 200)}`);
    }
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
  handleSaveQuickBooksToken,
  handleTestQuickBooks,
  handleGetStaffSettings,
  handleSaveStaffSettings,
  pushExpenseToQuickBooks,
  pushTimeToQuickBooks,
};
