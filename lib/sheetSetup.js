// lib/sheetSetup.js
const { ensureAllHeaders } = require("./sheetsSchema");
const { ensureConfigDefaults } = require("./config");

async function ensureCrmSheetSetup() {
  const spreadsheetId = process.env.CRM_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("CRM_SHEET_ID is required for CRM operation.");
  }

  const summary = {
    headersEnsured: false,
    configSeeded: false,
  };

  try {
    await ensureAllHeaders();
    summary.headersEnsured = true;
  } catch (err) {
    console.error("[SheetSetup] Header setup failed:", err.message);
    throw err;
  }

  try {
    await ensureConfigDefaults();
    summary.configSeeded = true;
  } catch (err) {
    console.error("[SheetSetup] Config setup failed:", err.message);
    throw err;
  }

  console.log(
    `[SheetSetup] OK — headers ensured: ${summary.headersEnsured}, config seeded: ${summary.configSeeded}`
  );
}

module.exports = { ensureCrmSheetSetup };