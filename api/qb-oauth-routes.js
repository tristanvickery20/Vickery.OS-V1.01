// api/qb-oauth-routes.js
// GET /api/accounting/qb/connect   — build Intuit OAuth URL and redirect the browser there
// GET /api/accounting/qb/callback  — receive code from Intuit, exchange for tokens, store, redirect to settings

const crypto = require("crypto");
const { getConfig, setConfigKeys } = require("../lib/config");
const {
  buildAuthUrl,
  exchangeCode,
  encryptSecret,
  decryptSecret,
  expiresAt,
  callbackUrl,
} = require("../lib/accounting/qb-oauth");

// ─── GET /api/accounting/qb/connect ──────────────────────────────────────────
// Redirects the browser to the Intuit OAuth consent screen.
// Requires client_id + client_secret + realm_id to be saved in settings first.

async function handleQbConnect(req, res) {
  try {
    const cfg = await getConfig();
    const clientId     = cfg.qb_client_id || "";
    const clientSecret = decryptSecret(cfg.qb_client_secret || "");
    const realmId      = cfg.qb_realm_id  || "";

    if (!clientId || !clientSecret || !realmId) {
      res.writeHead(302, {
        Location: "/crm/settings?tab=billing&error=qb_creds_missing",
      });
      return res.end();
    }

    // Generate and store a state nonce to defend against CSRF
    const state = crypto.randomBytes(20).toString("hex");
    await setConfigKeys({ qb_oauth_state: state });

    const authUrl = buildAuthUrl(clientId, state);
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (err) {
    console.error("[QB OAuth] /connect error:", err.message);
    res.writeHead(302, {
      Location: `/crm/settings?tab=billing&error=${encodeURIComponent("connect_error: " + err.message)}`,
    });
    res.end();
  }
}

// ─── GET /api/accounting/qb/callback ─────────────────────────────────────────
// Intuit redirects here after the user authorizes.
// Query params: code, state, realmId (Intuit sends this too)

async function handleQbCallback(req, res) {
  try {
    const url    = new URL(req.url, `https://${req.headers.host}`);
    const code   = url.searchParams.get("code")    || "";
    const state  = url.searchParams.get("state")   || "";
    const realmId = url.searchParams.get("realmId") || "";
    const error  = url.searchParams.get("error")   || "";

    // User denied access
    if (error) {
      console.warn("[QB OAuth] User denied access:", error);
      res.writeHead(302, {
        Location: `/crm/settings?tab=billing&qb_error=${encodeURIComponent(error)}`,
      });
      return res.end();
    }

    if (!code) {
      res.writeHead(302, {
        Location: "/crm/settings?tab=billing&qb_error=no_code",
      });
      return res.end();
    }

    // Verify state to prevent CSRF
    const cfg = await getConfig();
    if (state !== cfg.qb_oauth_state) {
      console.warn("[QB OAuth] State mismatch — possible CSRF attempt.");
      res.writeHead(302, {
        Location: "/crm/settings?tab=billing&qb_error=state_mismatch",
      });
      return res.end();
    }

    const clientId     = cfg.qb_client_id || "";
    const clientSecret = decryptSecret(cfg.qb_client_secret || "");

    if (!clientId || !clientSecret) {
      res.writeHead(302, {
        Location: "/crm/settings?tab=billing&qb_error=missing_creds",
      });
      return res.end();
    }

    // Exchange authorization code for tokens
    const tokens = await exchangeCode(clientId, clientSecret, code);

    // Store everything encrypted
    await setConfigKeys({
      qb_access_token:         encryptSecret(tokens.access_token),
      qb_refresh_token:        encryptSecret(tokens.refresh_token),
      qb_token_expires_at:     expiresAt(tokens.expires_in),
      qb_refresh_expires_at:   expiresAt(tokens.x_refresh_token_expires_in),
      qb_realm_id:             realmId || cfg.qb_realm_id, // Intuit sends this in the callback
      qb_connected:            "true",
      qb_connected_at:         new Date().toISOString(),
      qb_credentials_saved:    "true",
      qb_oauth_state:          "", // Clear the nonce
    });

    console.log(`[QB OAuth] Connected successfully. Realm: ${realmId}`);

    // Bust the provider cache so the next API call instantly uses QB
    try { require("../lib/accounting").invalidateCache(); } catch {}

    // Redirect back to settings with success flag
    res.writeHead(302, {
      Location: "/crm/settings?tab=billing&qb_connected=1",
    });
    res.end();
  } catch (err) {
    console.error("[QB OAuth] /callback error:", err.message);
    res.writeHead(302, {
      Location: `/crm/settings?tab=billing&qb_error=${encodeURIComponent(err.message)}`,
    });
    res.end();
  }
}

module.exports = { handleQbConnect, handleQbCallback };
