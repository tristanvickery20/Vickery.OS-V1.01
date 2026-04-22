(function () {
  var slipId = location.pathname.replace("/people/payroll/slips/", "").replace(/\//g, "");

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function fmt(n) { return "$" + (parseFloat(n)||0).toFixed(2); }
  function fmtDate(d) {
    if (!d) return "";
    var p = d.split("-");
    return new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2])).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
  }
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  fetch("/api/hr/payroll/slips/" + slipId).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { document.getElementById("slipContent").innerHTML = '<div class="empty">Slip not found.</div>'; return; }
    var s = d.slip;
    document.getElementById("backLink").href = "/people/payroll/runs/" + s.run_id;

    var earnings = JSON.parse(s.earnings_detail || "[]");
    var deductions = JSON.parse(s.deductions_detail || "[]");
    var eRows = '<tr><td>Base Pay</td><td class="right">' + fmt(s.base_amount) + '</td></tr>' +
      earnings.map(function (e) { return "<tr><td>" + esc(e.name) + "</td><td class='right'>" + fmt(e.amount) + "</td></tr>"; }).join("");
    var dRows = deductions.map(function (e) { return "<tr><td>" + esc(e.name) + "</td><td class='right'>" + fmt(e.amount) + "</td></tr>"; }).join("") ||
      "<tr><td colspan='2' style='color:var(--muted)'>No deductions</td></tr>";

    var shareUrl = window.location.origin + "/salary-slip/" + s.share_token;
    document.getElementById("slipContent").innerHTML =
      '<div class="slip-card">' +
        '<div class="slip-header">' +
          '<div class="slip-company">Vickery Electric</div>' +
          '<div class="slip-title">Salary Slip</div>' +
          '<div class="slip-meta">' +
            '<span>Employee: <strong>' + esc(s.employee_name) + '</strong></span>' +
            '<span>Period: <strong>' + fmtDate(s.pay_period_start) + ' – ' + fmtDate(s.pay_period_end) + '</strong></span>' +
            '<span>Days: <strong>' + esc(s.working_days) + ' of ' + esc(s.total_days) + '</strong></span>' +
          '</div>' +
        '</div>' +
        '<div class="slip-section">' +
          '<div class="slip-section-title">Earnings</div>' +
          '<table class="slip-table"><tr><th>Component</th><th class="right">Amount</th></tr>' + eRows + '</table>' +
        '</div>' +
        '<div class="slip-section">' +
          '<div class="slip-section-title">Deductions</div>' +
          '<table class="slip-table"><tr><th>Component</th><th class="right">Amount</th></tr>' + dRows + '</table>' +
        '</div>' +
        '<div class="slip-totals">' +
          '<div class="slip-total-box"><div class="slip-total-label">Gross Earnings</div><div class="slip-total-value">' + fmt(s.gross_earnings) + '</div></div>' +
          '<div class="slip-total-box"><div class="slip-total-label">Total Deductions</div><div class="slip-total-value">' + fmt(s.total_deductions) + '</div></div>' +
          '<div class="slip-total-box"><div class="slip-total-label">Net Pay</div><div class="slip-total-value net-pay">' + fmt(s.net_pay) + '</div></div>' +
        '</div>' +
        '<div class="share-row">' +
          '<input class="share-input" id="shareInput" readonly value="' + esc(shareUrl) + '" />' +
          '<button class="btn-copy" id="copyBtn">Copy Link</button>' +
        '</div>' +
      '</div>';

    document.getElementById("copyBtn").addEventListener("click", function () {
      navigator.clipboard.writeText(shareUrl).then(function () { toast("Link copied!"); });
    });
  });
})();
