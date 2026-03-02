// api/photo-upload.js
// POST /api/quote/photo — accept base64-encoded photo, save to /uploads/, log snapshot event.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getSheetsClient } = require("../lib/sheets");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const UPLOADS_DIR = path.join(__dirname, "../uploads");

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]);
const EXT_MAP = {
  "image/jpeg": "jpg", "image/jpg": "jpg",
  "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function nowIso() { return new Date().toISOString(); }
function newId() { return "EV-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }

async function appendPhotoSnapshot(quoteId, fileUrl) {
  try {
    const sheets = await getSheetsClient();
    const row = [
      newId(), quoteId, nowIso(), "photo_uploaded",
      "", "[]", "[]", "", "", "", "", "", "",
      "", "", "photo_uploaded", "", "", "", "", fileUrl,
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID(),
      range: "QuoteSnapshots!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });
  } catch (err) {
    console.error("[photo-upload] snapshot error:", err.message);
  }
}

async function handlePhotoUpload(req, res) {
  try {
    const body = await parseBody(req);
    const { quote_id, base64, mime_type, filename } = body;

    if (!quote_id) return json(res, 400, { ok: false, error: "quote_id required" });
    if (!base64) return json(res, 400, { ok: false, error: "base64 image data required" });

    const type = (mime_type || "image/jpeg").toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      return json(res, 400, { ok: false, error: "Unsupported image type. Use JPG, PNG, or WebP." });
    }

    const buf = Buffer.from(base64, "base64");
    if (buf.length > MAX_BYTES) {
      return json(res, 400, { ok: false, error: "Image too large (max 10 MB)." });
    }

    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const ext = EXT_MAP[type] || "jpg";
    const safeName = `${quote_id}-${Date.now()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buf);

    const fileUrl = `/uploads/${safeName}`;
    appendPhotoSnapshot(quote_id, fileUrl).catch(() => {});

    json(res, 200, { ok: true, url: fileUrl });
  } catch (err) {
    console.error("[photo-upload]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handlePhotoUpload };
