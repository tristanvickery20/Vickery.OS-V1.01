// api/traccar.js
// Traccar GPS fleet tracking integration
//
// Environment variables:
//   TRACCAR_URL   — base URL of the Traccar server (e.g. https://demo.traccar.org)
//   TRACCAR_TOKEN — Traccar user API token (User Profile → API Access)
//   TRACCAR_MODE  — "traccar_app" (phone) | "traccar_obd" (hardware tracker)
//                   Both modes use the same REST API — this is informational only.
//
// Behaviour:
//   - Polls /api/positions + /api/devices every 60s and caches results in memory.
//   - Exposes GET /api/traccar/positions to the schedule map frontend.
//   - On each poll, compares truck coordinates to today's scheduled bookings;
//     writes an arrived_at timestamp + GPS coords when a truck arrives within
//     300ft (~91m) of a job site that has not yet been marked as arrived.
//   - If TRACCAR_URL / TRACCAR_TOKEN are absent, all operations are silent no-ops.
//   - If the Traccar server is unreachable, _cache.online is set to false and the
//     frontend shows a "GPS offline" badge — nothing else breaks.

const https  = require("https");
const http   = require("http");
const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

const ARRIVAL_RADIUS_M  = 91.44;   // 300 feet in metres
const POLL_INTERVAL_MS  = 60_000;  // 60 seconds
const FETCH_TIMEOUT_MS  = 10_000;  // abort Traccar requests after 10s

let _cache = { positions: [], lastPoll: null, online: false };
let _pollTimer = null;

// Guard: "bookingId|deviceId" pairs already logged as arrived today.
// Cleared at midnight to allow next-day arrivals.
let _arrivedGuard     = new Set();
let _arrivedGuardDate = "";        // YYYY-MM-DD (local) when guard was last cleared

// ── Helpers ────────────────────────────────────────────────────────────────

function traccarEnabled() {
  return !!(process.env.TRACCAR_URL && process.env.TRACCAR_TOKEN);
}

function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

function maybeResetGuard() {
  const today = todayLocal();
  if (_arrivedGuardDate !== today) {
    _arrivedGuard     = new Set();
    _arrivedGuardDate = today;
  }
}

// Haversine distance in metres between two WGS-84 points.
function distMeters(lat1, lng1, lat2, lng2) {
  const R      = 6_371_000;
  const toRad  = d => d * Math.PI / 180;
  const dLat   = toRad(lat2 - lat1);
  const dLng   = toRad(lng2 - lng1);
  const a      = Math.sin(dLat / 2) ** 2
                 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Minimal HTTP/HTTPS GET that returns parsed JSON.
function traccarFetch(path) {
  return new Promise((resolve, reject) => {
    const base   = (process.env.TRACCAR_URL || "").replace(/\/$/, "");
    const token  = process.env.TRACCAR_TOKEN || "";
    const full   = `${base}${path}`;
    let parsed;
    try { parsed = new URL(full); } catch { return reject(new Error(`Invalid TRACCAR_URL: ${base}`)); }

    const lib  = parsed.protocol === "https:" ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ""),
      method:   "GET",
      headers:  { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
      timeout:  FETCH_TIMEOUT_MS,
    };

    const req = lib.request(opts, res2 => {
      let data = "";
      res2.on("data", c => (data += c));
      res2.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Traccar returned non-JSON")); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Traccar request timed out")); });
    req.on("error",   reject);
    req.end();
  });
}

// ── Arrival detection ───────────────────────────────────────────────────────

async function runArrivalCheck(rawPositions, deviceMap) {
  if (!rawPositions.length) return;
  const SPREADSHEET_ID = process.env.CRM_SHEET_ID;
  if (!SPREADSHEET_ID) return;

  maybeResetGuard();

  const sheets = await getSheetsClient();
  await ensureTabHeaders("Bookings");

  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         "Bookings!A:Z",
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return;

  const headers = rows[0];
  const idx     = f => headers.indexOf(f);

  const bookingIdIdx  = idx("booking_id");
  const schedDtIdx    = idx("scheduled_datetime");
  const latIdx        = idx("lat");
  const lngIdx        = idx("lng");
  const arrivedAtIdx  = idx("arrived_at");
  const arrivedLatIdx = idx("arrived_lat");
  const arrivedLngIdx = idx("arrived_lng");

  if (bookingIdIdx < 0 || latIdx < 0 || lngIdx < 0) return;

  const todayStr = todayLocal();

  // Normalise position objects to { deviceId, lat, lon }
  const positions = rawPositions.map(p => ({
    deviceId: p.deviceId,
    lat:      p.latitude  ?? p.lat,
    lon:      p.longitude ?? p.lon,
  })).filter(p => p.lat != null && p.lon != null);

  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    const row       = rows[i];
    const bookingId = String(row[bookingIdIdx] || "").trim();
    if (!bookingId) continue;

    // Must be scheduled today
    const sdt = String(row[schedDtIdx] || "").trim();
    if (!sdt) continue;
    let localDate = "";
    try { localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(sdt)); } catch { continue; }
    if (localDate !== todayStr) continue;

    // Must have geocoded coordinates
    const bLat = parseFloat(row[latIdx]);
    const bLng = parseFloat(row[lngIdx]);
    if (isNaN(bLat) || isNaN(bLng)) continue;

    // Must not already have arrived_at
    if (arrivedAtIdx >= 0 && String(row[arrivedAtIdx] || "").trim()) continue;

    // Check each truck
    for (const pos of positions) {
      const guardKey = `${bookingId}|${pos.deviceId}`;
      if (_arrivedGuard.has(guardKey)) continue;

      if (distMeters(bLat, bLng, pos.lat, pos.lon) <= ARRIVAL_RADIUS_M) {
        _arrivedGuard.add(guardKey);

        const now    = new Date().toISOString();
        const updRow = [...row];
        while (updRow.length < headers.length) updRow.push("");
        if (arrivedAtIdx  >= 0) updRow[arrivedAtIdx]  = now;
        if (arrivedLatIdx >= 0) updRow[arrivedLatIdx] = String(pos.lat);
        if (arrivedLngIdx >= 0) updRow[arrivedLngIdx] = String(pos.lon);

        updates.push({
          rowNum:   i + 1,
          row:      updRow.slice(0, headers.length),
          bookingId,
          techName: deviceMap[pos.deviceId] || `Device ${pos.deviceId}`,
        });
        break; // first truck to arrive wins for this booking
      }
    }
  }

  if (!updates.length) return;

  const endCol = String.fromCharCode(65 + headers.length - 1);
  for (const upd of updates) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `Bookings!A${upd.rowNum}:${endCol}${upd.rowNum}`,
        valueInputOption: "RAW",
        requestBody:      { majorDimension: "ROWS", values: [upd.row] },
      });
      console.log(`[traccar] Auto-arrival: booking ${upd.bookingId} — ${upd.techName}`);
    } catch (err) {
      console.error(`[traccar] Failed to write arrival for ${upd.bookingId}:`, err.message);
    }
  }
}

// ── Poll loop ───────────────────────────────────────────────────────────────

async function poll() {
  if (!traccarEnabled()) return;
  try {
    const [rawPositions, rawDevices] = await Promise.all([
      traccarFetch("/api/positions"),
      traccarFetch("/api/devices"),
    ]);

    // Build deviceId → name map
    const deviceMap = {};
    if (Array.isArray(rawDevices)) {
      for (const d of rawDevices) {
        deviceMap[d.id] = d.name || `Device ${d.id}`;
      }
    }

    const positions = Array.isArray(rawPositions) ? rawPositions.map(p => ({
      deviceId:   p.deviceId,
      deviceName: deviceMap[p.deviceId] || `Device ${p.deviceId}`,
      lat:        p.latitude,
      lng:        p.longitude,
      speed:      Math.round((p.speed || 0) * 1.15078), // knots → mph
      fixTime:    p.fixTime || p.deviceTime || null,
    })) : [];

    _cache = { positions, lastPoll: new Date().toISOString(), online: true };

    // Run arrival detection asynchronously — errors must not crash poll()
    runArrivalCheck(rawPositions, deviceMap).catch(err => {
      console.error("[traccar] Arrival check error:", err.message);
    });

  } catch (err) {
    console.error("[traccar] Poll error:", err.message);
    _cache = { ..._cache, online: false, lastPoll: new Date().toISOString() };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

function startPolling() {
  if (!traccarEnabled()) {
    console.log("[traccar] TRACCAR_URL/TRACCAR_TOKEN not set — fleet tracking disabled");
    return;
  }
  const mode = process.env.TRACCAR_MODE || "traccar_app";
  console.log(`[traccar] Fleet tracking enabled (mode: ${mode}) — polling every ${POLL_INTERVAL_MS / 1000}s`);
  poll();
  _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function handleGetPositions(req, res) {
  if (!traccarEnabled()) {
    return json(res, 200, { ok: true, online: false, positions: [], mode: null, lastPoll: null });
  }
  return json(res, 200, {
    ok:        true,
    online:    _cache.online,
    positions: _cache.positions,
    mode:      process.env.TRACCAR_MODE || "traccar_app",
    lastPoll:  _cache.lastPoll,
  });
}

module.exports = { handleGetPositions, startPolling, stopPolling };
