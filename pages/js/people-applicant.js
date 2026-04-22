// pages/js/people-applicant.js — Applicant profile / detail page

const applicantId = window.location.pathname.split("/people/applicants/")[1]?.split("?")[0] || "";
let applicantData = null;
let interviewsData = [];
let offersData = [];
let employees = [];
let departments = [];
let designations = [];
let interviewRating = 0;

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function fmtDt(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return d; }
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}
function badgeClass(status) {
  const map = {
    "New": "badge-new", "Screening": "badge-screening", "Interview": "badge-interview",
    "Offer": "badge-offer", "Hired": "badge-hired", "Rejected": "badge-rejected",
  };
  return map[status] || "badge-new";
}
function resultClass(r) {
  if (r === "Pass") return "result-pass";
  if (r === "Fail") return "result-fail";
  if (r === "Hold") return "result-hold";
  return "result-pending";
}
function offerStatusClass(s) {
  const m = { Draft: "offer-status-draft", Sent: "offer-status-sent", Accepted: "offer-status-accepted", Declined: "offer-status-declined" };
  return m[s] || "";
}

async function loadPage() {
  if (!applicantId) return;

  const [aRes, empRes, dRes, desRes] = await Promise.all([
    fetch(`/api/hr/applicants/${applicantId}`),
    fetch("/api/hr/employees"),
    fetch("/api/hr/departments"),
    fetch("/api/hr/designations"),
  ]);
  const [aData, empData, dData, desData] = await Promise.all([aRes.json(), empRes.json(), dRes.json(), desRes.json()]);

  if (!aData.ok) { document.getElementById("pageTitle").textContent = "Applicant not found"; return; }

  applicantData = aData.applicant;
  interviewsData = aData.interviews || [];
  offersData = aData.offers || [];
  employees = empData.employees || [];
  departments = dData.departments || [];
  designations = desData.designations || [];

  renderProfile();
  renderInterviews();
  renderOffers();
  populateInterviewerSelect();
  populateDeptDesigSelects();
}

