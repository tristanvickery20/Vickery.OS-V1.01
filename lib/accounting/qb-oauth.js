// lib/accounting/qb-oauth.js
// QuickBooks OAuth 2.0 helpers: build auth URL, exchange code, refresh token.
// All secrets are AES-256 encrypted at rest via the same scheme as api/settings.js.
// CRM_PIN env var is REQUIRED — fail-closed.

const crypto = require("crypto");

// ─── Encryption helpers (mirrors api/settings.js) ────────────────────────────

function _encKey() {
  const pin = process.env.CRM_PIN;
  if (!pin) throw new Error("CRM_PIN env var is required for QB token encryption.");
  return crypto.createHash("sha256").update(pin).digest();
}

function encryptSecret(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", _encKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
}

function decryptSecret(stored) {
  if (!stored || !stored.includes(":")) return "";
  try {
    const key = crypto.createHash("sha256").update(process.env.CRM_PIN || "").digest();
    const [ivHex, encHex] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return "";
  }
}

// ─── OAuth constants ──────────────────────────────────────────────────────────

const AUTH_BASE  = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL  = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE      = "com.intuit.quickbooks.accounting";

// ─── Build the redirect URL back to this server ──────────────────────────────

function callbackUrl() {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) throw new Error("REPLIT_DEV_DOMAIN env var is missing — cannot build QB redirect URI.");
  return `https://${domain}/api/accounting/qb/callback`;
}

// ─── Build the Intuit authorization URL ──────────────────────────────────────
// state is a random token stored in the Config sheet and checked at callback time.

function buildAuthUrl(clientId, state) {
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    scope:         SCOPE,
    redirect_uri:  callbackUrl(),
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

// ─── Exchange authorization code for access + refresh tokens ─────────────────

async function exchangeCode(clientId, clientSecret, code) {
  const body = new URLSearchParams({
    grant_type:   "authorization_code",
    code,
    redirect_uri: callbackUrl(),
  });

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body: body.toString(),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`QB token exchange failed (HTTP ${r.status}): ${JSON.stringify(data)}`);
  }

  // access_token expires in ~3600s; refresh_token expires in ~8726400s (~100 days)
  return {
    access_token:         data.access_token,
    refresh_token:        data.refresh_token,
    expires_in:           data.expires_in || 3600,
    x_refresh_token_expires_in: data.x_refresh_token_expires_in || 8726400,
    token_type:           data.token_type || "bearer",
  };
}

// ─── Refresh an expired access token ─────────────────────────────────────────

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
  });

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body: body.toString(),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`QB token refresh failed (HTTP ${r.status}): ${JSON.stringify(data)}`);
  }

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token || refreshToken, // QB may or may not rotate it
    expires_in:    data.expires_in || 3600,
    x_refresh_token_expires_in: data.x_refresh_token_expires_in || 8726400,
  };
}

// ─── Revoke tokens (disconnect) ───────────────────────────────────────────────

async function revokeToken(clientId, clientSecret, token) {
  if (!token) return;
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn("[QB OAuth] revokeToken error (ignored):", err.message);
  }
}

// ─── Compute absolute expiry timestamp ───────────────────────────────────────

function expiresAt(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

module.exports = {
  encryptSecret,
  decryptSecret,
  callbackUrl,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  expiresAt,
};
