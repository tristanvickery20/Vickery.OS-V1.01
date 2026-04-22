// api/hr-recruiting.js — HR Phase 4: Recruiting Pipeline API

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  readAllJobOpenings, appendJobOpening, updateJobOpening, deleteJobOpening,
  readAllApplicants, appendApplicant, updateApplicant, deleteApplicant,
  readAllInterviews, appendInterview, updateInterview, deleteInterview,
  readAllOffers, appendOffer, updateOffer,
} = require("../lib/hr-recruiting");
const { readAllDepartments, readAllDesignations, appendEmployeeRow } = require("../lib/hr");
const { readAllEmployees } = require("../lib/hr");

const UPLOADS_DIR = path.join(__dirname, "../uploads/resumes");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Validate file content matches claimed extension using magic bytes
function isAllowedFileContent(buf, ext) {
  if (buf.length < 4) return false;
  const b = buf;
  const isPdf  = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  const isZip  = b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04; // PK (docx)
  const isOle  = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; // OLE (doc)
  const isRtf  = buf.slice(0, 5).toString("ascii") === "{\\rtf";
  const isTxt  = [".txt"].includes(ext);
  switch (ext) {
    case ".pdf":  return isPdf;
    case ".docx": return isZip;
    case ".doc":  return isOle;
    case ".rtf":  return isRtf;
    case ".txt":  return true; // plain text has no reliable magic bytes; allow if extension matches
    default:      return false;
  }
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", c => {
      bytes += Buffer.byteLength(c);
      if (bytes > maxBytes) { reject(new Error("Request body too large")); req.destroy(); return; }
      data += c;
    });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// ── Job Openings ───────────────────────────────────────────────────────────────

