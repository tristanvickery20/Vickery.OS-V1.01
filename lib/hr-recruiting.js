// lib/hr-recruiting.js — HR Phase 4: Recruiting pipeline
//
// DATA MIGRATION NOTE (2026-05-11):
// All HR_Job* and HR_Interview* tabs now live on HR_SHEET_ID.
// Copy HR_JobOpenings, HR_JobApplicants, HR_Interviews, HR_JobOffers
// from the CRM sheet to the HR sheet manually on first boot.

const crypto    = require("crypto");
const { getSheetsClient } = require("./sheets");
const { hrSpreadsheetId } = require("./hrSheetClient");

const OPENINGS_TAB   = "HR_JobOpenings";
const APPLICANTS_TAB = "HR_JobApplicants";
const INTERVIEWS_TAB = "HR_Interviews";
const OFFERS_TAB     = "HR_JobOffers";

// Column names match exactly what api/hr-recruiting.js reads/writes.
// Do NOT rename these without updating api/hr-recruiting.js in lockstep.
const OPENINGS_HEADERS = [
  "opening_id", "title", "department_id", "designation_id",
  "description", "status", "posted_date", "created_at", "updated_at",
];
const APPLICANTS_HEADERS = [
  "applicant_id", "opening_id", "name", "phone", "email",
  "resume_url", "linkedin_url", "cover_letter", "source",
  "status", "notes", "applied_at", "updated_at",
];
const INTERVIEWS_HEADERS = [
  "interview_id", "applicant_id", "interviewer_id",
  "interview_type", "scheduled_at",
  "result", "skill_rating", "feedback",
  "created_at",
];
const OFFERS_HEADERS = [
  "offer_id", "applicant_id", "opening_id", "pay_rate", "pay_period",
  "designation_id", "department_id", "start_date", "status",
  "offer_token", "notes", "created_at", "updated_at",
  "converted_staff_id",  // idempotency guard for handleCreateEmployeeFromOffer — must precede expires_at
  "expires_at",
];

function hrId() { return hrSpreadsheetId(); }

// ── Generic helpers (HR sheet) ──────────────────────────────────────────────────

async function ensureTab(tabName, headers) {
  const spreadsheetId = hrId();
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
    console.log(`[hr-recruiting] Created tab: ${tabName}`);
  }
}

async function readTab(tabName) {
  const spreadsheetId = hrId();
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

async function appendRow(tabName, fallbackHeaders, record) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  // Always read actual headers from the sheet (row 1) before writing.
  // This ensures correct column alignment for both new and migrated (pre-existing) tabs.
  const hRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!1:1` });
  const actualHeaders = ((hRes.data.values || [[]])[0] || []).filter(Boolean);
  const headers = actualHeaders.length > 0 ? actualHeaders : fallbackHeaders;
  const row = headers.map(h => String(record[h] ?? ""));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:AZ`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateRowById(tabName, idField, idValue, updates) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0];
  const idIdx = headers.indexOf(idField);
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idIdx] || "") === idValue) {
      const updated = [...rows[i]];
      while (updated.length < headers.length) updated.push("");
      Object.entries(updates).forEach(([k, v]) => {
        const idx = headers.indexOf(k);
        if (idx >= 0) {
          while (updated.length <= idx) updated.push("");
          updated[idx] = String(v ?? "");
        }
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
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const metaResp = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMeta = metaResp.data.sheets.find(s => s.properties.title === tabName);
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  const headers = rows[0] || [];
  const idIdx = headers.indexOf(idField);
  const rowIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || "") === idValue);
  if (rowIndex < 0) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }],
    },
  });
  return true;
}

function genId(prefix) { return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }

// ── Job Openings ────────────────────────────────────────────────────────────────

async function readAllOpenings() { return readTab(OPENINGS_TAB); }
async function readOpeningById(id) { return (await readAllOpenings()).find(o => o.opening_id === id) || null; }

async function createOpening(fields) {
  const now = new Date().toISOString();
  const record = {
    opening_id: genId("JO"),
    title: fields.title || "",
    department_id: fields.department_id || "",
    designation_id: fields.designation_id || "",
    description: fields.description || "",
    status: fields.status || "Open",
    created_at: now,
    updated_at: now,
  };
  await appendRow(OPENINGS_TAB, OPENINGS_HEADERS, record);
  return record;
}

async function updateOpening(id, updates) {
  updates.updated_at = new Date().toISOString();
  return updateRowById(OPENINGS_TAB, "opening_id", id, updates);
}

async function deleteOpening(id) { return deleteRowById(OPENINGS_TAB, "opening_id", id); }

// ── Applicants ──────────────────────────────────────────────────────────────────

async function readAllApplicants() { return readTab(APPLICANTS_TAB); }
async function readApplicantById(id) { return (await readAllApplicants()).find(a => a.applicant_id === id) || null; }

async function createApplicant(fields) {
  const now = new Date().toISOString();
  const record = {
    applicant_id: genId("AP"),
    opening_id: fields.opening_id || "",
    name: fields.name || "",
    phone: fields.phone || "",
    email: fields.email || "",
    resume_url: fields.resume_url || "",
    linkedin_url: fields.linkedin_url || "",
    cover_letter: fields.cover_letter || "",
    source: fields.source || "Direct",
    status: fields.status || "New",
    notes: fields.notes || "",
    applied_at: now,
    updated_at: now,
  };
  await appendRow(APPLICANTS_TAB, APPLICANTS_HEADERS, record);
  return record;
}

