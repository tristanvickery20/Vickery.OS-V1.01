const { google } = require("googleapis");

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON secret");

  // Replit secrets sometimes store raw JSON; sometimes stringified JSON.
  // This handles both.
  try {
    return JSON.parse(raw);
  } catch {
    // If it was pasted with surrounding quotes or escaped, try a cleanup.
    return JSON.parse(raw.replace(/\n/g, "\\n"));
  }
}

async function getSheetsClient() {
  const creds = getServiceAccount();

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

module.exports = { getSheetsClient };