async function handleListJobOpenings(req, res) {
  try {
    const openings = await readAllJobOpenings();
    json(res, 200, { ok: true, openings });
  } catch (err) {
    console.error("[recruiting/openings]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateJobOpening(req, res) {
  try {
    const body = await readBody(req);
    const { title, department_id, designation_id, description, status } = body;
    if (!title?.trim()) return json(res, 400, { ok: false, error: "title is required" });
    if (department_id || designation_id) {
      const [depts, desigs] = await Promise.all([readAllDepartments(), readAllDesignations()]);
      if (department_id && !depts.find(d => d.dept_id === department_id)) {
        return json(res, 400, { ok: false, error: "department_id does not match any department" });
      }
      if (designation_id && !desigs.find(d => d.designation_id === designation_id)) {
        return json(res, 400, { ok: false, error: "designation_id does not match any designation" });
      }
    }
    const record = {
      opening_id: crypto.randomUUID(),
      title: title.trim(),
      department_id: department_id || "",
      designation_id: designation_id || "",
      description: (description || "").trim(),
      status: status === "Closed" ? "Closed" : "Open",
      posted_date: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    };
    await appendJobOpening(record);
    json(res, 200, { ok: true, opening: record });
  } catch (err) {
    console.error("[recruiting/openings/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateJobOpening(req, res, openingId) {
  try {
    const body = await readBody(req);
    if (body.status !== undefined && !["Open", "Closed"].includes(body.status)) {
      return json(res, 400, { ok: false, error: "status must be 'Open' or 'Closed'" });
    }
    if (body.department_id || body.designation_id) {
      const [depts, desigs] = await Promise.all([readAllDepartments(), readAllDesignations()]);
      if (body.department_id && !depts.find(d => d.dept_id === body.department_id)) {
        return json(res, 400, { ok: false, error: "department_id does not match any department" });
      }
      if (body.designation_id && !desigs.find(d => d.designation_id === body.designation_id)) {
        return json(res, 400, { ok: false, error: "designation_id does not match any designation" });
      }
    }
    const updates = {};
    ["title", "department_id", "designation_id", "description", "status"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    const ok = await updateJobOpening(openingId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/openings/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteJobOpening(req, res, openingId) {
  try {
    const ok = await deleteJobOpening(openingId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/openings/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Public: list open positions ────────────────────────────────────────────────

async function handlePublicJobListings(req, res) {
  try {
    const all = await readAllJobOpenings();
    const open = all.filter(o => o.status === "Open");
    const depts = await readAllDepartments();
    const desigs = await readAllDesignations();
    const enriched = open.map(o => ({
      ...o,
      department_name: depts.find(d => d.dept_id === o.department_id)?.name || "",
      designation_name: desigs.find(d => d.designation_id === o.designation_id)?.name || "",
    }));
    json(res, 200, { ok: true, openings: enriched });
  } catch (err) {
    console.error("[careers/listings]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Public: submit application ─────────────────────────────────────────────────

async function handlePublicApply(req, res) {
  try {
    // Allow up to 8 MB for base64-encoded resume attachments
    let body;
    try {
      body = await readBody(req, 8 * 1024 * 1024);
    } catch (sizeErr) {
      return json(res, 413, { ok: false, error: "Request too large. Total upload must be under 8 MB." });
    }
    const { opening_id, name, email, phone, source, resume_data, resume_name } = body;
    const cleanName  = String(name  || "").trim().slice(0, 200);
    const cleanEmail = String(email || "").trim().slice(0, 254);
    const cleanPhone = String(phone || "").trim().replace(/[^\d\s\-()+.ext]/gi, "").slice(0, 30);

    if (!opening_id?.trim() || !cleanName || !cleanEmail) {
      return json(res, 400, { ok: false, error: "opening_id, name, and email are required" });
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json(res, 400, { ok: false, error: "A valid email address is required" });
    }

    const openings = await readAllJobOpenings();
    const opening = openings.find(o => o.opening_id === opening_id);
    if (!opening) return json(res, 404, { ok: false, error: "Job opening not found" });
    if (opening.status === "Closed") return json(res, 400, { ok: false, error: "This position is no longer accepting applications" });

    let resume_url = "";
    let resume_warning = null;
    if (resume_data && resume_name) {
      try {
        ensureUploadsDir();
        const ext = path.extname(resume_name).toLowerCase() || ".pdf";
        const allowed = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf"]);
        if (!allowed.has(ext)) {
          resume_warning = `Resume not saved: unsupported file type "${ext}". Allowed: PDF, DOC, DOCX, TXT, RTF.`;
        } else {
          const base64 = resume_data.replace(/^data:[^;]+;base64,/, "");
          const buf = Buffer.from(base64, "base64");
          if (buf.length > 5 * 1024 * 1024) {
            resume_warning = "Resume not saved: file exceeds the 5 MB size limit.";
          } else if (!isAllowedFileContent(buf, ext)) {
            resume_warning = "Resume not saved: file content does not match the declared extension.";
          } else {
            const filename = `resume-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
            fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
            resume_url = `/uploads/resumes/${filename}`;
          }
        }
      } catch (e) {
        console.error("[recruiting/resume-upload]", e.message);
        resume_warning = "Resume could not be saved due to a server error. Your application was still submitted.";
      }
    }

    const record = {
      applicant_id: crypto.randomUUID(),
      opening_id: opening_id.trim(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      source: source || "Website",
      resume_url,
      status: "New",
      notes: "",
      applied_at: new Date().toISOString(),
    };
    await appendApplicant(record);
    json(res, 200, { ok: true, applicant_id: record.applicant_id, resume_warning });
  } catch (err) {
    console.error("[careers/apply]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Applicants (internal) ──────────────────────────────────────────────────────

async function handleListApplicants(req, res) {
  try {
    const url = new URL("http://x" + req.url);
    const openingId = url.searchParams.get("opening_id") || "";
    const all = await readAllApplicants();
    const filtered = openingId ? all.filter(a => a.opening_id === openingId) : all;
    const openings = await readAllJobOpenings();
    const enriched = filtered.map(a => ({
      ...a,
      opening_title: openings.find(o => o.opening_id === a.opening_id)?.title || "Unknown",
    }));
    json(res, 200, { ok: true, applicants: enriched });
  } catch (err) {
    console.error("[recruiting/applicants]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetApplicant(req, res, applicantId) {
  try {
    const all = await readAllApplicants();
    const applicant = all.find(a => a.applicant_id === applicantId);
    if (!applicant) return json(res, 404, { ok: false, error: "Applicant not found" });

    const openings = await readAllJobOpenings();
    const interviews = (await readAllInterviews()).filter(i => i.applicant_id === applicantId);
    const offers = (await readAllOffers()).filter(o => o.applicant_id === applicantId);
    const employees = await readAllEmployees();
    const depts = await readAllDepartments();
    const desigs = await readAllDesignations();

    const enrichedInterviews = interviews.map(i => ({
      ...i,
      interviewer_name: (() => {
        const emp = employees.find(e => e.staff_id === i.interviewer_id);
        return emp ? `${emp.first_name} ${emp.last_name}` : i.interviewer_id;
      })(),
    }));

    const enrichedOffers = offers.map(o => ({
      ...o,
      department_name: depts.find(d => d.dept_id === o.department_id)?.name || "",
      designation_name: desigs.find(d => d.designation_id === o.designation_id)?.name || "",
    }));

    json(res, 200, {
      ok: true,
      applicant: {
        ...applicant,
        opening_title: openings.find(o => o.opening_id === applicant.opening_id)?.title || "",
      },
      interviews: enrichedInterviews,
      offers: enrichedOffers,
    });
  } catch (err) {
    console.error("[recruiting/applicants/get]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

const APPLICANT_STATUSES = new Set(["New", "Screening", "Interview", "Offer", "Hired", "Rejected"]);
const OFFER_STATUSES = new Set(["Draft", "Sent", "Accepted", "Declined"]);

async function handleUpdateApplicant(req, res, applicantId) {
  try {
    const body = await readBody(req);
    if (body.status !== undefined && !APPLICANT_STATUSES.has(body.status)) {
      return json(res, 400, { ok: false, error: `Invalid status. Must be one of: ${[...APPLICANT_STATUSES].join(", ")}` });
    }
    const updates = {};
    ["status", "notes", "name", "email", "phone", "source"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    const ok = await updateApplicant(applicantId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/applicants/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteApplicant(req, res, applicantId) {
  try {
    const ok = await deleteApplicant(applicantId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/applicants/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Interviews ─────────────────────────────────────────────────────────────────

async function handleCreateInterview(req, res) {
  try {
    const body = await readBody(req);
    const { applicant_id, interviewer_id, interview_type, scheduled_at } = body;
    if (!applicant_id || !scheduled_at) {
      return json(res, 400, { ok: false, error: "applicant_id and scheduled_at are required" });
    }
    if (!interviewer_id?.trim()) {
      return json(res, 400, { ok: false, error: "interviewer_id is required — assign an employee to conduct this interview" });
    }
    if (interview_type !== undefined && !INTERVIEW_TYPES.has(interview_type)) {
      return json(res, 400, { ok: false, error: `Invalid interview_type. Must be one of: ${[...INTERVIEW_TYPES].join(", ")}` });
    }
    const [applicants, employees] = await Promise.all([readAllApplicants(), readAllEmployees()]);
    if (!applicants.find(a => a.applicant_id === applicant_id)) {
      return json(res, 404, { ok: false, error: "Applicant not found" });
    }
    if (!employees.find(e => e.staff_id === interviewer_id.trim())) {
      return json(res, 400, { ok: false, error: "interviewer_id does not match any employee record" });
    }
    const record = {
      interview_id: crypto.randomUUID(),
      applicant_id: applicant_id.trim(),
      interviewer_id: interviewer_id || "",
      interview_type: interview_type || "Phone Screen",
      scheduled_at: scheduled_at.trim(),
      result: "Pending",
      skill_rating: "",
      feedback: "",
      created_at: new Date().toISOString(),
    };
    await appendInterview(record);
    await updateApplicant(applicant_id, { status: "Interview" });
    json(res, 200, { ok: true, interview: record });
  } catch (err) {
    console.error("[recruiting/interviews/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

const INTERVIEW_RESULTS  = new Set(["Pending", "Pass", "Fail", "Hold"]);
const INTERVIEW_TYPES    = new Set(["Phone Screen", "Technical", "Final", "HR", "Other"]);
const OFFER_PAY_PERIODS  = new Set(["Hourly", "Salary", "Daily", "Weekly"]);

async function handleUpdateInterview(req, res, interviewId) {
  try {
    const body = await readBody(req);
    if (body.result !== undefined && !INTERVIEW_RESULTS.has(body.result)) {
      return json(res, 400, { ok: false, error: `Invalid result. Must be one of: ${[...INTERVIEW_RESULTS].join(", ")}` });
    }
    if (body.interview_type !== undefined && !INTERVIEW_TYPES.has(body.interview_type)) {
      return json(res, 400, { ok: false, error: `Invalid interview_type. Must be one of: ${[...INTERVIEW_TYPES].join(", ")}` });
    }
    if (body.skill_rating !== undefined) {
      const r = parseInt(body.skill_rating);
      if (isNaN(r) || r < 0 || r > 5) {
        return json(res, 400, { ok: false, error: "skill_rating must be a number 0–5" });
      }
    }
    if (body.interviewer_id !== undefined) {
      if (!String(body.interviewer_id).trim()) {
        return json(res, 400, { ok: false, error: "interviewer_id cannot be cleared once assigned." });
      }
      const employees = await readAllEmployees();
      if (!employees.find(e => e.staff_id === String(body.interviewer_id).trim())) {
        return json(res, 400, { ok: false, error: "interviewer_id does not match any employee record" });
      }
    }
    const updates = {};
    ["result", "skill_rating", "feedback", "scheduled_at", "interviewer_id", "interview_type"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    const ok = await updateInterview(interviewId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/interviews/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteInterview(req, res, interviewId) {
  try {
    const ok = await deleteInterview(interviewId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/interviews/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Job Offers ─────────────────────────────────────────────────────────────────

async function handleCreateOffer(req, res) {
  try {
    const body = await readBody(req);
    const { applicant_id, opening_id, pay_rate, pay_period, designation_id, department_id, start_date, notes } = body;
    if (!applicant_id || !pay_rate) {
      return json(res, 400, { ok: false, error: "applicant_id and pay_rate are required" });
    }
    const payRateNum = parseFloat(pay_rate);
    if (isNaN(payRateNum) || payRateNum <= 0) {
      return json(res, 400, { ok: false, error: "pay_rate must be a positive number" });
    }
    if (pay_period !== undefined && !OFFER_PAY_PERIODS.has(pay_period)) {
      return json(res, 400, { ok: false, error: `Invalid pay_period. Must be one of: ${[...OFFER_PAY_PERIODS].join(", ")}` });
    }
    const [applicants, depts, desigs] = await Promise.all([readAllApplicants(), readAllDepartments(), readAllDesignations()]);
    if (!applicants.find(a => a.applicant_id === applicant_id)) {
      return json(res, 404, { ok: false, error: "Applicant not found" });
    }
    if (department_id && !depts.find(d => d.dept_id === department_id)) {
      return json(res, 400, { ok: false, error: "department_id does not match any department" });
    }
    if (designation_id && !desigs.find(d => d.designation_id === designation_id)) {
      return json(res, 400, { ok: false, error: "designation_id does not match any designation" });
    }
    const record = {
      offer_id: crypto.randomUUID(),
      applicant_id: applicant_id.trim(),
      opening_id: opening_id || "",
      pay_rate: String(pay_rate),
      pay_period: pay_period || "Hourly",
      designation_id: designation_id || "",
      department_id: department_id || "",
      start_date: start_date || "",
      status: "Draft",
      offer_token: crypto.randomBytes(24).toString("hex"),
      notes: (notes || "").trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await appendOffer(record);
    await updateApplicant(applicant_id, { status: "Offer" });
    json(res, 200, { ok: true, offer: record });
  } catch (err) {
    console.error("[recruiting/offers/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateOffer(req, res, offerId) {
  try {
    const body = await readBody(req);
    if (body.status !== undefined && !OFFER_STATUSES.has(body.status)) {
      return json(res, 400, { ok: false, error: `Invalid status. Must be one of: ${[...OFFER_STATUSES].join(", ")}` });
    }
    if (body.pay_period !== undefined && !OFFER_PAY_PERIODS.has(body.pay_period)) {
      return json(res, 400, { ok: false, error: `Invalid pay_period. Must be one of: ${[...OFFER_PAY_PERIODS].join(", ")}` });
    }
    if (body.pay_rate !== undefined) {
      const rn = parseFloat(body.pay_rate);
      if (isNaN(rn) || rn <= 0) {
        return json(res, 400, { ok: false, error: "pay_rate must be a positive number" });
      }
    }
    const allOffers = await readAllOffers();
    const offer = allOffers.find(o => o.offer_id === offerId);
    if (!offer) return json(res, 404, { ok: false, error: "Offer not found" });

    // Enforce strict status transition rules
    const VALID_TRANSITIONS = { Draft: new Set(["Sent"]), Sent: new Set(["Accepted", "Declined"]) };
    if (body.status !== undefined && body.status !== offer.status) {
      const allowed = VALID_TRANSITIONS[offer.status];
      if (!allowed || !allowed.has(body.status)) {
        return json(res, 400, { ok: false, error: `Cannot transition offer from "${offer.status}" to "${body.status}". Valid transitions: Draft→Sent, Sent→Accepted or Declined.` });
      }
    }

    // Referential integrity for department / designation
    if (body.department_id || body.designation_id) {
      const [depts, desigs] = await Promise.all([readAllDepartments(), readAllDesignations()]);
      if (body.department_id && !depts.find(d => d.dept_id === body.department_id)) {
        return json(res, 400, { ok: false, error: "department_id does not match any department" });
      }
      if (body.designation_id && !desigs.find(d => d.designation_id === body.designation_id)) {
        return json(res, 400, { ok: false, error: "designation_id does not match any designation" });
      }
    }

    const updates = {};
    ["pay_rate", "pay_period", "designation_id", "department_id", "start_date", "status", "notes"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    updates.updated_at = new Date().toISOString();

    const ok = await updateOffer(offerId, updates);

    if (updates.status === "Accepted") {
      await updateApplicant(offer.applicant_id, { status: "Hired" });
    } else if (updates.status === "Declined") {
      await updateApplicant(offer.applicant_id, { status: "Rejected" });
    }

    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[recruiting/offers/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/offers/:id/send — mark as Sent
async function handleSendOffer(req, res, offerId) {
  try {
    const allOffers = await readAllOffers();
    const offer = allOffers.find(o => o.offer_id === offerId);
    if (!offer) return json(res, 404, { ok: false, error: "Offer not found" });
    if (offer.status === "Accepted" || offer.status === "Declined") {
      return json(res, 400, { ok: false, error: `Cannot send an offer that has already been ${offer.status.toLowerCase()}.` });
    }
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await updateOffer(offerId, { status: "Sent", updated_at: new Date().toISOString(), expires_at: newExpiry });
    const offerLink = `${process.env.PUBLIC_URL || ""}/offer/${offer.offer_token}`;
    json(res, 200, { ok: true, offer_link: offerLink, offer_token: offer.offer_token });
  } catch (err) {
    console.error("[recruiting/offers/send]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Public: view offer ─────────────────────────────────────────────────────────

async function handlePublicGetOffer(req, res, token) {
  try {
    const allOffers = await readAllOffers();
    const offer = allOffers.find(o => o.offer_token === token);
    if (!offer) return json(res, 404, { ok: false, error: "Offer not found or link is invalid" });
    if (offer.expires_at && new Date(offer.expires_at) < new Date() && offer.status === "Sent") {
      return json(res, 410, { ok: false, error: "This offer link has expired. Please contact the employer.", expired: true });
    }

    const applicants = await readAllApplicants();
    const applicant = applicants.find(a => a.applicant_id === offer.applicant_id) || {};
    const depts = await readAllDepartments();
    const desigs = await readAllDesignations();

    json(res, 200, {
      ok: true,
      offer: {
        ...offer,
        applicant_name: applicant.name || "",
        department_name: depts.find(d => d.dept_id === offer.department_id)?.name || "",
        designation_name: desigs.find(d => d.designation_id === offer.designation_id)?.name || "",
      },
    });
  } catch (err) {
    console.error("[careers/offer/view]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/public/offer/:token/respond — accept or decline from public link
async function handlePublicOfferRespond(req, res, token) {
  try {
    const { action } = await readBody(req);
    if (!["accept", "decline"].includes(action)) {
      return json(res, 400, { ok: false, error: "action must be 'accept' or 'decline'" });
    }
    const allOffers = await readAllOffers();
    const offer = allOffers.find(o => o.offer_token === token);
    if (!offer) return json(res, 404, { ok: false, error: "Offer not found" });
    if (offer.expires_at && new Date(offer.expires_at) < new Date() && offer.status === "Sent") {
      return json(res, 410, { ok: false, error: "This offer link has expired. Please contact the employer.", expired: true });
    }
    if (offer.status !== "Sent") {
      if (offer.status === "Accepted" || offer.status === "Declined") {
        return json(res, 400, { ok: false, error: "This offer has already been responded to" });
      }
      return json(res, 400, { ok: false, error: "This offer has not been sent yet" });
    }
    const newStatus = action === "accept" ? "Accepted" : "Declined";
    await updateOffer(offer.offer_id, { status: newStatus, updated_at: new Date().toISOString() });
    if (newStatus === "Accepted") {
      await updateApplicant(offer.applicant_id, { status: "Hired" });
    } else {
      await updateApplicant(offer.applicant_id, { status: "Rejected" });
    }
    json(res, 200, { ok: true, status: newStatus });
  } catch (err) {
    console.error("[careers/offer/respond]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Convert accepted offer to employee ────────────────────────────────────────

async function handleCreateEmployeeFromOffer(req, res, offerId) {
  try {
    const allOffers = await readAllOffers();
    const offer = allOffers.find(o => o.offer_id === offerId);
    if (!offer) return json(res, 404, { ok: false, error: "Offer not found" });
    if (offer.status !== "Accepted") {
      return json(res, 400, { ok: false, error: "Offer must be Accepted before creating an employee" });
    }

    const applicants = await readAllApplicants();
    const applicant = applicants.find(a => a.applicant_id === offer.applicant_id);
    if (!applicant) return json(res, 404, { ok: false, error: "Applicant not found" });

    // Admin-provided overrides from the confirmation modal take precedence
    const body = await readBody(req);
    const nameParts = applicant.name.trim().split(/\s+/);
    const first_name = body.first_name?.trim() || nameParts[0] || "";
    const last_name = body.last_name?.trim() || nameParts.slice(1).join(" ") || "";
    const phone = body.phone?.trim() || applicant.phone || "";
    const hire_date = body.hire_date || offer.start_date || new Date().toISOString().slice(0, 10);
    const department_id = body.department_id ?? offer.department_id ?? "";
    const designation_id = body.designation_id ?? offer.designation_id ?? "";

    if (!first_name) return json(res, 400, { ok: false, error: "first_name is required" });
    if (!last_name) return json(res, 400, { ok: false, error: "last_name is required" });

    // Validate department/designation referential integrity
    if (department_id || designation_id) {
      const [depts, desigs] = await Promise.all([readAllDepartments(), readAllDesignations()]);
      if (department_id && !depts.find(d => d.dept_id === department_id)) {
        return json(res, 400, { ok: false, error: "department_id does not match any department" });
      }
      if (designation_id && !desigs.find(d => d.designation_id === designation_id)) {
        return json(res, 400, { ok: false, error: "designation_id does not match any designation" });
      }
    }

    // Idempotency: block duplicate employee creation for the same offer
    if (offer.converted_staff_id) {
      return json(res, 400, {
        ok: false,
        error: "An employee has already been created from this offer",
        employee_url: `/people/employees/${offer.converted_staff_id}`,
      });
    }

    const staffId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      staff_id: staffId,
      first_name,
      last_name,
      phone,
      password_hash: "",
      status: "inactive",      // Crew app login account — pending setup/activation
      permissions: "",
      created_at: now,
      approved_at: "",
      notes: `Hired via recruiting pipeline. Applicant ID: ${applicant.applicant_id}`,
      username: "",
      role: "crew",
      hire_date,
      employment_status: "active", // HR employment status — person is actively employed
      department_id,
      designation_id,
      reports_to: "",
      personal_phone: phone,
      emergency_contact_name: "",
      emergency_contact_phone: "",
    };
    await appendEmployeeRow(record);
    await updateApplicant(offer.applicant_id, { status: "Hired" });
    await updateOffer(offerId, { converted_staff_id: staffId });

    json(res, 200, { ok: true, staff_id: staffId, employee_url: `/people/employees/${staffId}` });
  } catch (err) {
    console.error("[recruiting/create-employee]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleListJobOpenings,
  handleCreateJobOpening,
  handleUpdateJobOpening,
  handleDeleteJobOpening,
  handlePublicJobListings,
  handlePublicApply,
  handleListApplicants,
  handleGetApplicant,
  handleUpdateApplicant,
  handleDeleteApplicant,
  handleCreateInterview,
  handleUpdateInterview,
  handleDeleteInterview,
  handleCreateOffer,
  handleUpdateOffer,
  handleSendOffer,
  handlePublicGetOffer,
  handlePublicOfferRespond,
  handleCreateEmployeeFromOffer,
};
