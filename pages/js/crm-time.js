(() => {
  const resultEl  = document.getElementById("result");
  const submitBtn = document.getElementById("submitBtn");
  const durPrev   = document.getElementById("durPreview");
  const refreshBtn = document.getElementById("refreshBtn");

  // Maps populated after fetch
  let _techMap = {};
  let _leadMap = {};

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function fmtDur(minutes) {
    const m = Number(minutes) || 0;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0 && rem === 0) return "0 min";
    if (h === 0) return `${rem} min`;
    if (rem === 0) return `${h} hr`;
    return `${h} hr ${rem} min`;
  }

  function catIcon(cat) {
    return { work: "⚡", drive: "🚗", admin: "📋" }[cat] || "⏱";
  }

  function updateDurPreview() {
    const h = parseInt(document.getElementById("hours").value || 0) || 0;
    const m = parseInt(document.getElementById("mins").value  || 0) || 0;
    const total = h * 60 + m;
    durPrev.textContent = total > 0 ? fmtDur(total) : "";
  }

  document.getElementById("hours").addEventListener("input", updateDurPreview);
  document.getElementById("mins").addEventListener("input", updateDurPreview);

  async function populateSelects() {
    const techSelect = document.getElementById("tech_id");
    const leadSelect = document.getElementById("lead_id");

    const [techsData, leadsData] = await Promise.all([
      window.Api.fetchJson("/api/techs"),
      window.Api.fetchJson("/api/leads"),
    ]);

    _techMap = {};
    techSelect.innerHTML = '<option value="">(select tech)</option>';
    for (const t of (techsData.techs || [])) {
      _techMap[t.id] = t.name;
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      techSelect.appendChild(o);
    }

    _leadMap = {};
    leadSelect.innerHTML = '<option value="">(none)</option>';
    for (const l of (leadsData.leads || [])) {
      const label = l.name || l.customer_name || l.id;
      _leadMap[l.id] = label;
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = label;
      leadSelect.appendChild(o);
    }
  }

  async function loadEntries() {
    const listEl  = document.getElementById("entriesList");
    const countEl = document.getElementById("entriesCount");
    listEl.innerHTML = `<div class="loading-text">Loading…</div>`;

    try {
      const data = await window.Api.fetchJson("/api/time");
      const entries = data.entries || [];
      countEl.textContent = `${entries.length} entries`;

      if (!entries.length) {
        listEl.innerHTML = `<div class="loading-text">No time entries yet.</div>`;
        return;
      }

      listEl.innerHTML = entries.map(e => {
        const techName = _techMap[e.tech_id] || e.tech_id || "—";
        const leadName = _leadMap[e.lead_id] || (e.lead_id ? e.lead_id : "");
        const icon     = catIcon(e.category);
        const dur      = fmtDur(e.minutes);
        const cat      = (e.category || "work").charAt(0).toUpperCase() + (e.category || "work").slice(1);
        return `<div class="entry-card">
          <div class="entry-icon">${icon}</div>
          <div class="entry-body">
            <div class="entry-row1">
              <span class="entry-tech">${esc(techName)}</span>
              <span class="entry-dur">${esc(dur)}</span>
            </div>
            <div class="entry-row2">
              <span>${esc(e.date || "")}</span>
              <span class="entry-tag">${esc(cat)}</span>
              ${leadName ? `<span>📋 ${esc(leadName)}</span>` : ""}
              ${e.notes ? `<span>💬 ${esc(e.notes)}</span>` : ""}
            </div>
          </div>
        </div>`;
      }).join("");
    } catch (err) {
      listEl.innerHTML = `<div class="loading-text" style="color:hsl(0 70% 65%)">Error: ${esc(err.message)}</div>`;
    }
  }

  submitBtn.addEventListener("click", async () => {
    resultEl.textContent = "";
    resultEl.className = "log-result";

    const date    = document.getElementById("date").value;
    const tech_id = document.getElementById("tech_id").value;
    const lead_id = document.getElementById("lead_id").value;
    const hours   = parseInt(document.getElementById("hours").value || 0) || 0;
    const mins    = parseInt(document.getElementById("mins").value  || 0) || 0;
    const minutes = hours * 60 + mins;
    const category = document.getElementById("category").value;
    const notes    = document.getElementById("notes").value.trim();

    if (!date)    { resultEl.textContent = "Pick a date.";       resultEl.className = "log-result err"; return; }
    if (!tech_id) { resultEl.textContent = "Select a tech.";     resultEl.className = "log-result err"; return; }
    if (minutes <= 0) { resultEl.textContent = "Enter a duration."; resultEl.className = "log-result err"; return; }

    submitBtn.disabled = true;
    resultEl.textContent = "Saving…";

    try {
      const r = await window.Api.fetchJson("/api/time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, tech_id, lead_id, minutes, category, notes }),
      });

      if (r.ok) {
        resultEl.textContent = `✓ Logged ${fmtDur(minutes)} for ${_techMap[tech_id] || tech_id}`;
        resultEl.className = "log-result ok";
        document.getElementById("hours").value = "";
        document.getElementById("mins").value  = "";
        durPrev.textContent = "";
        document.getElementById("notes").value = "";
        loadEntries();
      } else {
        resultEl.textContent = r.error || "Save failed.";
        resultEl.className = "log-result err";
      }
    } catch (err) {
      resultEl.textContent = err.message;
      resultEl.className = "log-result err";
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (refreshBtn) refreshBtn.addEventListener("click", loadEntries);

  async function init() {
    document.getElementById("date").value = todayStr();
    await populateSelects();
    await loadEntries();
  }

  init();
})();
