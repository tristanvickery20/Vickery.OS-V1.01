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

/**
 * Convert a 0-based column index to a Sheets column letter (A, Z, AA, AE, etc.)
 * Works for any column count (not just A-Z).
 */
function colToLetter(idx) {
  let letter = "";
  let n = idx + 1; // convert to 1-based
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { getSheetsClient, colToLetter };