(() => {
  const statusEl = document.getElementById("status");
  const tbody = document.querySelector("#table tbody");
  const refreshBtn = document.getElementById("refreshBtn");
  const H = window.LeadsHelpers;

  function ensureStatusOption(selectEl, value, label) {
    if (!selectEl) return;
    const v = String(value || "").trim();
    if (!v) return;

    // Already present?
    for (const opt of Array.from(selectEl.options || [])) {
      if (String(opt.value || "").trim() === v) return;
    }

    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label || v;

    // Put near the top (after the first option if it exists), so it's easy to find.
    if (selectEl.options && selectEl.options.length > 0) {
      selectEl.insertBefore(opt, selectEl.options[1] || null);
    } else {
      selectEl.appendChild(opt);
    }
  }

  function normalizeStatusValue(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    // Accept either form if it came from older data or future code
    if (s.toLowerCase() === "requested_estimate") return "Requested Estimate";
    return s;
  }

  async function render() {
    statusEl.textContent = "Loading...";
    tbody.innerHTML = "";

    try {
      const [techsData, leadsData] = await Promise.all([
        window.Api.fetchJson("/api/techs"),
        window.Api.fetchJson("/api/leads"),
      ]);
      const techs = techsData.techs || [];
      const leads = leadsData.leads || [];
      statusEl.textContent = `Loaded ${leads.length} lead(s).`;

      for (const lead of leads) {
        const tr = document.createElement("tr");

        // --- Status select (PATCH: add Requested Estimate) ---
        const statusSelect = H.makeStatusSelect(normalizeStatusValue(lead.status));
        ensureStatusOption(statusSelect, "Requested Estimate", "Requested Estimate");

        // If the sheet already has requested_estimate, force select to show the label form
        if (String(lead.status || "").toLowerCase().trim() === "requested_estimate") {
          statusSelect.value = "Requested Estimate";
        }

        const dateInput = document.createElement("input");
        dateInput.type = "datetime-local";
        dateInput.value = lead.scheduled_date || "";

        const techSelect = H.makeTechSelect(techs, lead.assigned_to || "");
        const durationInput = H.numInput(lead.duration_minutes, "15");
        const depositReceivedInput = H.numInput(lead.deposit_received, "1");

        const overrideCheck = document.createElement("input");
        overrideCheck.type = "checkbox";
        overrideCheck.checked = lead.deposit_override === true;
        overrideCheck.style.cssText = "width:auto; cursor:pointer;";

        const invoicedInput = H.numInput(lead.invoiced_amount, "0.01");
        const paidInput = H.numInput(lead.paid_amount, "0.01");

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        saveBtn.type = "button";

        const msg = document.createElement("div");
        msg.className = "small muted";
        const warn = document.createElement("div");
        warn.className = "small warn";

        saveBtn.addEventListener("click", async () => {
          msg.textContent = "Saving...";
          warn.textContent = "";
          const wantsSchedule = H.isScheduling(statusSelect.value, dateInput.value, lead.status);

          try {
            let result;
            if (wantsSchedule) {
              const resp = await fetch("/api/leads/schedule", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: lead.id, scheduled_date: dateInput.value,
                  assigned_to: techSelect.value,
                  duration_minutes: Number(durationInput.value || 0),
                  schedule_window: lead.schedule_window || "",
                  schedule_preference: lead.schedule_preference || "",
                  deposit_override: overrideCheck.checked,
                }),
              });
              result = await resp.json();
              if (result.ok) {
                lead.status = "Scheduled";
                statusSelect.value = "Scheduled";
                msg.textContent = "Scheduled";
              }
            } else {
              const resp = await fetch("/api/leads/update", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: lead.id, status: statusSelect.value,
                  scheduled_date: dateInput.value,
                  assigned_to: techSelect.value,
                  duration_minutes: Number(durationInput.value || 0),
                  deposit_received: Number(depositReceivedInput.value || 0),
                  deposit_override: overrideCheck.checked,
                  invoiced_amount: Number(invoicedInput.value || 0),
                  paid_amount: Number(paidInput.value || 0),
                }),
              });
              result = await resp.json();
              if (result.ok) {
                lead.status = statusSelect.value;
                msg.textContent = "Saved";
              }
            }
            if (!result.ok) {
              H.handleApiError(result, warn);
              msg.textContent = "";
            }
          } catch (e) { msg.textContent = "ERROR: " + e.message; }
        });

        tr.innerHTML = `
          <td>${H.esc(lead.id)}</td>
          <td>${H.esc(lead.created_at)}</td>
          <td>${H.esc(lead.name || '(No name)')}</td>
          <td>${H.esc(lead.phone)}</td>
          <td>${H.esc(lead.job_type)}</td>
          <td>${H.esc(String(lead.deposit_required))}</td>
          <td></td><td>${H.esc(String(lead.estimated_value))}</td>
          <td></td><td></td><td></td><td></td><td></td>
          <td></td><td></td>
          <td>${H.esc(lead.invoice_date)}</td>
          <td>${H.esc(lead.paid_date)}</td>
          <td>
            <a href="/crm/lead?id=${encodeURIComponent(lead.id)}" style="color:hsl(var(--primary));font-weight:600;">View</a>
            ${lead.gcal_event_id ? `<a class="gcal-lead-dot" href="/crm/settings?tab=gcal" title="Synced to Google Calendar">📅</a>` : ""}
          </td>
          <td></td>
        `;

        tr.children[6].appendChild(depositReceivedInput);
        tr.children[8].appendChild(statusSelect);
        tr.children[9].appendChild(dateInput);
        tr.children[10].appendChild(techSelect);
        tr.children[11].appendChild(durationInput);
        tr.children[12].appendChild(overrideCheck);
        tr.children[13].appendChild(invoicedInput);
        tr.children[14].appendChild(paidInput);

        const suggestMsg = document.createElement("span");
        suggestMsg.className = "small muted";
        const suggestBtn = window.ScheduleSuggest.createSuggestBtn({
          getDate: () => dateInput.value || "",
          getDuration: () => Number(durationInput.value || 60),
          getPreference: () => lead.schedule_preference || "",
          setMsg: (t) => { suggestMsg.textContent = t; },
          appendEl: (el) => { suggestMsg.appendChild(el); },
          onApply: (techId, startTime) => {
            dateInput.value = startTime;
            techSelect.value = techId;
          },
        });

        const actions = document.createElement("div");
        actions.className = "row-actions";
        actions.appendChild(saveBtn);
        actions.appendChild(suggestBtn);
        const stack = document.createElement("div");
        stack.className = "stack";
        stack.appendChild(msg);
        stack.appendChild(warn);
        stack.appendChild(suggestMsg);
        actions.appendChild(stack);
        tr.children[18].appendChild(actions);
        tbody.appendChild(tr);
      }
    } catch (err) { statusEl.textContent = "ERROR: " + err.message; }
  }

  refreshBtn.addEventListener("click", render);
  render();
})();