function renderProfile() {
  const a = applicantData;
  document.getElementById("pageTitle").textContent = a.name || "Applicant";

  const badge = document.getElementById("statusBadge");
  badge.textContent = a.status;
  badge.className = `badge ${badgeClass(a.status)}`;

  document.getElementById("statusSelect").value = a.status;
  document.getElementById("notesArea").value = a.notes || "";

  const opening = a.opening_title;
  document.getElementById("profileInfo").innerHTML = `
    <div class="info-row"><div class="info-label">Opening</div><div class="info-val">${esc(opening || "—")}</div></div>
    <div class="info-row"><div class="info-label">Email</div><div class="info-val"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></div></div>
    <div class="info-row"><div class="info-label">Phone</div><div class="info-val">${a.phone ? `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : "—"}</div></div>
    <div class="info-row"><div class="info-label">Source</div><div class="info-val">${esc(a.source || "—")}</div></div>
    <div class="info-row"><div class="info-label">Applied</div><div class="info-val">${fmtDate(a.applied_at)}</div></div>
    ${a.resume_url ? `<div class="info-row"><div class="info-label">Resume</div><div class="info-val"><a href="${esc(a.resume_url)}" target="_blank">Download Resume</a></div></div>` : ""}
  `;

  // Header actions
  const ha = document.getElementById("headerActions");
  const accepted = offersData.find(o => o.status === "Accepted");
  ha.innerHTML = accepted
    ? `<button class="btn-success" onclick="createEmployee('${esc(accepted.offer_id)}')">🎉 Create Employee</button>`
    : "";
}

function renderInterviews() {
  const container = document.getElementById("interviewsList");
  if (!interviewsData.length) {
    container.innerHTML = '<p class="empty-note">No interviews scheduled yet.</p>';
    return;
  }
  container.innerHTML = interviewsData.map(i => `
    <div class="interview-item">
      <div class="interview-header">
        <div class="interview-type">${esc(i.interview_type)}</div>
        <span class="result-badge ${resultClass(i.result)}">${esc(i.result)}</span>
      </div>
      <div class="interview-meta">
        📅 ${fmtDt(i.scheduled_at)}
        ${i.interviewer_name ? ` &nbsp;·&nbsp; 👤 ${esc(i.interviewer_name)}` : ""}
        ${i.skill_rating && i.skill_rating !== "0" ? ` &nbsp;·&nbsp; ${"★".repeat(parseInt(i.skill_rating))}${"☆".repeat(5-parseInt(i.skill_rating))}` : ""}
      </div>
      ${i.feedback ? `<div class="interview-feedback">${esc(i.feedback)}</div>` : ""}
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn-icon" style="font-size:12px;padding:5px 12px" onclick="openEditInterviewModal('${esc(i.interview_id)}')">Edit Feedback</button>
        <button class="btn-danger" style="font-size:12px;padding:5px 12px" onclick="deleteInterview('${esc(i.interview_id)}')">Delete</button>
      </div>
    </div>
  `).join("");
}

function renderOffers() {
  const container = document.getElementById("offersList");
  if (!offersData.length) {
    container.innerHTML = '<p class="empty-note">No offers created yet.</p>';
    return;
  }
  container.innerHTML = offersData.map(o => {
    const rate = parseFloat(o.pay_rate) || 0;
    const periodLabels = { Salary: "year", Hourly: "hr", Daily: "day", Weekly: "week" };
    const payStr = `$${rate.toLocaleString(undefined, { minimumFractionDigits: o.pay_period === "Salary" ? 0 : 2, maximumFractionDigits: 2 })} / ${periodLabels[o.pay_period] || "hr"}`;
    const offerLink = `${window.location.origin}/offer/${o.offer_token}`;
    const isExpired = o.expires_at && new Date(o.expires_at) < new Date() && o.status === "Sent";
    const canAcceptDecline = o.status === "Sent" && !isExpired;
    const expiryStr = o.expires_at ? new Date(o.expires_at).toLocaleDateString() : null;
    return `
      <div class="offer-item">
        <div class="offer-header">
          <div style="font-size:14px;font-weight:700">${esc(payStr)}</div>
          <span class="badge result-badge ${offerStatusClass(o.status)}">${esc(o.status)}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
          ${o.designation_name ? `👤 ${esc(o.designation_name)}` : ""}
          ${o.department_name ? ` &nbsp;·&nbsp; 🏢 ${esc(o.department_name)}` : ""}
          ${o.start_date ? ` &nbsp;·&nbsp; 📅 ${fmtDate(o.start_date)}` : ""}
        </div>
        ${o.notes ? `<div style="font-size:13px;color:var(--muted);margin-bottom:8px">${esc(o.notes)}</div>` : ""}
        ${["Sent", "Accepted", "Declined"].includes(o.status) ? `
        <div class="offer-link-row">
          <div class="offer-link-url">${esc(offerLink)}</div>
          <button class="copy-btn" onclick="copyLink('${esc(offerLink)}')">Copy Link</button>
        </div>` : ""}
        ${expiryStr ? `<div style="font-size:12px;color:${isExpired ? "hsl(0 60% 60%)" : "var(--muted)"};margin-top:4px">${isExpired ? "⚠ Link expired " : "Link expires "} ${esc(expiryStr)}</div>` : ""}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          ${o.status === "Draft" ? `<button class="btn-secondary" style="font-size:12px;padding:6px 14px" onclick="sendOffer('${esc(o.offer_id)}')">Mark as Sent</button>` : ""}
          ${canAcceptDecline ? `
            <button class="btn-success" style="font-size:12px;padding:6px 14px" onclick="respondOffer('${esc(o.offer_id)}', 'Accepted')">Accept</button>
            <button class="btn-danger" style="font-size:12px;padding:6px 14px" onclick="respondOffer('${esc(o.offer_id)}', 'Declined')">Decline</button>
          ` : ""}
          ${o.status === "Accepted" ? `<button class="btn-success" style="font-size:12px;padding:6px 14px" onclick="createEmployee('${esc(o.offer_id)}')">🎉 Create Employee</button>` : ""}
        </div>
      </div>`;
  }).join("");
}

// ── Status & Notes ─────────────────────────────────────────────────────────────

async function updateStatus() {
  const status = document.getElementById("statusSelect").value;
  await fetch(`/api/hr/applicants/${applicantId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const badge = document.getElementById("statusBadge");
  badge.textContent = status;
  badge.className = `badge ${badgeClass(status)}`;
  if (applicantData) applicantData.status = status;
}

