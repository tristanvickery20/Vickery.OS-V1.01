// pages/js/people-applicants.js — Applicants list

let allApplicants = [];
let allOpenings = [];
let currentFunnelStatus = "";

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function fmtDate(d) {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

function badgeClass(status) {
  const map = {
    "New": "badge-new", "Screening": "badge-screening", "Interview": "badge-interview",
    "Offer": "badge-offer", "Hired": "badge-hired", "Rejected": "badge-rejected",
  };
  return map[status] || "badge-new";
}

async function loadAll() {
  const params = new URLSearchParams(window.location.search);
  const preFilterOpening = params.get("opening_id") || "";

  const [aRes, oRes] = await Promise.all([
    fetch("/api/hr/applicants"),
    fetch("/api/hr/job-openings"),
  ]);
  const [aData, oData] = await Promise.all([aRes.json(), oRes.json()]);
  allApplicants = aData.applicants || [];
  allOpenings = oData.openings || [];

  // Populate opening filter
  const openingFilter = document.getElementById("openingFilter");
  openingFilter.innerHTML = '<option value="">All Openings</option>' +
    allOpenings.map(o => `<option value="${esc(o.opening_id)}">${esc(o.title)}</option>`).join("");
  if (preFilterOpening) openingFilter.value = preFilterOpening;

  applyFilter();
}

function setFunnel(el, status) {
  currentFunnelStatus = status;
  document.querySelectorAll(".funnel-chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  applyFilter();
}

function applyFilter() {
  const search = (document.getElementById("searchInput").value || "").toLowerCase();
  const openingId = document.getElementById("openingFilter").value;

  let filtered = allApplicants.filter(a => {
    if (currentFunnelStatus && a.status !== currentFunnelStatus) return false;
    if (openingId && a.opening_id !== openingId) return false;
    if (search) {
      const hay = `${a.name} ${a.email} ${a.phone}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderTable(filtered);
}

function renderTable(applicants) {
  const tbody = document.getElementById("applicantsTbody");
  const empty = document.getElementById("emptyState");
  if (!applicants.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  tbody.innerHTML = applicants.map(a => `
    <tr>
      <td><a href="/people/applicants/${esc(a.applicant_id)}">${esc(a.name)}</a>
          <div style="font-size:12px;color:var(--muted)">${esc(a.email)}</div></td>
      <td>${esc(a.opening_title || "—")}</td>
      <td>${esc(a.source || "—")}</td>
      <td><span class="badge ${badgeClass(a.status)}">${esc(a.status)}</span></td>
      <td>${fmtDate(a.applied_at)}</td>
    </tr>
  `).join("");
}

loadAll();
