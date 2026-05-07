(function () {
  var runs = [];
  var departments = [];
  var employees = [];
  var assignments = [];
  var structures = [];
  var components = [];
  var claims = [];
  var corrections = [];
  var settings = null;
  var availability = {};
  var selectedRunId = "";
  var selectedPreview = null;

  function qs(id) { return document.getElementById(id); }
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function dollars(n) { return "$" + (Number(n) || 0).toFixed(2); }
  function num(n) { return Number(n) || 0; }
  function fmtDate(d) {
    if (!d) return "—";
    var raw = String(d).slice(0, 10);
    var parsed = new Date(raw + "T00:00:00");
    if (Number.isNaN(parsed.getTime())) return esc(raw);
    return parsed.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
  }
  function inPeriod(dateValue, run) {
    var d = String(dateValue || "").slice(0, 10);
    return d && run && d >= run.pay_period_start && d <= run.pay_period_end;
  }
  function isActiveEmp(emp) {
    var s = norm(emp.employment_status || emp.status);
    return s !== "terminated" && s !== "inactive";
  }
  function deptName(id) {
    if (!id) return "All departments";
    var d = departments.find(function (x) { return x.dept_id === id; });
    return d ? d.name : id;
  }
  function employeeName(staffId) {
    var e = employees.find(function (x) { return x.staff_id === staffId; });
    if (!e) return staffId || "—";
    return ([e.first_name, e.last_name].filter(Boolean).join(" ") || e.username || staffId);
  }
  function structureName(id) {
    var s = structures.find(function (x) { return x.structure_id === id; });
    return s ? s.name : (id || "—");
  }
  function latestAssignment(staffId, asOfDate) {
    if (!availability.assignments) return null;
    var list = assignments.filter(function (a) {
      return a.staff_id === staffId && (!asOfDate || String(a.effective_date || "") <= asOfDate);
    });
    list.sort(function (a, b) { return String(b.effective_date || "").localeCompare(String(a.effective_date || "")); });
    return list[0] || null;
  }

  function toast(msg, err) {
    var t = qs("toast");
    t.textContent = msg;
    t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  function getJSON(url, fallback) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function () { return fallback || { ok:false }; });
  }

  async function tryEndpoints(endpoints, options) {
    var last = null;
    for (var i = 0; i < endpoints.length; i++) {
      try {
        var resp = await fetch(endpoints[i], options || { cache:"no-store" });
        var data = await resp.json();
        if (resp.ok && data.ok) return data;
        last = data;
      } catch (err) {
        last = { ok:false, error:err.message };
      }
    }
    return last || { ok:false, error:"Endpoint unavailable" };
  }

  function badge(status) {
    var s = norm(status || "draft");
    if (s === "finalized" || s === "completed" || s === "complete") return '<span class="badge badge-finalized">Finalized</span>';
    return '<span class="badge badge-draft">Draft</span>';
  }

  function warning(severity, title, count, reason) {
    return '<div class="warning-item">' +
      '<div class="dot ' + esc(severity || "info") + '"></div>' +
      '<div><div class="warning-title">' + esc(title) + '</div><div class="warning-reason">' + esc(reason) + '</div></div>' +
      '<div class="warning-count">' + (count === null || count === undefined ? '&mdash;' : esc(count)) + '</div>' +
    '</div>';
  }

  function activeEmployeesForRun(run) {
    if (!availability.employees) return [];
    return employees.filter(function (e) {
      if (!isActiveEmp(e)) return false;
      if (run && run.department_id && e.department_id !== run.department_id) return false;
      return true;
    });
  }

  function missingAssignmentsForRun(run) {
    if (!availability.employees || !availability.assignments) return null;
    return activeEmployeesForRun(run).filter(function (e) { return !latestAssignment(e.staff_id, run ? run.pay_period_end : ""); });
  }

  function approvedClaimsInPeriod(run) {
    if (!availability.claims) return [];
    return claims.filter(function (c) { return norm(c.status) === "approved" && inPeriod(c.claim_date || c.submitted_at || c.created_at, run); });
  }

  function submittedClaimsInPeriod(run) {
    if (!availability.claims) return [];
    return claims.filter(function (c) { return norm(c.status) === "submitted" && inPeriod(c.claim_date || c.submitted_at || c.created_at, run); });
  }

  function missingReceiptClaims(run) {
    if (!availability.claims) return [];
    return claims.filter(function (c) {
      if (!["submitted", "approved"].includes(norm(c.status))) return false;
      if (!inPeriod(c.claim_date || c.submitted_at || c.created_at, run)) return false;
      var items = asArray(c.items);
      return items.some(function (i) { return !String(i.receipt_url || "").trim(); });
    });
  }

  function correctionsInPeriod(run) {
    if (!availability.corrections) return [];
    return corrections.filter(function (c) { return norm(c.status) === "pending" && inPeriod(c.date || c.created_at, run); });
  }

  function summarizePreview(preview) {
    var rows = asArray(preview && preview.previews);
    return rows.reduce(function (acc, p) {
      acc.staff += 1;
      acc.base += num(p.base_amount);
      acc.gross += num(p.gross_earnings);
      acc.deductions += num(p.total_deductions);
      acc.net += num(p.net_pay);
      acc.workingDays += num(p.working_days);
      return acc;
    }, { staff:0, base:0, gross:0, deductions:0, net:0, workingDays:0 });
  }

  function runReadiness(run, preview) {
    var issues = [];
    var missingAssignments = missingAssignmentsForRun(run);
    if (!availability.components) issues.push({ sev:"info", title:"Pay components unavailable", count:null, reason:"Pay component data could not be loaded, so component setup cannot be confirmed." });
    else if (!components.length) issues.push({ sev:"critical", title:"No pay components configured", count:0, reason:"Payroll structures need earning/deduction components before pay can be reviewed." });

    if (!availability.structures) issues.push({ sev:"info", title:"Pay structures unavailable", count:null, reason:"Salary/pay structure data could not be loaded." });
    else if (!structures.length) issues.push({ sev:"critical", title:"No pay structures configured", count:0, reason:"Active employees need a pay structure before payroll can be reviewed." });

    if (!availability.settings) issues.push({ sev:"info", title:"Payroll settings unavailable", count:null, reason:"Payroll settings could not be loaded. Working-day source and pay-period rules cannot be confirmed." });

    if (missingAssignments === null) issues.push({ sev:"info", title:"Pay assignment check limited", count:null, reason:"Employee or assignment data could not be loaded." });
    else if (missingAssignments.length) issues.push({ sev:"critical", title:"Active staff missing pay assignment", count:missingAssignments.length, reason:"Payroll previews only include staff with an active salary/pay assignment as of the period end date." });

    var submitted = submittedClaimsInPeriod(run);
    if (!availability.claims) issues.push({ sev:"info", title:"Expense claim check limited", count:null, reason:"Expense claim data could not be loaded." });
    else if (submitted.length) issues.push({ sev:"warning", title:"Submitted claims need review", count:submitted.length, reason:"Submitted claims should be approved or rejected before payroll is finalized." });

    var approved = approvedClaimsInPeriod(run);
    if (availability.claims && approved.length) issues.push({ sev:"warning", title:"Approved claims may need reimbursement", count:approved.length, reason:"Approved unpaid claims in this period may need to be handled as reimbursement or marked paid before payroll closeout." });

    var missingReceipts = missingReceiptClaims(run);
    if (availability.claims && missingReceipts.length) issues.push({ sev:"warning", title:"Claims missing receipts", count:missingReceipts.length, reason:"Claims with missing receipts should be reviewed before payroll reimbursement." });

    var correctionRows = correctionsInPeriod(run);
    if (!availability.corrections) issues.push({ sev:"info", title:"Attendance correction check limited", count:null, reason:"Attendance correction data could not be loaded." });
    else if (correctionRows.length) issues.push({ sev:"warning", title:"Attendance corrections pending", count:correctionRows.length, reason:"Pending corrections should be resolved before payroll review/finalization." });

    if (!preview || !preview.ok) issues.push({ sev:"info", title:"Payroll preview unavailable", count:null, reason:"The preview endpoint did not return calculated payroll rows. Use setup checks and try again after fixing data." });
    else if (asArray(preview.previews).length === 0) issues.push({ sev:"critical", title:"No employees included in preview", count:0, reason:"No staff with valid active pay assignments were included for this run." });

    return issues;
  }

  function renderReadiness() {
    var activeStaff = availability.employees ? employees.filter(isActiveEmp) : [];
    var unassigned = availability.employees && availability.assignments
      ? activeStaff.filter(function (e) { return !latestAssignment(e.staff_id, new Date().toISOString().slice(0, 10)); })
      : null;
    var draftRuns = availability.runs ? runs.filter(function (r) { return norm(r.status) !== "finalized"; }) : null;
    var submitted = availability.claims ? claims.filter(function (c) { return norm(c.status) === "submitted"; }) : null;
    var approved = availability.claims ? claims.filter(function (c) { return norm(c.status) === "approved"; }) : null;
    var pendingCorrections = availability.corrections ? corrections.filter(function (c) { return norm(c.status) === "pending"; }) : null;
    var setupGaps = 0;
    if (availability.components && !components.length) setupGaps++;
    if (availability.structures && !structures.length) setupGaps++;
    if (!availability.settings) setupGaps++;
    if (!availability.assignments) setupGaps++;

    qs("readinessGrid").innerHTML = [
      { label:"Active staff", value:availability.employees ? activeStaff.length : "—", note:availability.employees ? "Staff eligible for pay assignment review" : "Employee data unavailable" },
      { label:"Missing assignments", value:unassigned === null ? "—" : unassigned.length, note:unassigned === null ? "Assignment check limited" : "Active staff without current pay assignment" },
      { label:"Draft runs", value:draftRuns === null ? "—" : draftRuns.length, note:draftRuns === null ? "Payroll runs unavailable" : "Runs needing internal review/finalization" },
      { label:"Submitted claims", value:submitted === null ? "—" : submitted.length, note:submitted === null ? "Claim data unavailable" : "Need approve/reject before payroll close" },
      { label:"Approved claims", value:approved === null ? "—" : approved.length, note:approved === null ? "Claim data unavailable" : "May need reimbursement or paid status" },
      { label:"Attendance corrections", value:pendingCorrections === null ? "—" : pendingCorrections.length, note:pendingCorrections === null ? "Correction data unavailable" : "Pending corrections before payroll" },
      { label:"Setup gaps", value:setupGaps, note:setupGaps ? "Review settings/components/structures/assignments" : "Core payroll setup loaded" },
      { label:"External filing", value:"Not connected", note:"Use this as internal review/export only" },
    ].map(function (k) {
      return '<div class="mini-stat"><div class="mini-label">' + esc(k.label) + '</div><div class="mini-value">' + esc(k.value) + '</div><div class="mini-note">' + esc(k.note) + '</div></div>';
    }).join("");
  }

  function renderRuns() {
    var el = qs("runsList");
    if (!availability.runs) {
      el.innerHTML = '<div class="empty"><strong>Payroll runs unavailable</strong>Could not load /api/hr/payroll/runs.</div>';
      return;
    }
    if (!runs.length) {
      el.innerHTML = '<div class="empty"><strong>No payroll runs yet</strong>Create a draft run to review internal payroll. External filing and direct deposit are not connected.</div>';
      return;
    }
    el.innerHTML = runs.map(function (r) {
      var active = r.run_id === selectedRunId ? " active" : "";
      var action = norm(r.status) === "finalized"
        ? "Finalized internal summary. Review slips/export report if needed."
        : "Draft — review hours, pay setup, claims, deductions, and net pay before approval.";
      var previewStats = (selectedPreview && selectedPreview.run && selectedPreview.run.run_id === r.run_id) ? summarizePreview(selectedPreview) : null;
      return '<div class="run-card' + active + '" data-run-id="' + esc(r.run_id) + '">' +
        '<div class="run-top"><div><div class="run-period">' + fmtDate(r.pay_period_start) + ' – ' + fmtDate(r.pay_period_end) + ' ' + badge(r.status) + '</div>' +
        '<div class="run-meta">' + esc(deptName(r.department_id)) + ' · Created ' + fmtDate(r.created_at) + (r.finalized_at ? ' · Finalized ' + fmtDate(r.finalized_at) : '') + '</div>' +
        '<div class="run-meta">Owner action: ' + esc(action) + '</div></div>' +
        '<div class="run-actions"><button class="btn-sm" data-action="review" data-id="' + esc(r.run_id) + '">Review</button></div></div>' +
        '<div class="run-stats">' +
          '<div class="run-stat"><span>Staff</span><strong>' + (previewStats ? esc(previewStats.staff) : 'Preview') + '</strong></div>' +
          '<div class="run-stat"><span>Gross</span><strong>' + (previewStats ? dollars(previewStats.gross) : 'Select') + '</strong></div>' +
          '<div class="run-stat"><span>Deductions</span><strong>' + (previewStats ? dollars(previewStats.deductions) : 'Select') + '</strong></div>' +
          '<div class="run-stat"><span>Net pay</span><strong>' + (previewStats ? dollars(previewStats.net) : 'Select') + '</strong></div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function renderReviewLoading(run) {
    qs("reviewPanel").innerHTML = '<div class="review-head"><div><div class="panel-title">Payroll Run Review</div><div class="panel-sub">Loading preview for ' + esc(fmtDate(run.pay_period_start)) + ' – ' + esc(fmtDate(run.pay_period_end)) + '.</div></div></div><div class="empty"><strong>Loading payroll preview…</strong></div>';
  }

  function renderReview(run, previewData) {
    selectedPreview = previewData && previewData.ok ? previewData : null;
    var preview = selectedPreview || { ok:false, previews:[], additions:[], settings:null };
    var stats = summarizePreview(preview);
    var issues = runReadiness(run, previewData);
    var critical = issues.filter(function (i) { return i.sev === "critical"; }).length;
    var warningCount = issues.filter(function (i) { return i.sev === "warning"; }).length;
    var finalized = norm(run.status) === "finalized";
    var canFinalize = !finalized && preview.ok && stats.staff > 0 && critical === 0;
    var rows = asArray(preview.previews);

    var issueHtml = issues.length
      ? '<div class="warning-list">' + issues.map(function (i) { return warning(i.sev, i.title, i.count, i.reason); }).join("") + '</div>'
      : '<div class="warning-list">' + warning("info", "No active payroll blockers found", 0, "Based on available data, this run has no active payroll readiness blockers. Still review manually before external payroll entry.") + '</div>';

    var tableHtml = rows.length
      ? '<div class="review-table-wrap"><table><thead><tr><th>Employee</th><th>Assignment</th><th>Working days</th><th>Base</th><th>Gross</th><th>Deductions</th><th>Net pay</th></tr></thead><tbody>' +
        rows.map(function (p) {
          var assignment = latestAssignment(p.staff_id, run.pay_period_end);
          var assignText = assignment ? structureName(assignment.structure_id) + '<div class="run-meta">' + dollars(assignment.base_amount) + ' · effective ' + esc(assignment.effective_date || '—') + '</div>' : '<span class="badge badge-critical">Missing</span>';
          return '<tr><td><strong>' + esc(p.name || employeeName(p.staff_id)) + '</strong><div class="run-meta">' + esc(p.staff_id) + '</div></td>' +
            '<td>' + assignText + '</td>' +
            '<td>' + esc(p.working_days || '0') + ' / ' + esc(p.payable_workdays || p.total_days || '—') + '</td>' +
            '<td>' + dollars(p.base_amount) + '</td>' +
            '<td>' + dollars(p.gross_earnings) + '</td>' +
            '<td>' + dollars(p.total_deductions) + '</td>' +
            '<td><strong>' + dollars(p.net_pay) + '</strong></td></tr>';
        }).join("") + '</tbody></table></div>'
      : '<div class="empty"><strong>No preview rows available</strong>Fix pay assignments/setup or check the payroll preview endpoint.</div>';

    var approved = approvedClaimsInPeriod(run);
    var submitted = submittedClaimsInPeriod(run);
    var correctionsRows = correctionsInPeriod(run);
    var claimsNote = availability.claims
      ? submitted.length + ' submitted claim(s), ' + approved.length + ' approved unpaid claim(s) in this pay period.'
      : 'Expense claim data unavailable.';
    var attendanceNote = availability.corrections
      ? correctionsRows.length + ' pending attendance correction(s) in this pay period.'
      : 'Attendance correction data unavailable.';

    qs("reviewPanel").innerHTML = '<div class="review-head"><div><div class="panel-title">Payroll Run Review</div>' +
      '<div class="panel-sub">' + fmtDate(run.pay_period_start) + ' – ' + fmtDate(run.pay_period_end) + ' · ' + esc(deptName(run.department_id)) + ' · ' + (finalized ? 'Finalized internal summary' : 'Draft internal review') + '</div></div>' +
      '<div class="review-actions">' +
        '<button class="btn-sm" id="printReportBtn">Print / Save Internal Report</button>' +
        (finalized ? '' : '<button class="btn-sm" id="refreshPreviewBtn">Refresh Preview</button>') +
        '<button class="btn-primary" id="finalizeRunBtn" ' + (canFinalize ? '' : 'disabled') + '>Finalize Internal Run</button>' +
      '</div></div>' +
      '<div class="payroll-notice"><strong>Internal payroll summary — not payroll submission</strong>Review this run, then enter/export the approved totals into your external payroll provider. VE OS does not send direct deposit, file payroll taxes, or complete government payroll filings.</div>' +
      '<div class="review-kpis">' +
        '<div class="mini-stat"><div class="mini-label">Included staff</div><div class="mini-value">' + esc(stats.staff) + '</div><div class="mini-note">Employees with active assignments in preview</div></div>' +
        '<div class="mini-stat"><div class="mini-label">Gross pay</div><div class="mini-value">' + dollars(stats.gross) + '</div><div class="mini-note">Base plus earnings/additions where calculated</div></div>' +
        '<div class="mini-stat"><div class="mini-label">Deductions</div><div class="mini-value">' + dollars(stats.deductions) + '</div><div class="mini-note">Payroll deductions where calculated</div></div>' +
        '<div class="mini-stat"><div class="mini-label">Net pay</div><div class="mini-value">' + dollars(stats.net) + '</div><div class="mini-note">Internal review total only</div></div>' +
      '</div>' +
      '<div class="panel-title">Owner readiness warnings</div>' +
      '<div class="panel-sub">Critical: ' + critical + ' · Warnings: ' + warningCount + ' · ' + esc(claimsNote) + ' ' + esc(attendanceNote) + '</div>' +
      issueHtml +
      '<div style="height:14px"></div><div class="panel-title">Employee pay preview</div>' +
      '<div class="panel-sub">Amounts come from existing payroll settings, salary assignments, pay structures/components, run additions/deductions, attendance/leave rules, and the payroll preview API.</div>' +
      tableHtml +
      '<div style="height:14px"></div><div class="panel-title">Run additions / deductions</div>' +
      '<div class="panel-sub">Bonuses and deductions can be added to draft runs through the existing payroll additions API. Expense reimbursements are shown as readiness warnings until a dedicated reimbursement-to-run mapping is built.</div>' +
      '<div class="run-actions"><select id="addStaff"><option value="">Select staff</option>' + activeEmployeesForRun(run).map(function (e) { return '<option value="' + esc(e.staff_id) + '">' + esc(employeeName(e.staff_id)) + '</option>'; }).join('') + '</select>' +
      '<select id="addType"><option value="bonus">Bonus / earning</option><option value="deduction">Deduction</option></select>' +
      '<input id="addAmount" type="number" min="0" step="0.01" placeholder="Amount" style="max-width:110px" />' +
      '<input id="addDesc" type="text" placeholder="Description" style="min-width:160px" />' +
      '<button class="btn-sm" id="addRunItemBtn">Add to Run</button></div>';

    var printBtn = qs("printReportBtn");
    if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
    var refreshBtn = qs("refreshPreviewBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", function () { selectRun(run.run_id); });
    var finalizeBtn = qs("finalizeRunBtn");
    if (finalizeBtn) finalizeBtn.addEventListener("click", function () { finalizeRun(run); });
    var addBtn = qs("addRunItemBtn");
    if (addBtn) addBtn.addEventListener("click", function () { addRunItem(run); });

    renderRuns();
  }

  async function loadRunPreview(runId) {
    return tryEndpoints([
      "/api/hr/payroll/runs/" + encodeURIComponent(runId) + "/preview",
      "/api/hr/payroll/run-preview?run_id=" + encodeURIComponent(runId)
    ], { cache:"no-store" });
  }

  async function finalizeRun(run) {
    if (!confirm("Finalize this internal payroll run? This creates salary slips in VE OS. It does NOT file taxes or send direct deposit.")) return;
    var data = await tryEndpoints([
      "/api/hr/payroll/runs/" + encodeURIComponent(run.run_id) + "/finalize"
    ], { method:"POST", headers:{ "Content-Type":"application/json" }, body:"{}" });
    if (!data.ok) return toast(data.error || "Finalize failed", true);
    toast("Internal payroll run finalized. External payroll filing/direct deposit still not connected.");
    await loadAll();
    selectRun(run.run_id);
  }

  async function addRunItem(run) {
    var staffId = qs("addStaff").value;
    var type = qs("addType").value;
    var amount = qs("addAmount").value;
    var description = qs("addDesc").value;
    if (!staffId || !amount) return toast("Select staff and enter amount", true);
    var data = await tryEndpoints([
      "/api/hr/payroll/runs/" + encodeURIComponent(run.run_id) + "/additions"
    ], {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ staff_id:staffId, type:type, amount:amount, description:description })
    });
    if (!data.ok) return toast(data.error || "Could not add payroll item", true);
    toast("Added to draft run");
    selectRun(run.run_id);
  }

  async function selectRun(runId) {
    var run = runs.find(function (r) { return r.run_id === runId; });
    if (!run) return;
    selectedRunId = runId;
    selectedPreview = null;
    renderRuns();
    renderReviewLoading(run);
    var preview = await loadRunPreview(runId);
    renderReview(run, preview);
  }

  async function loadAll() {
    var results = await Promise.all([
      getJSON("/api/hr/payroll/runs", { ok:false, runs:[] }),
      getJSON("/api/hr/departments", { ok:false, departments:[] }),
      getJSON("/api/hr/employees", { ok:false, employees:[] }),
      getJSON("/api/hr/payroll/assignments", { ok:false, assignments:[] }),
      getJSON("/api/hr/payroll/structures", { ok:false, structures:[] }),
      getJSON("/api/hr/payroll/components", { ok:false, components:[] }),
      getJSON("/api/hr/payroll/settings", { ok:false, settings:null }),
      getJSON("/api/hr/payroll/claims", { ok:false, claims:[] }),
      getJSON("/api/hr/corrections", { ok:false, corrections:[] })
    ]);

    availability = {
      runs: !!results[0].ok,
      departments: !!results[1].ok,
      employees: !!results[2].ok,
      assignments: !!results[3].ok,
      structures: !!results[4].ok,
      components: !!results[5].ok,
      settings: !!results[6].ok,
      claims: !!results[7].ok,
      corrections: !!results[8].ok
    };
    if (results[0].ok) runs = asArray(results[0].runs);
    if (results[1].ok) departments = asArray(results[1].departments);
    if (results[2].ok) employees = asArray(results[2].employees);
    if (results[3].ok) assignments = asArray(results[3].assignments);
    if (results[4].ok) structures = asArray(results[4].structures);
    if (results[5].ok) components = asArray(results[5].components);
    if (results[6].ok) settings = results[6].settings || null;
    if (results[7].ok) claims = asArray(results[7].claims);
    if (results[8].ok) corrections = asArray(results[8].corrections);

    renderReadiness();
    renderRuns();
    loadDepts();
  }

  function loadDepts() {
    var sel = qs("fieldDept");
    var cur = sel.value;
    sel.innerHTML = '<option value="">All Departments</option>' + departments.map(function (dept) {
      return '<option value="' + esc(dept.dept_id) + '">' + esc(dept.name) + '</option>';
    }).join("");
    sel.value = cur;
  }

  qs("runsList").addEventListener("click", function (e) {
    var card = e.target.closest(".run-card");
    if (!card) return;
    selectRun(card.getAttribute("data-run-id"));
  });

  qs("newRunBtn").addEventListener("click", function () {
    var today = new Date();
    var y = today.getFullYear(), m = today.getMonth();
    var start = new Date(y, m, 1);
    var end = new Date(y, m + 1, 0);
    qs("fieldStart").value = start.toISOString().slice(0, 10);
    qs("fieldEnd").value = end.toISOString().slice(0, 10);
    qs("modal").classList.add("open");
  });
  qs("cancelBtn").addEventListener("click", function () { qs("modal").classList.remove("open"); });
  qs("createBtn").addEventListener("click", function () {
    var body = {
      pay_period_start: qs("fieldStart").value,
      pay_period_end: qs("fieldEnd").value,
      department_id: qs("fieldDept").value,
    };
    if (!body.pay_period_start || !body.pay_period_end) { toast("Start and end dates required", true); return; }
    fetch("/api/hr/payroll/runs", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(async function (d) {
        if (!d.ok) return toast(d.error || "Could not create run", true);
        qs("modal").classList.remove("open");
        toast("Draft payroll run created");
        await loadAll();
        if (d.run && d.run.run_id) selectRun(d.run.run_id);
      })
      .catch(function (err) { toast(err.message, true); });
  });

  loadAll();
})();
