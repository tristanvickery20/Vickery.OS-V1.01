// lib/staff.js — Crew account management
// Handles: Staff Sheet CRUD, session cookies, password hashing, SMS notifications.

const crypto = require("crypto");
const { getSheetsClient } = require("./sheets");
const { sendSms } = require("./sms");

const STAFF_TAB = "Staff";
const STAFF_HEADERS = [
  "staff_id", "first_name", "last_name", "phone",
  "password_hash", "status", "permissions",
  "created_at", "approved_at", "notes",
  "username", "role",
];
const CREW_SESSION_COOKIE = "crew_session";
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours
const PASSWORD_HASH_SCHEME = "scrypt";
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function spreadsheetId() { return process.env.CRM_SHEET_ID; }

function secret() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET env var is required");
  return process.env.SESSION_SECRET;
}

function legacyHashPassword(password) {
  return crypto.createHmac("sha256", secret()).update("pw:" + password).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES);
  const hash = crypto.scryptSync(String(password), salt, PASSWORD_KEY_BYTES, SCRYPT_OPTIONS);
  return `${PASSWORD_HASH_SCHEME}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function timingSafeEqualBuffers(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function timingSafeEqualStrings(a, b) {
  const aBuffer = Buffer.from(String(a || ""));
  const bBuffer = Buffer.from(String(b || ""));
  return timingSafeEqualBuffers(aBuffer, bBuffer);
}

function verifyScryptPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_HASH_SCHEME) return false;

  const salt = Buffer.from(parts[1], "hex");
  const expectedHash = Buffer.from(parts[2], "hex");
  if (!salt.length || !expectedHash.length) return false;

  const actualHash = crypto.scryptSync(String(password), salt, expectedHash.length, SCRYPT_OPTIONS);
  return timingSafeEqualBuffers(actualHash, expectedHash);
}

function verifyPassword(password, storedHash) {
  const stored = String(storedHash || "");
  if (stored.startsWith(`${PASSWORD_HASH_SCHEME}$`)) {
    return verifyScryptPassword(password, stored);
  }
  return timingSafeEqualStrings(legacyHashPassword(password), stored);
}

function needsPasswordRehash(storedHash) {
  return !String(storedHash || "").startsWith(`${PASSWORD_HASH_SCHEME}$`);
}

function signPayload(obj) {
  const b64 = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig  = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function verifyPayload(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig  = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  if (sig !== token.slice(dot + 1)) return null;
  try {
    const obj = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

// ── Session ───────────────────────────────────────────────────────────────────
function getCrewSession(req) {
  const header = req.headers.cookie || "";
  const m = header.match(/(?:^|;\s*)crew_session=([^;]+)/);
  if (!m) return null;
  return verifyPayload(decodeURIComponent(m[1]));
}

function setCrewSessionCookie(res, staff) {
  const token = signPayload({
    staffId:     staff.staff_id,
    firstName:   staff.first_name,
    lastName:    staff.last_name,
    phone:       staff.phone || "",
    username:    staff.username || "",
    role:        staff.role || "crew",
    permissions: staff.permissions || "jobs,time,expenses",
    exp:         Date.now() + SESSION_TTL,
  });
  res.setHeader("Set-Cookie",
    `${CREW_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`
  );
}

function clearCrewSessionCookie(res) {
  res.setHeader("Set-Cookie",
    `${CREW_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function requireCrewAuth(req, res) {
  const session = getCrewSession(req);
  if (session) return session;
  const isApi = req.url.startsWith("/api/");
  if (isApi) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "CREW_AUTH_REQUIRED" }));
  } else {
    res.writeHead(302, { Location: "/login" });
    res.end();
  }
  return null;
}

// ── Staff sheet ───────────────────────────────────────────────────────────────
async function ensureStaffSheet() {
  const sid = spreadsheetId();
  if (!sid) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const exists = meta.data.sheets.some(s => s.properties.title === STAFF_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests: [{ addSheet: { properties: { title: STAFF_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${STAFF_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [STAFF_HEADERS] },
    });
    console.log("[staff] Created Staff sheet");
    return;
  }
  // Migrate existing sheet — add username/role headers if missing
  const hRes = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!1:1` });
  const existingHeaders = (hRes.data.values || [[]])[0] || [];
  const toAdd = [];
  if (!existingHeaders.includes("username")) toAdd.push("username");
  if (!existingHeaders.includes("role"))     toAdd.push("role");
  if (toAdd.length > 0) {
    const startCol = String.fromCharCode(65 + existingHeaders.length); // e.g. K, L
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${STAFF_TAB}!${startCol}1`,
      valueInputOption: "RAW",
      requestBody: { values: [toAdd] },
    });
    console.log("[staff] Added Staff columns:", toAdd.join(", "));
  }
}

async function readAllStaff() {
  const sid = spreadsheetId();
  if (!sid) return [];
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!A:Z` });
    const rows = resp.data.values || [];
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
      return obj;
    });
  } catch (err) {
    console.error("[staff/readAllStaff] Sheet read failed:", err.message);
    return [];
  }
}

async function findStaffByPhone(phone) {
  const all = await readAllStaff();
  const norm = normalizePhone(phone);
  return all.find(s => normalizePhone(s.phone) === norm) || null;
}

async function findStaffByUsername(username) {
  const all = await readAllStaff();
  const u = String(username || "").trim().toLowerCase();
  return all.find(s => (s.username || "").toLowerCase() === u) || null;
}

async function findStaffById(staffId) {
  const all = await readAllStaff();
  return all.find(s => s.staff_id === staffId) || null;
}

async function appendStaffRow(staff) {
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const row = STAFF_HEADERS.map(h => staff[h] || "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: sid,
    range: `${STAFF_TAB}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateStaffRow(staffId, updates) {
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!A:Z` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0];
  const idIdx = headers.indexOf("staff_id");
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idIdx] || "") === staffId) {
      const updated = [...rows[i]];
      while (updated.length < headers.length) updated.push("");
      Object.entries(updates).forEach(([k, v]) => {
        const idx = headers.indexOf(k);
        if (idx >= 0) updated[idx] = String(v);
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${STAFF_TAB}!A${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [updated] },
      });
      return true;
    }
  }
  return false;
}

async function pendingCount() {
  const all = await readAllStaff();
  return all.filter(s => s.status === "pending").length;
}

// sendSms is provided by lib/sms.js (SignalWire)

module.exports = {
  ensureStaffSheet, readAllStaff, findStaffByPhone, findStaffByUsername, findStaffById,
  appendStaffRow, updateStaffRow, pendingCount,
  hashPassword, verifyPassword, needsPasswordRehash, normalizePhone,
  getCrewSession, setCrewSessionCookie, clearCrewSessionCookie, requireCrewAuth,
  sendSms,
};
