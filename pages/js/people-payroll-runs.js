(function () {
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }
  function fmtDate(d) { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : ""; }

  function load() {
    fetch("/api/hr/payroll/runs").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      var runs = d.runs;
      var el = document.getElementById("runsList");
      if (runs.length === 0) {
        el.innerHTML = '<div class="empty"><strong>No payroll runs yet</strong>Create your first run to generate salary slips.</div>';
        return;
      }
      el.innerHTML = runs.map(function (r) {
        var badge = r.status === "finalized"
          ? '<span class="badge badge-finalized">Finalized</span>'
          : '<span class="badge badge-draft">Draft</span>';
        return '<a class="run-card" href="/people/payroll/runs/' + esc(r.run_id) + '">' +
          '<div class="run-info">' +
            '<div class="run-period">' + fmtDate(r.pay_period_start) + ' – ' + fmtDate(r.pay_period_end) + ' ' + badge + '</div>' +
            '<div class="run-meta">Created ' + fmtDate(r.created_at) + (r.department_id ? ' · Dept filter active' : '') + '</div>' +
          '</div>' +
          '<div class="run-arrow">›</div>' +
        '</a>';
      }).join("");
    });
  }

  function loadDepts() {
    fetch("/api/hr/departments").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      var sel = document.getElementById("fieldDept");
      d.departments.forEach(function (dept) {
        var opt = document.createElement("option");
        opt.value = dept.dept_id;
        opt.textContent = dept.name;
        sel.appendChild(opt);
      });
    });
  }

  document.getElementById("newRunBtn").addEventListener("click", function () {
    var today = new Date();
    var y = today.getFullYear(), m = today.getMonth();
    var start = new Date(y, m, 1);
    var end = new Date(y, m + 1, 0);
    document.getElementById("fieldStart").value = start.toISOString().slice(0, 10);
    document.getElementById("fieldEnd").value   = end.toISOString().slice(0, 10);
    document.getElementById("modal").classList.add("open");
  });
  document.getElementById("cancelBtn").addEventListener("click", function () {
    document.getElementById("modal").classList.remove("open");
  });
  document.getElementById("createBtn").addEventListener("click", function () {
    var body = {
      pay_period_start: document.getElementById("fieldStart").value,
      pay_period_end:   document.getElementById("fieldEnd").value,
      department_id:    document.getElementById("fieldDept").value,
    };
    if (!body.pay_period_start || !body.pay_period_end) { toast("Start and end dates required", true); return; }
    fetch("/api/hr/payroll/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { document.getElementById("modal").classList.remove("open"); window.location.href = "/people/payroll/runs/" + d.run.run_id; }
        else toast(d.error || "Error", true);
      });
  });

  load();
  loadDepts();
})();