async function updateApplicant(id, updates) {
  updates.updated_at = new Date().toISOString();
  return updateRowById(APPLICANTS_TAB, "applicant_id", id, updates);
}

// ── Interviews ──────────────────────────────────────────────────────────────────

async function readAllInterviews() { return readTab(INTERVIEWS_TAB); }
async function readInterviewsByApplicant(applicantId) {
  return (await readAllInterviews()).filter(i => i.applicant_id === applicantId);
}

async function createInterview(fields) {
  const now = new Date().toISOString();
  const record = {
    interview_id:   genId("IV"),
    applicant_id:   fields.applicant_id   || "",
    interviewer_id: fields.interviewer_id  || "",
    interview_type: fields.interview_type  || "Phone Screen",
    scheduled_at:   fields.scheduled_at    || "",
    result:         fields.result          || "Pending",
    skill_rating:   String(fields.skill_rating ?? ""),
    feedback:       fields.feedback        || "",
    created_at:     now,
  };
  await appendRow(INTERVIEWS_TAB, INTERVIEWS_HEADERS, record);
  return record;
}

async function updateInterview(id, updates) {
  updates.updated_at = new Date().toISOString();
  return updateRowById(INTERVIEWS_TAB, "interview_id", id, updates);
}

// ── Job Offers ──────────────────────────────────────────────────────────────────

async function readAllOffers() { return readTab(OFFERS_TAB); }
async function readOfferById(id) { return (await readAllOffers()).find(o => o.offer_id === id) || null; }
async function readOfferByToken(token) { return (await readAllOffers()).find(o => o.offer_token === token) || null; }
async function readOffersByApplicant(applicantId) {
  return (await readAllOffers()).filter(o => o.applicant_id === applicantId);
}

async function createOffer(fields) {
  const now = new Date().toISOString();
  const record = {
    offer_id:        genId("OF"),
    applicant_id:    fields.applicant_id  || "",
    opening_id:      fields.opening_id    || "",
    designation_id:  fields.designation_id || "",
    department_id:   fields.department_id  || "",
    pay_rate:        String(fields.pay_rate || ""),
    pay_period:      fields.pay_period     || "Hourly",
    start_date:      fields.start_date     || "",
    status:          "Draft",
    offer_token:     "",
    notes:           fields.notes          || "",
    created_at:      now,
    updated_at:      now,
    converted_staff_id: "",
    expires_at:      "",
  };
  await appendRow(OFFERS_TAB, OFFERS_HEADERS, record);
  return record;
}

async function markOfferSent(offerId) {
  const offer_token = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const ok = await updateRowById(OFFERS_TAB, "offer_id", offerId, {
    status: "Sent",
    offer_token,
    updated_at: now,
  });
  return ok ? offer_token : null;
}

async function updateOffer(id, updates) {
  updates.updated_at = new Date().toISOString();
  return updateRowById(OFFERS_TAB, "offer_id", id, updates);
}

// ── Startup ─────────────────────────────────────────────────────────────────────

async function ensureRecruitingSheets() {
  if (!process.env.HR_SHEET_ID) {
    throw new Error("[FATAL] HR_SHEET_ID is required. Recruiting sheets cannot initialize without it.");
  }
  await Promise.all([
    ensureTab(OPENINGS_TAB, OPENINGS_HEADERS),
    ensureTab(APPLICANTS_TAB, APPLICANTS_HEADERS),
    ensureTab(INTERVIEWS_TAB, INTERVIEWS_HEADERS),
    ensureTab(OFFERS_TAB, OFFERS_HEADERS),
  ]);
}

// ── Backward-compat aliases for api/hr-recruiting.js ───────────────────────────
// api/hr-recruiting.js constructs full record objects before appending.
// These low-level append functions write exactly the object the caller provides.
const readAllJobOpenings = readAllOpenings;
const updateJobOpening   = updateOpening;
const deleteJobOpening   = deleteOpening;

async function appendJobOpening(record) {
  return appendRow(OPENINGS_TAB, OPENINGS_HEADERS, record);
}

async function appendApplicant(record) {
  return appendRow(APPLICANTS_TAB, APPLICANTS_HEADERS, record);
}
async function deleteApplicant(id) {
  return deleteRowById(APPLICANTS_TAB, "applicant_id", id);
}

async function appendInterview(record) {
  return appendRow(INTERVIEWS_TAB, INTERVIEWS_HEADERS, record);
}
async function deleteInterview(id) {
  return deleteRowById(INTERVIEWS_TAB, "interview_id", id);
}

async function appendOffer(record) {
  return appendRow(OFFERS_TAB, OFFERS_HEADERS, record);
}

module.exports = {
  ensureRecruitingSheets,
  // New canonical names
  readAllOpenings, readOpeningById, createOpening, updateOpening, deleteOpening,
  readAllApplicants, readApplicantById, createApplicant, updateApplicant,
  readAllInterviews, readInterviewsByApplicant, createInterview, updateInterview,
  readAllOffers, readOfferById, readOfferByToken, readOffersByApplicant,
  createOffer, markOfferSent, updateOffer,
  // Backward-compat aliases used by api/hr-recruiting.js
  readAllJobOpenings, appendJobOpening, updateJobOpening, deleteJobOpening,
  appendApplicant, deleteApplicant,
  appendInterview, deleteInterview,
  appendOffer,
};
