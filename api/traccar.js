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
//   - ARRIVAL: when a truck comes within 300ft of a today's job → stamps arrived_at,
//     arrived_lat, arrived_lng; sends "Your tech is here" SMS to customer.
//   - DEPARTURE: when NO truck is within 500ft of a job that has arrived_at but no
//     departed_at, and at least 5 minutes have passed → stamps departed_at and
//     calculates job_duration_minutes.
//   - If TRACCAR_URL / TRACCAR_TOKEN are absent, all operations are silent no-ops.
//   - If the Traccar server is unreachable, _cache.online is set to false and the
//     frontend shows a "GPS offline" badge — nothing else breaks.

const https  = require("https");
const http   = require("http");
const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");
const { sendSms, buildMessage, CREW_TEMPLATES } = require("../lib/sms");

const ARRIVAL_RADIUS_M   = 91.44;    // 300 feet in metres
const DEPARTURE_RADIUS_M = 152.4;    // 500 feet — slightly larger to avoid flapping
const MIN_ON_SITE_MS     = 5 * 60 * 1000;  // 5 minutes before we consider departure
const POLL_INTERVAL_MS   = 60_000;   // 60 seconds
const FETCH_TIMEOUT_MS   = 10_000;   // abort Traccar requests after 10s

let _cache = { positions: [], lastPoll: null, online: false };
let _pollTimer = null;

// Trips cache — refreshed on demand, max every 60s
let _tripsCache = { data: [], lastFetch: null };
const TRIPS_CACHE_TTL_MS = 60_000;

// Guard: "bookingId|deviceId" pairs already logged as arrived today.
// Cleared at midnight to allow next-day arrivals.
let _arrivedGuard     = new Set();
let _arrivedGuardDate = "";        // YYYY-MM-DD (local) when guard was last cleared

