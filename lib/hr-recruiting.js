// lib/hr-recruiting.js — HR Phase 4: Recruiting Pipeline data layer

const { getSheetsClient, colToLetter } = require("./sheets");

function sid() { return process.env.CRM_SHEET_ID; }

// ── Sheet definitions ──────────────────────────────────────────────────────────

const JOB_OPENINGS_TAB = "HR_JobOpenings";
const JOB_OPENINGS_HEADERS = [
  "opening_id", "title", "department_id", "designation_id",
  "description", "status", "posted_date", "created_at",
];

const APPLICANTS_TAB = "HR_JobApplicants";
const APPLICANTS_HEADERS = [
  "applicant_id", "opening_id", "name", "email", "phone",
  "source", "resume_url", "status", "notes", "applied_at",
];

const INTERVIEWS_TAB = "HR_Interviews";
const INTERVIEWS_HEADERS = [
  "interview_id", "applicant_id", "interviewer_id", "interview_type",
  "scheduled_at", "result", "skill_rating", "feedback", "created_at",
];

const OFFERS_TAB = "HR_JobOffers";
const OFFERS_HEADERS = [
  "offer_id", "applicant_id", "opening_id", "pay_rate", "pay_period",
  "designation_id", "department_id", "start_date", "status",
  "offer_token", "notes", "created_at", "updated_at", "converted_staff_id", "expires_at",
];

// ── Generic helpers ────────────────────────────────────────────────────────────

async function ensureTab(tabName, headers) {
  const spreadsheetId = sid();
  if (!spreadsheetId) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    console.log(`[recruiting] Created tab: ${tabName}`);
  }
}

async function readTab(tabName, headers) {
  const spreadsheetId = sid();
  if (!spreadsheetId) return [];
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  const hdrs = rows[0];
  return rows.slice(1).filter(r => r && r.some(c => c)).map(row => {
    const obj = {};
    hdrs.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
    return obj;
  });
}

async function appendRow(tabName, headers, record) {
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const row = headers.map(h => String(record[h] ?? ""));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:AZ`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateRowById(tabName, idField, idValue, updates) {
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const hdrs = rows[0];
  const idIdx = hdrs.indexOf(idField);
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idIdx] || "") === idValue) {
      const updated = [...rows[i]];
      while (updated.length < hdrs.length) updated.push("");
      Object.entries(updates).forEach(([k, v]) => {
        const idx = hdrs.indexOf(k);
        if (idx >= 0) updated[idx] = String(v ?? "");
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [updated] },
      });
      return true;
    }
  }
  return false;
}

async function deleteRowById(tabName, idField, idValue) {
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const metaResp = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMeta = metaResp.data.sheets.find(s => s.properties.title === tabName);
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  const hdrs = rows[0] || [];
  const idIdx = hdrs.indexOf(idField);
  const rowIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || "") === idValue);
  if (rowIndex < 0) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    },
  });
  return true;
}

// ── Job Openings ───────────────────────────────────────────────────────────────

async function readAllJobOpenings() { return readTab(JOB_OPENINGS_TAB, JOB_OPENINGS_HEADERS); }
async function appendJobOpening(record) { return appendRow(JOB_OPENINGS_TAB, JOB_OPENINGS_HEADERS, record); }
async function updateJobOpening(id, updates) { return updateRowById(JOB_OPENINGS_TAB, "opening_id", id, updates); }
async function deleteJobOpening(id) { return deleteRowById(JOB_OPENINGS_TAB, "opening_id", id); }

// ── Job Applicants ─────────────────────────────────────────────────────────────

async function readAllApplicants() { return readTab(APPLICANTS_TAB, APPLICANTS_HEADERS); }
async function appendApplicant(record) { return appendRow(APPLICANTS_TAB, APPLICANTS_HEADERS, record); }
async function updateApplicant(id, updates) { return updateRowById(APPLICANTS_TAB, "applicant_id", id, updates); }
async function deleteApplicant(id) { return deleteRowById(APPLICANTS_TAB, "applicant_id", id); }

// ── Interviews ─────────────────────────────────────────────────────────────────

async function readAllInterviews() { return readTab(INTERVIEWS_TAB, INTERVIEWS_HEADERS); }
async function appendInterview(record) { return appendRow(INTERVIEWS_TAB, INTERVIEWS_HEADERS, record); }
async function updateInterview(id, updates) { return updateRowById(INTERVIEWS_TAB, "interview_id", id, updates); }
async function deleteInterview(id) { return deleteRowById(INTERVIEWS_TAB, "interview_id", id); }

// ── Job Offers ─────────────────────────────────────────────────────────────────

async function readAllOffers() { return readTab(OFFERS_TAB, OFFERS_HEADERS); }
async function appendOffer(record) { return appendRow(OFFERS_TAB, OFFERS_HEADERS, record); }
async function updateOffer(id, updates) { return updateRowById(OFFERS_TAB, "offer_id", id, updates); }

// ── Column migration (add missing columns to existing tabs) ────────────────────

async function ensureMissingColumns(tabName, headers) {
  const spreadsheetId = sid();
  if (!spreadsheetId) return;
  const sheets = await getSheetsClient();
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!1:1` });
    const existing = (resp.data.values || [[]])[0] || [];
    for (const col of headers) {
      if (!existing.includes(col)) {
        const letter = colToLetter(existing.length);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${tabName}!${letter}1`,
          valueInputOption: "RAW",
          requestBody: { values: [[col]] },
        });
        existing.push(col);
        console.log(`[recruiting] Added column "${col}" to ${tabName}`);
      }
    }
  } catch (e) {
    // Tab may not exist yet — ensureTab will create it with correct headers
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────

async function ensureRecruitingSheets() {
  await Promise.all([
    ensureTab(JOB_OPENINGS_TAB, JOB_OPENINGS_HEADERS),
    ensureTab(APPLICANTS_TAB, APPLICANTS_HEADERS),
    ensureTab(INTERVIEWS_TAB, INTERVIEWS_HEADERS),
    ensureTab(OFFERS_TAB, OFFERS_HEADERS),
  ]);
  // Patch any missing columns into existing tabs (e.g. converted_staff_id)
  await ensureMissingColumns(OFFERS_TAB, OFFERS_HEADERS);
}

module.exports = {
  ensureRecruitingSheets,
  readAllJobOpenings, appendJobOpening, updateJobOpening, deleteJobOpening,
  readAllApplicants, appendApplicant, updateApplicant, deleteApplicant,
  readAllInterviews, appendInterview, updateInterview, deleteInterview,
  readAllOffers, appendOffer, updateOffer,
};
