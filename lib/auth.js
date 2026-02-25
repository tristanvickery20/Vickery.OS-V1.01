const crypto = require("crypto");

const COOKIE_NAME = "crm_session";
const SESSION_TTL = 24 * 60 * 60 * 1000;

function getSecret() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET env var is required");
  return process.env.SESSION_SECRET;
}

function sign(value) {
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(value);
  return value + "." + hmac.digest("base64url");
}

function unsign(signed) {
  if (!signed || typeof signed !== "string") return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 1) return null;
  const value = signed.slice(0, idx);
  if (sign(value) === signed) return value;
  return null;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const [k, ...v] = pair.trim().split("=");
    if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
  });
  return cookies;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const value = unsign(token);
  if (!value) return false;
  try {
    const data = JSON.parse(value);
    if (Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function setAuthCookie(res) {
  const payload = JSON.stringify({ ok: true, exp: Date.now() + SESSION_TTL });
  const signed = sign(payload);
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    arr.push(cookie);
    res.setHeader("Set-Cookie", arr);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

function clearAuthCookie(res) {
  const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  res.setHeader("Set-Cookie", cookie);
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  const isApi = req.url.startsWith("/api/");
  if (isApi) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }));
  } else {
    res.writeHead(302, { Location: "/login" });
    res.end();
  }
  return false;
}

module.exports = { isAuthed, requireAuth, setAuthCookie, clearAuthCookie };