// Guard: bookingIds already marked as departed today.
let _departedGuard     = new Set();
let _departedGuardDate = "";

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
  if (_departedGuardDate !== today) {
    _departedGuard     = new Set();
    _departedGuardDate = today;
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
        if (res2.statusCode < 200 || res2.statusCode >= 300) {
          return reject(new Error(`Traccar HTTP ${res2.statusCode}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Traccar returned non-JSON")); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Traccar request timed out")); });
    req.on("error",   reject);
    req.end();
  });
}

// ── Sheet helpers ──────────────────────────────────────────────────────────

async function fetchBookingsRows(sheets) {
  const SPREADSHEET_ID = process.env.CRM_SHEET_ID;
  if (!SPREADSHEET_ID) return null;

  await ensureTabHeaders("Bookings");

  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         "Bookings!A:AZ",
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return null;

  return { rows, spreadsheetId: SPREADSHEET_ID };
}

function colLetter(i) {
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// ── Arrival detection ─────────────────────────────────────────────────────

async function runArrivalCheck(rawPositions, deviceMap) {
  if (!rawPositions.length) return;

  const sheets = await getSheetsClient();
  const fetched = await fetchBookingsRows(sheets);
  if (!fetched) return;

  const { rows, spreadsheetId } = fetched;
  const headers = rows[0];
  const idx     = f => headers.indexOf(f);

  const bookingIdIdx       = idx("booking_id");
  const schedDtIdx         = idx("scheduled_datetime");
  const latIdx             = idx("lat");
  const lngIdx             = idx("lng");
  const arrivedAtIdx       = idx("arrived_at");
  const arrivedLatIdx      = idx("arrived_lat");
  const arrivedLngIdx      = idx("arrived_lng");
  const phoneIdx           = idx("phone");
  const customerNameIdx    = idx("customer_name");
  const custSmsSentAtIdx   = idx("customer_sms_sent_at");

  if (bookingIdIdx < 0 || latIdx < 0 || lngIdx < 0) return;

  const todayStr = todayLocal();
  maybeResetGuard();

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

        const techName    = deviceMap[pos.deviceId] || "Your technician";
        const custPhone   = phoneIdx >= 0 ? String(row[phoneIdx] || "").trim() : "";
        const custName    = customerNameIdx >= 0 ? String(row[customerNameIdx] || "").trim() : "";
        const alreadySms  = custSmsSentAtIdx >= 0 ? String(row[custSmsSentAtIdx] || "").trim() : "";

        // Send "Your tech is here" SMS to customer if not already sent
        let smsSent = false;
        if (custPhone && !alreadySms) {
          const body = buildMessage(CREW_TEMPLATES.we_are_here, { tech_name: techName });
          smsSent = await sendSms(custPhone, body).catch(() => false);
          if (smsSent && custSmsSentAtIdx >= 0) updRow[custSmsSentAtIdx] = now;
          console.log(`[traccar] Arrival SMS to ${custPhone} (${custName || bookingId}): ${smsSent ? "sent" : "failed"}`);
        }

        updates.push({
          rowNum:   i + 1,
          row:      updRow.slice(0, headers.length),
          bookingId,
          techName,
        });
        break; // first truck to arrive wins for this booking
      }
    }
  }

  if (!updates.length) return;

  const endCol = colLetter(headers.length - 1);
  for (const upd of updates) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
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

// ── Departure detection ───────────────────────────────────────────────────
// For each booking that has arrived_at but no departed_at:
//   If NO device is within DEPARTURE_RADIUS_M and MIN_ON_SITE_MS has elapsed
//   since arrived_at → stamp departed_at + compute job_duration_minutes.

async function runDepartureCheck(positions) {
  if (!positions.length) return;

  const sheets = await getSheetsClient();
  const fetched = await fetchBookingsRows(sheets);
  if (!fetched) return;

  const { rows, spreadsheetId } = fetched;
  const headers = rows[0];
  const idx     = f => headers.indexOf(f);

  const bookingIdIdx        = idx("booking_id");
  const schedDtIdx          = idx("scheduled_datetime");
  const latIdx              = idx("lat");
  const lngIdx              = idx("lng");
  const arrivedAtIdx        = idx("arrived_at");
  const departedAtIdx       = idx("departed_at");
  const jobDurationIdx      = idx("job_duration_minutes");

  if (bookingIdIdx < 0 || arrivedAtIdx < 0 || latIdx < 0 || lngIdx < 0) return;

  const todayStr = todayLocal();
  const now      = new Date();
  const updates  = [];

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

    // Must have arrived but not yet departed
    const arrivedAt = String(row[arrivedAtIdx] || "").trim();
    if (!arrivedAt) continue;
    const departedAt = departedAtIdx >= 0 ? String(row[departedAtIdx] || "").trim() : "";
    if (departedAt) continue;

    // Already guarded for today
    if (_departedGuard.has(bookingId)) continue;

    // Must have elapsed enough on-site time
    let arrivedMs;
    try { arrivedMs = new Date(arrivedAt).getTime(); } catch { continue; }
    if (now.getTime() - arrivedMs < MIN_ON_SITE_MS) continue;

    // Must have geocoded coordinates
    const bLat = parseFloat(row[latIdx]);
    const bLng = parseFloat(row[lngIdx]);
    if (isNaN(bLat) || isNaN(bLng)) continue;

    // Check if ANY device is still on site
    const anyOnSite = positions.some(p =>
      p.lat != null && p.lon != null &&
      distMeters(bLat, bLng, p.lat, p.lon) <= DEPARTURE_RADIUS_M
    );
    if (anyOnSite) continue;

    // All clear — mark departed
    _departedGuard.add(bookingId);

    const nowIso         = now.toISOString();
    const durationMins   = Math.round((now.getTime() - arrivedMs) / 60_000);

    const updRow = [...row];
    while (updRow.length < headers.length) updRow.push("");
    if (departedAtIdx  >= 0) updRow[departedAtIdx]  = nowIso;
    if (jobDurationIdx >= 0) updRow[jobDurationIdx] = String(durationMins);

    updates.push({ rowNum: i + 1, row: updRow.slice(0, headers.length), bookingId, durationMins });
  }

  if (!updates.length) return;

  const endCol = colLetter(headers.length - 1);
  for (const upd of updates) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range:            `Bookings!A${upd.rowNum}:${endCol}${upd.rowNum}`,
        valueInputOption: "RAW",
        requestBody:      { majorDimension: "ROWS", values: [upd.row] },
      });
      console.log(`[traccar] Auto-departure: booking ${upd.bookingId} — ${upd.durationMins} min on site`);
    } catch (err) {
      console.error(`[traccar] Failed to write departure for ${upd.bookingId}:`, err.message);
    }
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────

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
      lon:        p.longitude,   // internal alias for distance calcs
      speed:      Math.round((p.speed || 0) * 1.15078), // knots → mph
      fixTime:    p.fixTime || p.deviceTime || null,
    })) : [];

    _cache = { positions, lastPoll: new Date().toISOString(), online: true };

    // Run arrival + departure detection asynchronously — errors must not crash poll()
    const arrivalPositions = Array.isArray(rawPositions) ? rawPositions : [];
    runArrivalCheck(arrivalPositions, deviceMap).catch(err => {
      console.error("[traccar] Arrival check error:", err.message);
    });
    runDepartureCheck(positions).catch(err => {
      console.error("[traccar] Departure check error:", err.message);
    });

  } catch (err) {
    console.error("[traccar] Poll error:", err.message);
    _cache = { ..._cache, online: false, lastPoll: new Date().toISOString() };
  }
}

// ── Trips endpoint ────────────────────────────────────────────────────────

// Returns today's Chicago-local midnight as an ISO UTC string.
function todayChicagoMidnightIso() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const secsSinceMidnight =
    parseInt(parts.hour, 10) * 3600 +
    parseInt(parts.minute, 10) * 60 +
    parseInt(parts.second, 10);
  return new Date(now.getTime() - secsSinceMidnight * 1000).toISOString();
}

// Fetch today's trips from Traccar and aggregate per device.
async function fetchTrips() {
  const from = todayChicagoMidnightIso();
  const to   = new Date().toISOString();
  const raw  = await traccarFetch(
    `/api/reports/trips?all=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  if (!Array.isArray(raw)) return [];

  const byDevice = {};
  for (const trip of raw) {
    const id = String(trip.deviceId);
    if (!byDevice[id]) {
      byDevice[id] = {
        deviceId:            id,
        deviceName:          trip.deviceName || `Device ${id}`,
        miles_today:         0,
        drive_minutes_today: 0,
        trip_count:          0,
      };
    }
    byDevice[id].miles_today         += (trip.distance || 0) / 1609.344; // m → miles
    byDevice[id].drive_minutes_today += (trip.duration || 0) / 60000;    // ms → min
    byDevice[id].trip_count          += 1;
  }

  return Object.values(byDevice).map(d => ({
    ...d,
    miles_today:         Math.round(d.miles_today * 10) / 10,
    drive_minutes_today: Math.round(d.drive_minutes_today),
  }));
}

async function handleGetTrips(req, res) {
  if (!traccarEnabled()) {
    return json(res, 200, { ok: true, trips: [] });
  }

  const staleMs = _tripsCache.lastFetch
    ? Date.now() - new Date(_tripsCache.lastFetch).getTime()
    : Infinity;

  if (staleMs > TRIPS_CACHE_TTL_MS) {
    try {
      _tripsCache.data      = await fetchTrips();
      _tripsCache.lastFetch = new Date().toISOString();
      console.log(`[traccar] Trips refreshed — ${_tripsCache.data.length} device(s)`);
    } catch (err) {
      console.error("[traccar] Trips fetch error:", err.message);
    }
  }

  return json(res, 200, {
    ok:        true,
    trips:     _tripsCache.data,
    lastFetch: _tripsCache.lastFetch,
  });
}

// ── Public API ────────────────────────────────────────────────────────────

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

  // If cache is cold (server just started) or stale by >90s, trigger a fresh poll
  // so the first fleet page load gets live data without a 30-60s wait.
  const staleMs = _cache.lastPoll ? (Date.now() - new Date(_cache.lastPoll).getTime()) : Infinity;
  if (!_cache.lastPoll || staleMs > 90_000) {
    try { await poll(); } catch { /* errors already logged inside poll() */ }
  }

  return json(res, 200, {
    ok:        true,
    online:    _cache.online,
    positions: _cache.positions,
    mode:      process.env.TRACCAR_MODE || "traccar_app",
    lastPoll:  _cache.lastPoll,
  });
}

module.exports = { handleGetPositions, handleGetTrips, startPolling, stopPolling };
