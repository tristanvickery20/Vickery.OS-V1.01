// lib/marketingSheetClient.js
// Returns the Marketing-dedicated sheet ID.
// Marketing tabs: Reviews, Templates, ReferralLedger
// Set MARKETING_SHEET_ID in Replit Secrets and share the sheet with the service account.

function marketingSpreadsheetId() {
  const id = process.env.MARKETING_SHEET_ID;
  if (!id) throw new Error("[FATAL] MARKETING_SHEET_ID is not configured. Set this Replit Secret to enable the Marketing module.");
  return id;
}

module.exports = { marketingSpreadsheetId };
