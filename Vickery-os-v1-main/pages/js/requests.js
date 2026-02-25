(() => {
  const STATUS_STYLES = {
    lead: { label: "Lead", dot: "hsl(215,16%,47%)" },
    quoted: { label: "Quoted", dot: "hsl(221,83%,53%)" },
    scheduled: { label: "Scheduled", dot: "hsl(221,83%,53%)" },
    "in progress": { label: "In Progress", dot: "hsl(221,83%,53%)" },
    complete: { label: "Complete", dot: "hsl(142,71%,45%)" },
    invoiced: { label: "Invoiced", dot: "hsl(40,95%,50%)" },
    paid: { label: "Paid", dot: "hsl(142,71%,45%)" },
    closed: { label: "Closed", dot: "hsl(215,16%,47%)" },
  };

  const STATUSES = ["Lead","Quoted","Scheduled","In Progress","Complete"];
  const DISABLED_STATUSES = ["Invoiced","Paid","Closed"];

  let allRequests = [];
  let debounceTimer = null;

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function fmtShortDate(iso) {
    if (!iso) return "\u2014";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[d.getMonth()] + " " + d.getDate();
  }

  function statusBadge(code) {
    var s = STATUS_STYLES[(code||"").toLowerCase()] || { label: code||"Unknown", dot: "hsl(215,16%,47%)" };
    return '<span class="rq-status"><span class="rq-dot" style="background:'+s.dot+'"></span>' + esc(s.label) + '</span>';
  }

  function depositCell(r) {
    if (r.deposit_required === "true" || r.deposit_required === "1" || r.deposit_required === "yes") {
      var received = Number(r.deposit_received || 0);
      if (received > 0) {
        return '<span style="color:hsl(142,71%,45%);font-size:12px;font-weight:500;">Received</span>';
      }
      if (r.deposit_gate_blocked) {
        return '<span class="rq-deposit-warn">Required</span>';
      }
      return '<span style="font-size:12px;color:hsl(var(--muted-foreground))">Required</span>';
    }
    return '<span style="font-size:12px;color:hsl(var(--muted-foreground))">No</span>';
  }

  function statusSelect(r) {
    var current = (r.status_code || "").toLowerCase();
    var html = '<select class="rq-inline-select" data-id="' + esc(r.id) + '" data-original="' + esc(r.status_code) + '">';
    for (var i = 0; i < STATUSES.length; i++) {
      var s = STATUSES[i];
      var sel = s.toLowerCase() === current ? ' selected' : '';
      html += '<option value="' + esc(s) + '"' + sel + '>' + esc(s) + '</option>';
    }
    for (var j = 0; j < DISABLED_STATUSES.length; j++) {
      html += '<option value="" disabled>' + esc(DISABLED_STATUSES[j]) + ' (soon)</option>';
    }
    html += '</select>';
    return html;
  }

  function renderTable() {
    var tbody = document.getElementById("tableBody");
    if (allRequests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="rq-empty">No requests found.</td></tr>';
      return;
    }
    tbody.innerHTML = allRequests.map(function(r) {
      return '<tr>' +
        '<td><a href="/requests/' + encodeURIComponent(r.id) + '" class="rq-link">' + esc(r.summary || r.id) + '</a></td>' +
        '<td>' + esc(r.client_name || "\u2014") + '</td>' +
        '<td>' + esc(r.property_address || "\u2014") + '</td>' +
        '<td>' + statusBadge(r.status_code) + '</td>' +
        '<td>' + depositCell(r) + '</td>' +
        '<td style="white-space:nowrap;">' + fmtShortDate(r.updated_at || r.created_at) + '</td>' +
        '<td>' + statusSelect(r) + '<span class="rq-inline-error" id="err-' + esc(r.id) + '" style="display:none;"></span></td>' +
      '</tr>';
    }).join("");
  }

  async function loadRequests() {
    var q = (document.getElementById("searchInput").value || "").trim();
    var status = document.getElementById("statusFilter").value;
    var params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);

    try {
      var resp = await fetch("/api/requests?" + params.toString());
      var data = await resp.json();
      allRequests = data.ok ? data.requests : [];
    } catch {
      allRequests = [];
    }
    renderTable();
  }

  async function changeStatus(id, newStatus, selectEl) {
    var errEl = document.getElementById("err-" + id);
    if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }

    try {
      var resp = await fetch("/api/requests/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_code: newStatus }),
      });
      var data = await resp.json();
      if (!data.ok) {
        if (errEl) { errEl.textContent = data.message || data.error || "Failed."; errEl.style.display = "block"; }
        selectEl.value = selectEl.dataset.original;
        return;
      }
      loadRequests();
    } catch {
      if (errEl) { errEl.textContent = "Network error."; errEl.style.display = "block"; }
      selectEl.value = selectEl.dataset.original;
    }
  }

  document.getElementById("tableBody").addEventListener("change", function(e) {
    var sel = e.target.closest(".rq-inline-select");
    if (!sel) return;
    changeStatus(sel.dataset.id, sel.value, sel);
  });

  document.getElementById("searchInput").addEventListener("input", function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadRequests, 300);
  });

  document.getElementById("statusFilter").addEventListener("change", loadRequests);

  loadRequests();
})();
