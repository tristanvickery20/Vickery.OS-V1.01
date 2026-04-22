(function () {
  var allClaims = [];
  var activeFilter = "";

  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function fmt(n) { return "$" + (parseFloat(n) || 0).toFixed(2); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }

  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  function badgeHTML(status) {
    var cls = { submitted:"badge-submitted", approved:"badge-approved", rejected:"badge-rejected", paid:"badge-paid" }[status] || "";
    return '<span class="badge ' + cls + '">' + esc(status) + '</span>';
  }

  function render() {
    var list = allClaims.filter(function (c) { return !activeFilter || c.status === activeFilter; });
    var el = document.getElementById("claimsList");
    if (list.length === 0) {
      el.innerHTML = '<div class="empty"><strong>No claims found</strong>Filter by a different status or wait for submissions.</div>';
      return;
    }
    el.innerHTML = list.map(function (c) {
      var total = (c.items || []).reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
      var itemsHTML = (c.items || []).map(function (i) {
        return '<div class="claim-item"><span class="claim-item-cat">' + esc(i.category) + (i.description ? " — " + esc(i.description) : "") + '</span><span>' + fmt(i.amount) + '</span></div>';
      }).join("");
      var actions = "";
      if (c.status === "submitted") {
        actions += '<button class="btn-sm btn-approve" data-id="' + esc(c.claim_id) + '" data-action="approve">Approve</button>';
        actions += '<button class="btn-sm btn-reject"  data-id="' + esc(c.claim_id) + '" data-action="reject">Reject</button>';
      }
      if (c.status === "approved") {
        actions += '<button class="btn-sm btn-paid" data-id="' + esc(c.claim_id) + '" data-action="paid">Mark Paid</button>';
      }
      actions += '<button class="btn-sm btn-reject" data-id="' + esc(c.claim_id) + '" data-action="delete">Delete</button>';
      return '<div class="claim-card">' +
        '<div class="claim-top">' +
          '<div><div class="claim-name">' + esc(c.employee_name) + '</div>' +
          '<div class="claim-meta">' + fmtDate(c.claim_date) + (c.job_id ? " · Job " + esc(c.job_id) : "") + ' · ' + badgeHTML(c.status) + '</div></div>' +
          '<div class="claim-amount">' + fmt(total) + '</div>' +
        '</div>' +
        '<div class="claim-items">' + (itemsHTML || '<span class="claim-item-cat">No items</span>') + '</div>' +
        (c.notes ? '<div class="claim-meta" style="margin-top:8px">' + esc(c.notes) + '</div>' : '') +
        (c.manager_note ? '<div class="claim-meta" style="margin-top:4px;color:#f87171;">Manager note: ' + esc(c.manager_note) + '</div>' : '') +
        '<div class="claim-actions">' + actions + '</div>' +
      '</div>';
    }).join("");
  }

  function load() {
    fetch("/api/hr/payroll/claims").then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { allClaims = d.claims; render(); }
    });
  }

  document.getElementById("filters").addEventListener("click", function (e) {
    var btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeFilter = btn.dataset.status;
    document.querySelectorAll(".filter-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.status === activeFilter); });
    render();
  });

  document.getElementById("claimsList").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var id = btn.dataset.id;
    var action = btn.dataset.action;
    if (action === "delete") {
      if (!confirm("Delete this claim?")) return;
      fetch("/api/hr/payroll/claims/" + id, { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { toast("Deleted"); load(); }
        else toast("Error: " + d.error, true);
      });
      return;
    }
    var statusMap = { approve: "approved", reject: "rejected", paid: "paid" };
    var note = action === "reject" ? prompt("Rejection reason (optional):") : undefined;
    var body = { status: statusMap[action] };
    if (note !== undefined) body.manager_note = note || "";
    fetch("/api/hr/payroll/claims/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { toast("Updated"); load(); }
        else toast("Error: " + d.error, true);
      });
  });

  load();
})();