async function saveNotes() {
  const notes = document.getElementById("notesArea").value;
  await fetch(`/api/hr/applicants/${applicantId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

// ── Interview Modal ────────────────────────────────────────────────────────────

function populateInterviewerSelect() {
  const sel = document.getElementById("iInterviewer");
  sel.innerHTML = '<option value="" disabled selected>— Select interviewer (required) —</option>' +
    employees.map(e => `<option value="${esc(e.staff_id)}">${esc(e.first_name)} ${esc(e.last_name)}</option>`).join("");
}

function setRating(val) {
  interviewRating = val;
  document.getElementById("iRating").value = val;
  document.querySelectorAll(".rating-star").forEach(s => {
    s.classList.toggle("active", parseInt(s.dataset.val) <= val);
  });
}

function openInterviewModal() {
  document.getElementById("editInterviewId").value = "";
  document.getElementById("interviewModalTitle").textContent = "Schedule Interview";
  document.getElementById("iType").value = "Phone Screen";
  document.getElementById("iInterviewer").value = "";
  const now = new Date(); now.setMinutes(0, 0, 0);
  document.getElementById("iScheduledAt").value = now.toISOString().slice(0, 16);
  document.getElementById("iResult").value = "Pending";
  setRating(0);
  document.getElementById("iFeedback").value = "";
  document.getElementById("interviewModal").classList.add("open");
}

function openEditInterviewModal(interviewId) {
  const i = interviewsData.find(x => x.interview_id === interviewId);
  if (!i) return;
  document.getElementById("editInterviewId").value = i.interview_id;
  document.getElementById("interviewModalTitle").textContent = "Edit Interview Feedback";
  document.getElementById("iType").value = i.interview_type || "Phone Screen";
  document.getElementById("iInterviewer").value = i.interviewer_id || "";
  document.getElementById("iScheduledAt").value = i.scheduled_at ? i.scheduled_at.slice(0, 16) : "";
  document.getElementById("iResult").value = i.result || "Pending";
  setRating(parseInt(i.skill_rating) || 0);
  document.getElementById("iFeedback").value = i.feedback || "";
  document.getElementById("interviewModal").classList.add("open");
}

function closeInterviewModal() {
  document.getElementById("interviewModal").classList.remove("open");
}

async function saveInterview() {
  const editId = document.getElementById("editInterviewId").value;
  const interviewer_id = document.getElementById("iInterviewer").value;
  if (!editId && !interviewer_id) {
    alert("Please select an interviewer before scheduling the interview.");
    return;
  }
  const body = {
    applicant_id: applicantId,
    interview_type: document.getElementById("iType").value,
    interviewer_id,
    scheduled_at: document.getElementById("iScheduledAt").value,
    result: document.getElementById("iResult").value,
    skill_rating: String(interviewRating),
    feedback: document.getElementById("iFeedback").value,
  };
  const url = editId ? `/api/hr/interviews/${editId}` : "/api/hr/interviews";
  const method = editId ? "PATCH" : "POST";
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { closeInterviewModal(); loadPage(); }
  else alert(d.error || "Save failed");
}

async function deleteInterview(interviewId) {
  if (!confirm("Delete this interview record?")) return;
  const r = await fetch(`/api/hr/interviews/${interviewId}`, { method: "DELETE" });
  const d = await r.json();
  if (d.ok) loadPage();
  else alert(d.error || "Delete failed");
}

// ── Offer Modal ────────────────────────────────────────────────────────────────

function populateDeptDesigSelects() {
  const dOpt = '<option value="">— None —</option>' + departments.map(d =>
    `<option value="${esc(d.dept_id)}">${esc(d.name)}</option>`).join("");
  const desOpt = '<option value="">— None —</option>' + designations.map(d =>
    `<option value="${esc(d.designation_id)}">${esc(d.name)}</option>`).join("");
  document.getElementById("oDept").innerHTML = dOpt;
  document.getElementById("oDesig").innerHTML = desOpt;

  // Pre-fill from applicant's opening if available
  if (applicantData && allOpenings) {
    const o = allOpenings.find(x => x.opening_id === applicantData.opening_id);
    if (o) {
      document.getElementById("oDept").value = o.department_id || "";
      document.getElementById("oDesig").value = o.designation_id || "";
    }
  }
}

let allOpenings = [];
async function loadOpenings() {
  const r = await fetch("/api/hr/job-openings");
  const d = await r.json();
  allOpenings = d.openings || [];
}

function openOfferModal() {
  document.getElementById("oPay").value = "";
  document.getElementById("oPayPeriod").value = "Hourly";
  document.getElementById("oStartDate").value = "";
  document.getElementById("oNotes").value = "";
  if (applicantData) {
    const o = allOpenings.find(x => x.opening_id === applicantData.opening_id);
    if (o) {
      document.getElementById("oDept").value = o.department_id || "";
      document.getElementById("oDesig").value = o.designation_id || "";
    }
  }
  document.getElementById("offerModal").classList.add("open");
}

function closeOfferModal() {
  document.getElementById("offerModal").classList.remove("open");
}

async function saveOffer() {
  const pay = document.getElementById("oPay").value;
  if (!pay) { alert("Pay rate is required."); return; }
  const body = {
    applicant_id: applicantId,
    opening_id: applicantData?.opening_id || "",
    pay_rate: pay,
    pay_period: document.getElementById("oPayPeriod").value,
    department_id: document.getElementById("oDept").value,
    designation_id: document.getElementById("oDesig").value,
    start_date: document.getElementById("oStartDate").value,
    notes: document.getElementById("oNotes").value,
  };
  const r = await fetch("/api/hr/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { closeOfferModal(); loadPage(); }
  else alert(d.error || "Create offer failed");
}

async function sendOffer(offerId) {
  const r = await fetch(`/api/hr/offers/${offerId}/send`, { method: "POST" });
  const d = await r.json();
  if (d.ok) {
    const absoluteLink = d.offer_token
      ? `${window.location.origin}/offer/${d.offer_token}`
      : (d.offer_link || "");
    alert(`Offer marked as Sent.\n\nShare this link with the applicant:\n${absoluteLink}`);
    loadPage();
  } else alert(d.error || "Failed");
}

async function respondOffer(offerId, status) {
  const label = status === "Accepted" ? "accept" : "decline";
  if (!confirm(`Mark this offer as ${status}?`)) return;
  const r = await fetch(`/api/hr/offers/${offerId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const d = await r.json();
  if (d.ok) loadPage();
  else alert(d.error || "Failed");
}

function openCreateEmpModal(offerId) {
  const offer = offersData.find(o => o.offer_id === offerId);
  if (!offer) return;

  const nameParts = (applicantData?.name || "").trim().split(/\s+/);
  const first = nameParts[0] || "";
  const last = nameParts.slice(1).join(" ") || "";

  document.getElementById("createEmpOfferId").value = offerId;
  document.getElementById("ceFirst").value = first;
  document.getElementById("ceLast").value = last;
  document.getElementById("cePhone").value = applicantData?.phone || "";
  document.getElementById("ceHireDate").value = offer.start_date || new Date().toISOString().slice(0, 10);

  const dOpt = '<option value="">— None —</option>' + departments.map(d =>
    `<option value="${esc(d.dept_id)}">${esc(d.name)}</option>`).join("");
  const desOpt = '<option value="">— None —</option>' + designations.map(d =>
    `<option value="${esc(d.designation_id)}">${esc(d.name)}</option>`).join("");
  document.getElementById("ceDept").innerHTML = dOpt;
  document.getElementById("ceDesig").innerHTML = desOpt;
  document.getElementById("ceDept").value = offer.department_id || "";
  document.getElementById("ceDesig").value = offer.designation_id || "";

  document.getElementById("createEmpModal").classList.add("open");
}

function closeCreateEmpModal() {
  document.getElementById("createEmpModal").classList.remove("open");
}

async function confirmCreateEmployee() {
  const offerId = document.getElementById("createEmpOfferId").value;
  const overrides = {
    first_name: document.getElementById("ceFirst").value.trim(),
    last_name: document.getElementById("ceLast").value.trim(),
    phone: document.getElementById("cePhone").value.trim(),
    hire_date: document.getElementById("ceHireDate").value,
    department_id: document.getElementById("ceDept").value,
    designation_id: document.getElementById("ceDesig").value,
  };
  if (!overrides.first_name || !overrides.last_name) {
    alert("First and last name are required.");
    return;
  }
  const r = await fetch(`/api/hr/offers/${offerId}/create-employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
  const d = await r.json();
  if (d.ok) {
    closeCreateEmpModal();
    if (confirm(`Employee created successfully!\n\nWould you like to open their profile now?`)) {
      window.location.href = d.employee_url;
    } else {
      loadPage();
    }
  } else if (d.employee_url) {
    closeCreateEmpModal();
    if (confirm(`${d.error}\n\nWould you like to open their existing profile?`)) {
      window.location.href = d.employee_url;
    }
  } else alert(d.error || "Failed to create employee");
}

function createEmployee(offerId) {
  openCreateEmpModal(offerId);
}

function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => alert("Link copied to clipboard!")).catch(() => alert(url));
}

document.getElementById("interviewModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeInterviewModal();
});
document.getElementById("offerModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeOfferModal();
});
document.getElementById("createEmpModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeCreateEmpModal();
});

loadOpenings().catch(() => {}).then(loadPage);
