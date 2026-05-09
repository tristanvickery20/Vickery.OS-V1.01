const { google } = require("googleapis");

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON secret");
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/\n/g, "\\n"));
  }
}

let _sheetsClient = null;
let _clientCreatedAt = 0;
const CLIENT_TTL_MS = 55 * 60 * 1000;

async function getSheetsClient() {
  const now = Date.now();
  if (_sheetsClient && now - _clientCreatedAt < CLIENT_TTL_MS) {
    return _sheetsClient;
  }
  const creds = getServiceAccount();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  _clientCreatedAt = now;
  return _sheetsClient;
}

const _readCache = new Map();
const READ_CACHE_TTL_MS = 30 * 1000;

async function cachedGet(spreadsheetId, range) {
  const key = `${spreadsheetId}::${range}`;
  const hit = _readCache.get(key);
  if (hit && Date.now() - hit.ts < READ_CACHE_TTL_MS) return hit.data;

  const data = await withRetry(() =>
    getSheetsClient().then(s => s.spreadsheets.values.get({ spreadsheetId, range }).then(r => r.data))
  );
  _readCache.set(key, { ts: Date.now(), data });
  return data;
}

function invalidateCache(spreadsheetId, tabName) {
  const prefix = `${spreadsheetId}::`;
  for (const key of _readCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (!tabName || key.includes(`::${tabName}!`)) _readCache.delete(key);
  }
}

async function withRetry(fn, maxAttempts = 4) {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit =
        err.code === 429 ||
        (err.message && err.message.includes("Quota exceeded")) ||
        (err.status === 429);
      if (!isRateLimit || attempt === maxAttempts) throw err;
      console.warn(`[sheets] Rate limit hit — retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

function colToLetter(idx) {
  let letter = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { getSheetsClient, cachedGet, invalidateCache, withRetry, colToLetter };
