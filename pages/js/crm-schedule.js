// pages/js/crm-schedule.js
// CRM admin schedule view — shows bookings grouped by date and block (Morning/Afternoon).
// Data sources:
//   GET /api/schedule/blocks      — block availability + crew-hours capacity info
//   GET /api/leads?status=Scheduled — leads with scheduled_date + schedule_window
//   GET /api/schedule/bookings    — direct Bookings sheet rows

(function () {
  const BLOCKS = ["Morning", "Afternoon"];
  const WINDOW_LABELS = { Morning: "8 AM – 12 PM", Afternoon: "1 PM – 5 PM" };

  const tz = "America/Chicago";

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + (dateStr.length === 10 ? "T12:00:00" : ""));
      return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
    } catch { return dateStr; }
  }

  function toLocalDate(isoStr) {
    if (!isoStr) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(isoStr));
    } catch { return isoStr.slice(0, 10); }
  }

  function inferBlock(isoStr) {
    if (!isoStr) return "";
    try {
      const hr = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "numeric", hour12: false,
      }).format(new Date(isoStr)));
      return hr < 13 ? "Morning" : "Afternoon";
    } catch { return ""; }
  }

  function statusBadge(status) {
    const clean = String(status || "").toLowerCase().replace(/_/g, " ");
    const color = clean === "confirmed" || clean === "scheduled" ? "#16a34a"
                : clean === "cancelled" ? "#dc2626"
                : "#2563eb";
    return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;background:${color}20;color:${color};text-transform:capitalize;">${esc(clean)}</span>`;
  }

  // Crew-hours progress bar rendered as pure HTML/CSS (no canvas)
  function hoursBar(used, cap) {
    if (!cap) return "";
    const pct     = Math.min(1, used / cap);
    const pctPx   = Math.round(pct * 100);
    const color   = pct >= 0.9 ? "#dc2626" : pct >= 0.7 ? "#f59e0b" : "#16a34a";
    const usedStr = Number.isInteger(used * 10) ? used.toFixed(1) : used.toFixed(1);
    const capStr  = Number.isInteger(cap * 10)  ? cap.toFixed(1)  : cap.toFixed(1);
    return `<span class="sched-hours-bar" title="${usedStr} of ${capStr} crew-hrs used">
      <span class="sched-hours-track">
        <span class="sched-hours-fill" style="width:${pctPx}%;background:${color};"></span>
      </span>
      <span class="sched-hours-label" style="color:${color};">${usedStr}&thinsp;/&thinsp;${capStr} hrs</span>
    </span>`;
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadData() {
    const [blocksResp, leadsResp, bookingsResp] = await Promise.all([
      fetch("/api/schedule/blocks?days=30").then(r => r.json()).catch(() => ({ ok: false })),
      fetch("/api/leads?status=Scheduled").then(r => r.json()).catch(() => ({ ok: false, leads: [] })),
      fetch("/api/schedule/bookings").then(r => r.json()).catch(() => ({ ok: false, bookings: [] })),
    ]);

    // ── Leads (CRM-side scheduled) ───────────────────────────────────────────
    const leads     = (leadsResp.leads || leadsResp.data || []).filter(l => l.status === "Scheduled" && l.scheduled_date);
    const leadsJobs = leads.map(l => ({
      source:           "lead",
      id:               l.id,
      date:             toLocalDate(l.scheduled_date),
      block:            l.schedule_window || inferBlock(l.scheduled_date),
      customer_name:    l.name,
      address:          l.address,
      phone:            l.phone,
      job_type:         l.job_type,
      price:            l.quoted_price,
      status:           l.status,
      assigned_to:      l.assigned_to,
      duration_min:     l.duration_minutes,
      is_continuation:  false,
      booking_group_id: "",
    }));

    // ── Bookings sheet ────────────────────────────────────────────────────────
    const rawBookings = (bookingsResp.bookings || []);
    const bookingJobs = rawBookings
      .filter(b => b.status !== "cancelled")
      .map(b => ({
        source:           "booking",
        id:               b.booking_id,
        date:             toLocalDate(b.scheduled_datetime),
        block:            b.schedule_block || inferBlock(b.scheduled_datetime),
        customer_name:    b.customer_name,
        address:          b.address,
        phone:            b.phone || "",
        job_type:         b.job_type_id || "",
        price:            b.final_price,
        status:           b.status,
        assigned_to:      "",
        duration_min:     b.duration_minutes,
        allocated_min:    b.block_allocated_minutes || b.duration_minutes || "",
        is_continuation:  b.is_continuation === "true",
        booking_group_id: b.booking_group_id || "",
        booking_id:       b.booking_id,
        quote_id:         b.quote_id,
      }));

    // ── Merge, deduplicate ────────────────────────────────────────────────────
    const seen    = new Set();
    const allJobs = [];
    for (const j of [...leadsJobs, ...bookingJobs]) {
      const key = j.id || `${j.date}:${j.customer_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allJobs.push(j);
    }

    // ── Capacity map from blocks endpoint (now includes hours data) ───────────
    const capacityMap = {};
    for (const blk of (blocksResp.blocks || [])) {
      capacityMap[`${blk.date}:${blk.block}`] = {
        capacity:        blk.capacity,
        booked:          blk.booked,
        hours_capacity:  blk.hours_capacity,
        hours_used:      blk.hours_used,
        hours_remaining: blk.hours_remaining,
      };
    }

    return { jobs: allJobs, capacityMap, config: blocksResp.config || {} };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────

  function groupByDateBlock(jobs) {
    const map = {};
    for (const j of jobs) {
      if (!j.date) continue;
      if (!map[j.date]) map[j.date] = {};
      const blk = j.block || "Unscheduled";
      if (!map[j.date][blk]) map[j.date][blk] = [];
      map[j.date][blk].push(j);
    }
    return map;
  }

  function renderJobRow(j) {
    const price    = j.price    ? `$${Number(j.price).toLocaleString()}` : "–";
    // Show block-allocated hours if available; fall back to total duration
    const allocMin = Number(j.allocated_min) || Number(j.duration_min) || 0;
    const durLabel = allocMin ? `${(allocMin / 60).toFixed(1)} hrs` : "–";

    const contBadge = j.is_continuation
      ? `<span title="Continuation of group ${j.booking_group_id}" style="display:inline-block;margin-right:4px;font-size:12px;" aria-label="continuation block">&#128279;</span>`
      : "";

    return `
      <tr${j.is_continuation ? ' style="opacity:0.8;background:#fafafa;"' : ""}>
        <td>${contBadge}${esc(j.customer_name || "–")}</td>
        <td style="font-size:13px;color:#555;">${esc(j.address || "–")}</td>
        <td>${esc(j.job_type || "–")}</td>
        <td>${price}</td>
        <td>${durLabel}</td>
        <td>${esc(j.assigned_to || "–")}</td>
        <td>${statusBadge(j.status)}</td>
      </tr>`;
  }

  function renderDateSection(date, blockGroups, capacityMap) {
    const blockSections = BLOCKS.map(block => {
      const jobs   = blockGroups[block] || [];
      const capKey = `${date}:${block}`;
      const cap    = capacityMap[capKey];

      // Headcount badge
      const countBadge = cap
        ? `<span style="font-size:11px;font-weight:600;color:#888;margin-left:6px;">${cap.booked}/${cap.capacity} jobs</span>`
        : "";

      // Crew-hours load bar (only if hours data is available)
      const hoursBadge = (cap && cap.hours_capacity != null)
        ? hoursBar(cap.hours_used || 0, cap.hours_capacity)
        : "";

      const jobRows = jobs.length > 0
        ? jobs.map(renderJobRow).join("")
        : `<tr><td colspan="7" style="text-align:center;color:#aaa;font-style:italic;padding:10px;">No bookings</td></tr>`;

      return `
        <div class="sched-block-section">
          <div class="sched-block-heading">
            ${block === "Morning" ? "&#9728;" : "&#9734;"}
            ${block}
            <span class="sched-block-window">${WINDOW_LABELS[block] || ""}</span>
            ${countBadge}
            ${hoursBadge}
          </div>
          <table class="sched-table">
            <thead>
              <tr>
                <th>Customer</th><th>Address</th><th>Service</th>
                <th>Price</th><th>Time</th><th>Assigned</th><th>Status</th>
              </tr>
            </thead>
            <tbody>${jobRows}</tbody>
          </table>
        </div>`;
    }).join("");

    const unscheduled = blockGroups["Unscheduled"] || [];
    const unschBlock  = unscheduled.length > 0 ? `
      <div class="sched-block-section">
        <div class="sched-block-heading" style="color:#888;">&#9685; Unscheduled</div>
        <table class="sched-table">
          <thead><tr><th>Customer</th><th>Address</th><th>Service</th><th>Price</th><th>Time</th><th>Assigned</th><th>Status</th></tr></thead>
          <tbody>${unscheduled.map(renderJobRow).join("")}</tbody>
        </table>
      </div>` : "";

    return `
      <div class="sched-date-card">
        <div class="sched-date-heading">${esc(fmtDate(date))}</div>
        ${blockSections}
        ${unschBlock}
      </div>`;
  }

  // ── Main ──────────────────────────────────────────────────────────────────────

  let allJobs    = [];
  let capacityMap = {};

  async function refresh() {
    const statusEl  = document.getElementById("status");
    const container = document.getElementById("schedContainer");
    if (statusEl)   statusEl.textContent = "Loading…";
    if (container)  container.innerHTML  = "";

    try {
      const data  = await loadData();
      allJobs     = data.jobs;
      capacityMap = data.capacityMap;
      renderSchedule();
      if (statusEl) statusEl.textContent = `${allJobs.length} booking(s) loaded.`;
    } catch (err) {
      if (statusEl) statusEl.textContent = "Error: " + err.message;
      console.error("[crm-schedule]", err);
    }
  }

  function renderSchedule() {
    const container = document.getElementById("schedContainer");
    if (!container) return;

    const dateFilter = document.getElementById("date")?.value || "";
    const filtered   = dateFilter ? allJobs.filter(j => j.date === dateFilter) : allJobs;

    if (!filtered.length) {
      container.innerHTML = `<p style="color:#888;margin-top:24px;">No scheduled bookings${dateFilter ? " for " + dateFilter : ""}.</p>`;
      return;
    }

    const grouped     = groupByDateBlock(filtered);
    const sortedDates = Object.keys(grouped).sort();
    container.innerHTML = sortedDates.map(date => renderDateSection(date, grouped[date], capacityMap)).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    document.getElementById("refreshBtn")?.addEventListener("click", refresh);
    document.getElementById("date")?.addEventListener("change", renderSchedule);

    // Default date input to today
    const dateInput = document.getElementById("date");
    if (dateInput && !dateInput.value) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      dateInput.value = today;
    }
  });
})();
