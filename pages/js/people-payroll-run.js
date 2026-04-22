(function () {
  var runId = location.pathname.replace("/people/payroll/runs/", "").replace(/\//g, "");
  var runData = null;

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function fmt(n) { return "$" + (parseFloat(n)||0).toFixed(2); }
  function fmtDate(d) { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—"; }

  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  function loadSlips() {
    fetch("/api/hr/payroll/slips?run_id=" + runId).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || d.slips.length === 0) { document.getElementById("slipsSection").style.display = "none"; return; }
      document.getElementById("slipsSection").style.display = "";
      document.getElementById("slipsList").innerHTML = d.slips.map(function (s) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(100,150,255,.08)">' +
          '<span>' + esc(s.employee_name) + '</span>' +
          '<span style="display:flex;align-items:center;gap:16px">' +
            '<span style="color:#34d399;font-weight:700">' + fmt(s.net_pay) + '</span>' +
            '<a href="/people/payroll/slips/' + esc(s.slip_id) + '" style="color:#60a5fa;font-size:12px;text-decoration:none">View Slip ›</a>' +
          '</span>' +
        '</div>';
      }).join("");
    });
  }

  function loadEmployees() {
    fetch("/api/hr/employees").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      var sel = document.getElementById("addStaff");
      sel.innerHTML = '<option value="">— Select Employee —</option>';
      d.employees.filter(function (e) { return e.employment_status !== "terminated"; }).forEach(function (e) {
        var opt = document.createElement("option");
        opt.value = e.staff_id;
        opt.textContent = ((e.first_name || "") + " " + (e.last_name || "")).trim() || e.staff_id;
        sel.appendChild(opt);
      });
    });
  }

  function loadAdditions() {
    fetch("/api/hr/payroll/runs/" + runId + "/additions").then(function (r) { return r.json(); }).then(function (d) {
      var el = document.getElementById("additionList");
      if (!d.ok || d.additions.length === 0) { el.innerHTML = ""; return; }
      el.innerHTML = d.additions.map(function (a) {
        var sign = a.type === "bonus" ? "+" : "-";
        return '<div class="addition-row">' +
          '<span>' + esc(a.staff_id) + ' — ' + esc(a.description || a.type) + '</span>' +
          '<span style="display:flex;align-items:center;gap:10px">' +
            '<span style="color:' + (a.type==="bonus"?"#34d399":"#f87171") + ';font-weight:700">' + sign + fmt(a.amount) + '</span>' +
            '<button class="btn-del" data-add-id="' + esc(a.addition_id) + '">×</button>' +
          '</span>' +
        '</div>';
      }).join("");
    });
  }

  function loadPreview() {
    document.getElementById("previewWrap").innerHTML = '<div class="empty">Loading…</div>';
    fetch("/api/hr/payroll/runs/" + runId + "/preview").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { document.getElementById("previewWrap").innerHTML = '<div class="empty">Error: ' + esc(d.error || "Failed to load") + '</div>'; return; }
      runData = d.run;
      var title = fmtDate(d.run.pay_period_start) + " – " + fmtDate(d.run.pay_period_end);
      document.getElementById("runTitle").textContent = title;
      document.getElementById("runBadge").innerHTML = d.run.status === "finalized"
        ? '<span class="badge badge-finalized">Finalized</span>'
        : '<span class="badge badge-draft">Draft</span>';

      var isDraft = d.run.status === "draft";
      document.getElementById("finalizeBtn").style.display = isDraft ? "" : "none";
      document.getElementById("additionForm").style.display = isDraft ? "" : "none";
      document.getElementById("additionsTitle").style.display = isDraft ? "" : "none";
      loadAdditions();

      if (d.previews.length === 0) {
        document.getElementById("previewWrap").innerHTML = '<div class="empty">No employees with salary assignments found for this period.</div>';
        return;
      }
      var totalGross = 0, totalNet = 0, totalDed = 0;
      var rows = d.previews.map(function (p) {
        totalGross += parseFloat(p.gross_earnings) || 0;
        totalNet   += parseFloat(p.net_pay) || 0;
        totalDed   += parseFloat(p.total_deductions) || 0;
        return '<tr>' +
          '<td>' + esc(p.name) + '</td>' +
          '<td class="amount">' + fmt(p.base_amount) + '</td>' +
          '<td class="amount">' + fmt(p.gross_earnings) + '</td>' +
          '<td class="amount">' + fmt(p.total_deductions) + '</td>' +
          '<td class="amount net-pay">' + fmt(p.net_pay) + '</td>' +
          '<td>' + (p.working_days || "—") + ' days</td>' +
        '</tr>';
      }).join("");
      document.getElementById("previewWrap").innerHTML =
        '<div style="overflow-x:auto"><table class="preview-table">' +
          '<thead><tr><th>Employee</th><th class="amount">Base</th><th class="amount">Gross</th><th class="amount">Deductions</th><th class="amount">Net Pay</th><th>Working Days</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '<tfoot><tr class="totals-row"><td><strong>Total (' + d.previews.length + ' employees)</strong></td><td></td><td class="amount"><strong>' + fmt(totalGross) + '</strong></td><td class="amount"><strong>' + fmt(totalDed) + '</strong></td><td class="amount net-pay"><strong>' + fmt(totalNet) + '</strong></td><td></td></tr></tfoot>' +
        '</table></div>';

      if (d.run.status === "finalized") loadSlips();
    });
  }

  document.getElementById("refreshBtn").addEventListener("click", loadPreview);

  document.getElementById("finalizeBtn").addEventListener("click", function () {
    if (!confirm("Finalize this payroll run? This will generate salary slips for all employees and cannot be undone.")) return;
    this.disabled = true;
    fetch("/api/hr/payroll/runs/" + runId + "/finalize", { method: "POST" }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { toast("Run finalized — " + d.slips_created + " slips generated"); loadPreview(); loadSlips(); }
      else { toast(d.error || "Error", true); document.getElementById("finalizeBtn").disabled = false; }
    });
  });

  document.getElementById("addAdditionBtn").addEventListener("click", function () {
    var body = {
      staff_id: document.getElementById("addStaff").value,
      type: document.getElementById("addType").value,
      description: document.getElementById("addDesc").value,
      amount: document.getElementById("addAmount").value,
    };
    if (!body.staff_id || !body.amount) { toast("Select an employee and enter an amount", true); return; }
    fetch("/api/hr/payroll/runs/" + runId + "/additions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { toast("Added"); document.getElementById("addAmount").value = ""; document.getElementById("addDesc").value = ""; loadAdditions(); loadPreview(); }
        else toast(d.error || "Error", true);
      });
  });

  document.getElementById("additionList").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-add-id]");
    if (!btn) return;
    fetch("/api/hr/payroll/additions/" + btn.dataset.addId, { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { toast("Removed"); loadAdditions(); loadPreview(); }
    });
  });

  loadPreview();
  loadEmployees();
})();
