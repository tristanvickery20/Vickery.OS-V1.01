// lib/opsSheetClient.js
// Returns the Ops/Fleet-dedicated sheet ID.
// Ops tabs: FleetVehicles, FleetMaintenance, ToolAssets, ToolIssues,
//           InventoryItems, TruckStock, MaterialRequests
// Set TRUCK_STOCK_ID in Replit Secrets and share the sheet with the service account.

function opsSpreadsheetId() {
  const id = process.env.TRUCK_STOCK_ID;
  if (!id) throw new Error("[FATAL] TRUCK_STOCK_ID is not configured. Set this Replit Secret to enable the Fleet/Ops module.");
  return id;
}

module.exports = { opsSpreadsheetId };
