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
  const pathParts = window.location.pathname.split("/requests/");
  const requestId = pathParts[1] ? decodeURIComponent(pathParts[1]) : "";

  let data = null;

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function fmtMoney(val) {
    var n = Number(val);
    if (isNaN(n)) return "$0.00";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusBadge(code) {
    var s = STATUS_STYLES[(code||"").toLowerCase()] || { label: code||"Unknown", dot: "hsl(215,16%,47%)" };
    return '<span class="rd-status"><span class="rd-dot" style="background:'+s.dot+'"></span>' + esc(s.label) + '</span>';
  }

  function showError(msg) {
    document.getElementById("loadingMsg").style.display = "none";
    document.getElementById("detailContent").style.display = "none";
    var el = document.getElementById("errorMsg");
    el.style.display = "block";
    el.innerHTML = '<h2 style="margin-bottom:8px;">' + esc(msg) + '</h2><a href="/requests" class="rd-back">&larr; Back to Requests</a>';
  }

  function render() {
    var r = data.request;
    var c = data.client;
    var p = data.property;
    var cost = data.costing;

    document.getElementById("pageTitle").innerHTML = esc(r.summary || r.id) + " " + statusBadge(r.status_code);
    document.title = (r.summary || r.id) + " \u2022 Vickery CRM";

    var html = '';

    html += '<div class="rd-cards">';
    html += '<div class="rd-card"><div class="rd-card-title">Client</div><div class="rd-card-body">';
    if (c.id) {
      html += '<a href="/clients/' + encodeURIComponent(c.id) + '">' + esc(c.name || "Unknown") + '</a>';
      if (c.phone) html += '<br>' + esc(c.phone);
      if (c.email) html += '<br>' + esc(c.email);
    } else {
      html += '<span style="color:hsl(var(--muted-foreground))">No client linked.</span>';
    }
    html += '</div></div>';

    html += '<div class="rd-card"><div class="rd-card-title">Property</div><div class="rd-card-body">';
    if (p) {
      html += esc(p.address_line1 || "");
      html += '<br>' + esc([p.city, p.state].filter(Boolean).join(", "));
      if (p.zip) html += " " + esc(p.zip);
      var addr = [p.address_line1, p.city, p.state, p.zip].filter(Boolean).join(", ");
      html += '<br><a href="https://maps.google.com/?q=' + encodeURIComponent(addr) + '" target="_blank" rel="noopener">Directions &rarr;</a>';
    } else {
      html += '<span style="color:hsl(var(--muted-foreground))">No property linked.</span>';
    }
    html += '</div></div>';

    html += '<div class="rd-card"><div class="rd-card-title">Financial Preview</div><div class="rd-card-body">';
    html += '<div class="rd-stat-grid">';
    html += '<div class="rd-stat"><div class="rd-stat-val">' + cost.total_minutes + '</div><div class="rd-stat-label">Minutes</div></div>';
    html += '<div class="rd-stat"><div class="rd-stat-val">' + fmtMoney(cost.labor_cost) + '</div><div class="rd-stat-label">Labor</div></div>';
    html += '<div class="rd-stat"><div class="rd-stat-val">' + fmtMoney(cost.expense_cost) + '</div><div class="rd-stat-label">Expenses</div></div>';
    html += '<div class="rd-stat"><div class="rd-stat-val">' + fmtMoney(cost.total_cost) + '</div><div class="rd-stat-label">Total Cost</div></div>';
    html += '</div>';
    html += '</div></div>';
    html += '</div>';

    html += '<div class="rd-section">';
    html += '<div class="rd-section-title">Request Details</div>';

    html += '<div class="rd-field"><label class="rd-label">Summary</label>';
    html += '<textarea class="rd-textarea" id="fSummary">' + esc(r.summary) + '</textarea></div>';

    html += '<div class="rd-field"><label class="rd-label">Estimated Value ($)</label>';
    html += '<input type="number" class="rd-input" id="fEstValue" value="' + esc(r.estimated_value) + '" step="0.01" /></div>';

    html += '<div class="rd-field"><label class="rd-label">Lead Source</label>';
    html += '<input type="text" class="rd-input" id="fSource" value="' + esc(r.lead_source) + '" /></div>';

    html += '<div class="rd-field">';
    html += '<div class="rd-toggle-row"><input type="checkbox" class="rd-toggle" id="fDepReq"' + (r.deposit_required === "true" ? " checked" : "") + ' /><label for="fDepReq">Deposit Required</label></div>';
    html += '</div>';

    html += '<div class="rd-field"><label class="rd-label">Deposit Received ($)</label>';
    html += '<input type="number" class="rd-input" id="fDepRec" value="' + esc(r.deposit_received || "0") + '" step="0.01" /></div>';

    html += '<div class="rd-field">';
    html += '<div class="rd-toggle-row"><input type="checkbox" class="rd-toggle" id="fDepOvr"' + (r.deposit_override === "true" ? " checked" : "") + ' /><label for="fDepOvr">Override Deposit Gate</label></div>';
    html += '</div>';

    html += '<div class="rd-field"><label class="rd-label">Status</label>';
    html += '<select class="rd-select" id="fStatus">';
    for (var i = 0; i < STATUSES.length; i++) {
      var s = STATUSES[i];
      var sel = s.toLowerCase() === (r.status_code || "").toLowerCase() ? " selected" : "";
      html += '<option value="' + esc(s) + '"' + sel + '>' + esc(s) + '</option>';
    }
    html += '<option disabled>Invoiced (coming soon)</option>';
    html += '<option disabled>Paid (coming soon)</option>';
    html += '<option disabled>Closed (coming soon)</option>';
    html += '</select></div>';

    html += '<div class="rd-actions">';
    html += '<button class="rd-btn" id="saveBtn">Save Changes</button>';
    html += '</div>';
    html += '<div id="msgArea"></div>';
    html += '</div>';

    document.getElementById("detailContent").innerHTML = html;
    document.getElementById("detailContent").style.display = "block";

    document.getElementById("saveBtn").addEventListener("click", saveChanges);
  }

  async function saveChanges() {
    var btn = document.getElementById("saveBtn");
    var msgArea = document.getElementById("msgArea");
    msgArea.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Saving...";

    var payload = {
      summary: document.getElementById("fSummary").value.trim(),
      estimated_value: document.getElementById("fEstValue").value.trim(),
      lead_source: document.getElementById("fSource").value.trim(),
      deposit_required: document.getElementById("fDepReq").checked ? "true" : "false",
      deposit_received: document.getElementById("fDepRec").value.trim() || "0",
      deposit_override: document.getElementById("fDepOvr").checked ? "true" : "false",
      status_code: document.getElementById("fStatus").value,
    };

    try {
      var resp = await fetch("/api/requests/" + encodeURIComponent(requestId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var result = await resp.json();
      if (!result.ok) {
        msgArea.innerHTML = '<div class="rd-msg rd-msg-error">' + esc(result.message || result.error || "Update failed.") + '</div>';
        btn.disabled = false;
        btn.textContent = "Save Changes";
        return;
      }
      msgArea.innerHTML = '<div class="rd-msg rd-msg-success">Saved successfully.</div>';
      setTimeout(function() { window.location.reload(); }, 800);
    } catch (err) {
      msgArea.innerHTML = '<div class="rd-msg rd-msg-error">Network error.</div>';
      btn.disabled = false;
      btn.textContent = "Save Changes";
    }
  }

  async function init() {
    if (!requestId) return showError("No request ID.");

    try {
      var resp = await fetch("/api/requests/" + encodeURIComponent(requestId));
      data = await resp.json();
      if (!data.ok) return showError("Request not found.");

      document.getElementById("loadingMsg").style.display = "none";
      render();
    } catch {
      showError("Error loading request.");
    }
  }

  init();
})();
