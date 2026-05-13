// api/admin-backfill-photos.js
// POST /api/admin/backfill-photo-attachments  (CRM auth required)
// One-time migration: scans QuoteSnapshots for photo_uploaded / crew_photo_uploaded
// rows that have a URL in the "notes" column (index 20), checks whether an
// Attachments row already exists for that URL, and creates one if not.

const { getSheetsClient } = require("../lib/sheets");
const { appendAttachmentRow } = require("./attachments");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleBackfillPhotoAttachments(req, res) {
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return json(res, 500, { ok: false, error: "CRM_SHEET_ID not configured" });

  try {
    const sheets = await getSheetsClient();

    // 1. Read QuoteSnapshots — collect photo event rows
    const snapResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "QuoteSnapshots!A:Z",
    });
    const snapRows = snapResp.data.values || [];
    if (snapRows.length < 2) return json(res, 200, { ok: true, created: 0, skipped: 0 });

    const [snapHeaders, ...snapData] = snapRows;
    const si = Object.fromEntries(snapHeaders.map((h, i) => [String(h).trim(), i]));
    const sg = (row, col) => String(row[si[col] ?? -1] ?? "").trim();

    const PHOTO_EVENTS = new Set(["photo_uploaded", "crew_photo_uploaded"]);
    const isPhotoUrl = u => /^\/uploads\//.test(u) || /^https?:\/\//.test(u);

    // Gather candidate (entity_id, url, event_type) triples.
    // Prefer lead_id → quote_id as entity_id so the CRM lead detail card can find them.
    const candidates = [];
    for (const row of snapData) {
      const evtType = sg(row, "event_type");
      if (!PHOTO_EVENTS.has(evtType)) continue;
      // URL is stored in the "notes" column
      const url = sg(row, "notes");
      if (!url || !isPhotoUrl(url)) continue;
      // Use lead_id if present, else quote_id — these are what loadPhotosCard queries by
      const leadId  = sg(row, "lead_id");
      const quoteId = sg(row, "quote_id");
      const entityId = leadId || quoteId;
      if (!entityId) continue; // no resolvable ID — skip
      candidates.push({ entity_id: entityId, file_url: url, event_type: evtType });
    }

    if (!candidates.length) return json(res, 200, { ok: true, created: 0, skipped: 0, message: "No photo events found in QuoteSnapshots." });

    // 2. Read existing Attachments to build a set of already-bridged URLs
    const attResp = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Attachments!A:H",
    });
    const attRows = attResp.data.values || [];
    const existingUrls = new Set();
    if (attRows.length > 1) {
      const [attHeaders, ...attData] = attRows;
      const ai = Object.fromEntries(attHeaders.map((h, i) => [String(h).trim(), i]));
      for (const row of attData) {
        const url = String(row[ai["file_url"] ?? -1] ?? "").trim();
        if (url) existingUrls.add(url);
      }
    }

    // 3. Write missing ones
    let created = 0;
    let skipped = 0;
    for (const { entity_id, file_url, event_type } of candidates) {
      if (existingUrls.has(file_url)) { skipped++; continue; }
      const isCrew = event_type === "crew_photo_uploaded";
      await appendAttachmentRow({
        entity_type: "lead",
        entity_id,
        file_url,
        file_type: "image",
        category: isCrew ? "after" : "before",
        uploaded_by: isCrew ? "crew" : "customer",
      });
      existingUrls.add(file_url); // prevent double-write if same URL appears twice in snapshots
      created++;
    }

    json(res, 200, { ok: true, created, skipped, total_candidates: candidates.length });
  } catch (err) {
    console.error("[backfill-photos]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleBackfillPhotoAttachments };
