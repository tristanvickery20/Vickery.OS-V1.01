// api/schedule-geocode.js
// POST /api/schedule/geocode  — geocode booking addresses and cache lat/lng in Bookings sheet
"use strict";
const https = require("https");
const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const PROXIMITY = "-93.7363,30.0930"; // Orange, TX
// Restrict geocoding to SE Texas / SW Louisiana service region.
// This prevents Mapbox from matching streets in distant cities (e.g. Nacogdoches).
const BBOX = "-95.5,29.2,-92.5,31.1"; // roughly Orange/Beaumont/Port Arthur area

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

// Convert 0-based column index to spreadsheet column letter (A, B, …, Z, AA, …)
function colLetter(n) {
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function geocodeAddress(address) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return Promise.reject(new Error("MAPBOX_TOKEN not configured"));
  const encoded = encodeURIComponent(address.trim());
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&proximity=${PROXIMITY}&bbox=${BBOX}&country=US&limit=1`;
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let data = "";
      r.on("data", d => { data += d; });
      r.on("end", () => {
        try {
          const body = JSON.parse(data);
          const feat = (body.features || [])[0];
          if (!feat) return resolve(null);
          const [lng, lat] = feat.center;
          resolve({ lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) });
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function handleGeocode(req, res) {
  try {
    if (!process.env.MAPBOX_TOKEN) {
      return json(res, 503, { ok: false, error: "MAPBOX_TOKEN not configured" });
    }
    const body = await readBody(req);
    // booking_ids: specific IDs to geocode (re-geocodes even if cached)
    // If omitted, geocode all bookings missing lat/lng
    const { booking_ids } = body;

    await ensureTabHeaders("Bookings");
    const sheets = await getSheetsClient();
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Bookings!A:Z",
    });
    const rows = r.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, results: [], updated: 0 });

    const headers = rows[0];
    const latIdx  = headers.indexOf("lat");
    const lngIdx  = headers.indexOf("lng");
    const idIdx   = headers.indexOf("booking_id");
    const addrIdx = headers.indexOf("address");

    if (latIdx < 0 || lngIdx < 0) {
      return json(res, 500, { ok: false, error: "lat/lng columns missing from Bookings schema" });
    }

    const data = rows.slice(1);
    const toGeocode = [];
    for (let i = 0; i < data.length; i++) {
      const row  = data[i];
      const id   = row[idIdx]   || "";
      const addr = row[addrIdx] || "";
      const lat  = row[latIdx]  || "";
      const lng  = row[lngIdx]  || "";
      if (!id || !addr) continue;
      if (booking_ids && !booking_ids.includes(id)) continue;
      if (lat && lng && !booking_ids) continue; // skip already-cached unless explicit
      toGeocode.push({ rowIndex: i + 2, id, addr }); // rowIndex is 1-indexed + header row
    }

    const results = [];
    const updates = [];

    for (const item of toGeocode) {
      try {
        const coords = await geocodeAddress(item.addr);
        if (!coords) {
          results.push({ booking_id: item.id, ok: false, error: "No geocode result" });
          continue;
        }
        results.push({ booking_id: item.id, ok: true, lat: coords.lat, lng: coords.lng });
        updates.push({
          range: `Bookings!${colLetter(latIdx)}${item.rowIndex}:${colLetter(lngIdx)}${item.rowIndex}`,
          values: [[String(coords.lat), String(coords.lng)]],
        });
        console.log(`[geocode] ${item.id} → ${coords.lat},${coords.lng}`);
      } catch (e) {
        console.error(`[geocode] ${item.id} error:`, e.message);
        results.push({ booking_id: item.id, ok: false, error: e.message });
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID(),
        requestBody: { valueInputOption: "USER_ENTERED", data: updates },
      });
    }

    json(res, 200, { ok: true, results, updated: updates.length });
  } catch (err) {
    console.error("[schedule-geocode]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGeocode };
