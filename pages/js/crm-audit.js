(function () {
  const tableBody = document.getElementById("auditBody");
  const countEl = document.getElementById("auditCount");
  const entityInput = document.getElementById("filterEntity");
  const actionSelect = document.getElementById("filterAction");
  const refreshBtn = document.getElementById("refreshBtn");

  async function loadAudit() {
    tableBody.innerHTML = "<tr><td colspan='10'>Loading...</td></tr>";
    try {
      const params = new URLSearchParams();
      const eid = entityInput.value.trim();
      const act = actionSelect.value;
      if (eid) params.set("entity_id", eid);
      if (act) params.set("action", act);

      const data = await window.Api.fetchJson("/api/audit?" + params.toString());
      const entries = data.entries || [];
      countEl.textContent = entries.length + " entries";

      if (entries.length === 0) {
        tableBody.innerHTML = "<tr><td colspan='10' style='text-align:center;'>No audit entries found.</td></tr>";
        return;
      }

      tableBody.innerHTML = "";
      for (const e of entries) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + esc(e.created_at ? e.created_at.replace("T", " ").slice(0, 19) : "") + "</td>" +
          "<td>" + esc(e.actor) + "</td>" +
          "<td><strong>" + esc(e.action) + "</strong></td>" +
          "<td>" + esc(e.entity_type) + "</td>" +
          "<td>" + esc(e.entity_id) + "</td>" +
          "<td>" + esc(e.field) + "</td>" +
          "<td>" + esc(trunc(e.old_value, 60)) + "</td>" +
          "<td>" + esc(trunc(e.new_value, 60)) + "</td>" +
          "<td>" + esc(e.note) + "</td>" +
          "<td>" + esc(e.source) + "</td>";
        tableBody.appendChild(tr);
      }
    } catch (err) {
      tableBody.innerHTML = "<tr><td colspan='10'>Error: " + err.message + "</td></tr>";
    }
  }

  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function trunc(s, max) {
    if (!s) return "";
    return s.length > max ? s.slice(0, max) + "..." : s;
  }

  refreshBtn.addEventListener("click", loadAudit);
  entityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadAudit(); });
  actionSelect.addEventListener("change", loadAudit);

  loadAudit();
})();
