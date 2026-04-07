// api/schedule-optimize.js
// POST /api/schedule/optimize — optimize job order using Mapbox Optimization API (or nearest-neighbor fallback)
// POST /api/schedule/optimize/save — save optimized datetimes back to the sheet
"use strict";
const https = require("https");
const { getSheetsClient } = require("../lib/sheets");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
// Orange, TX depot (Vickery Electric home base)
const DEPOT = [-93.7363, 30.0930];

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// Mapbox Optimization v1 API — free up to 12 coordinates, 1 req/sec
function mapboxOptimize(bookings) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return Promise.reject(new Error("MAPBOX_TOKEN not configured"));

  // Coordinates: depot first, then each booking
  const coords = [
    `${DEPOT[0]},${DEPOT[1]}`,
    ...bookings.map(b => `${b.lng},${b.lat}`),
  ].join(";");

  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coords}?access_token=${token}&source=first&destination=last&roundtrip=false&overview=simplified`;

  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let data = "";
      r.on("data", d => { data += d; });
      r.on("end", () => {
        try {
          const body = JSON.parse(data);
          if (!body.waypoints) return reject(new Error(body.message || "Optimization API error"));
          // body.waypoints[i] = { waypoint_index, trips_index, ... }
          // waypoints[0] is the depot, bookings start at index 1
          // Sort booking waypoints by their waypoint_index to get optimized order
          const bookingWPs = body.waypoints.slice(1); // skip depot
          const sorted = [...bookingWPs].sort((a, b) => a.waypoint_index - b.waypoint_index);
          // Each sorted[i].name corresponds to bookings[sorted[i].original_index - 1]
          // But we need to map waypoint back to original booking index
          // waypoints array order = same as coords input, so index in bookingWPs IS original booking index
          const order = sorted.map((_, optIdx) => {
            // Find which original booking goes in slot optIdx
            const wp = bookingWPs.find(w => w.waypoint_index === optIdx + 1); // +1 because depot is 0
            if (!wp) return optIdx;
            return bookingWPs.indexOf(wp); // original index in bookings array
          });
          resolve(order.map(i => bookings[i]?.booking_id).filter(Boolean));
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

// Nearest-neighbor greedy fallback (O(n²))
function nearestNeighbor(bookings) {
  const remaining = [...bookings];
  const result    = [];
  let cur = { lat: DEPOT[1], lng: DEPOT[0] };
  while (remaining.length) {
    let best = null, bestDist = Infinity, bestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].lat - cur.lat, remaining[i].lng - cur.lng);
      if (d < bestDist) { bestDist = d; best = remaining[i]; bestIdx = i; }
    }
    result.push(best.booking_id);
    cur = { lat: best.lat, lng: best.lng };
    remaining.splice(bestIdx, 1);
  }
  return result;
}

// POST /api/schedule/optimize
async function handleOptimize(req, res) {
  try {
    if (!process.env.MAPBOX_TOKEN) {
      return json(res, 503, { ok: false, error: "MAPBOX_TOKEN not configured" });
    }
    const body = await readBody(req);
    // bookings: [{booking_id, lat, lng, scheduled_datetime}]
    const bookings = (body.bookings || []).filter(b => b.lat && b.lng && b.booking_id);
    if (bookings.length < 2) {
      // Nothing to optimize — return as-is
      return json(res, 200, { ok: true, order: bookings.map(b => b.booking_id), method: "unchanged" });
    }

    let order, method;
    try {
      order  = await mapboxOptimize(bookings);
      method = "mapbox";
      console.log(`[optimize] Mapbox → ${order.join(", ")}`);
    } catch (e) {
      console.warn("[optimize] Mapbox failed, using nearest-neighbor:", e.message);
      order  = nearestNeighbor(bookings);
      method = "nearest-neighbor";
    }

    json(res, 200, { ok: true, order, method });
  } catch (err) {
    console.error("[schedule-optimize]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/schedule/optimize/save — reassign datetimes in optimized order
// Body: { order: ["id1","id2"], times: ["ISO","ISO"] }
// times[i] is assigned to order[i]  (CRM provides original sorted times)
async function handleOptimizeSave(req, res) {
  try {
    const body = await readBody(req);
    const { order, times } = body; // parallel arrays
    if (!order?.length || !times?.length) {
      return json(res, 400, { ok: false, error: "order and times arrays required" });
    }

    const sheets = await getSheetsClient();
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Bookings!A:Z",
    });
    const rows = r.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, updated: 0 });

    const headers = rows[0];
    const idIdx   = headers.indexOf("booking_id");
    const dtIdx   = headers.indexOf("scheduled_datetime");

    const updates = [];
    const data = rows.slice(1);

    for (let i = 0; i < order.length && i < times.length; i++) {
      const rowIdx = data.findIndex(r => r[idIdx] === order[i]);
      if (rowIdx < 0) continue;
      const sheetRow = rowIdx + 2; // 1-indexed + header
      updates.push({
        range: `Bookings!${colLetter(dtIdx)}${sheetRow}`,
        values: [[times[i]]],
      });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID(),
        requestBody: { valueInputOption: "USER_ENTERED", data: updates },
      });
    }

    json(res, 200, { ok: true, updated: updates.length });
  } catch (err) {
    console.error("[optimize-save]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

function colLetter(n) {
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

module.exports = { handleOptimize, handleOptimizeSave };
