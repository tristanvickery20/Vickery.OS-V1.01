// pages/js/crm-schedule.js
// CRM admin schedule view — shows bookings grouped by date and block (Morning/Afternoon).
// Data sources:
//   GET /api/schedule/blocks  — block availability + capacity info
//   GET /api/leads?status=Scheduled — leads with scheduled_date + schedule_window

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

  // ── Data loading ─────────────────────────────────────────────────────────────

  // Load Bookings from the Leads endpoint (status=Scheduled) + Bookings from the
  // schedule/blocks endpoint.  We combine both sources into a unified job list.
  async function loadData(dateFilter) {
    const [blocksResp, leadsResp] = await Promise.all([
      fetch("/api/schedule/blocks?days=30").then(r => r.json()).catch(() => ({ ok: false })),
      fetch("/api/leads?status=Scheduled").then(r => r.json()).catch(() => ({ ok: false, leads: [] })),
    ]);

    // Bookings from Leads (CRM-side: booked via leads-schedule)
    const leads   = (leadsResp.leads || leadsResp.data || []).filter(l => l.status === "Scheduled" && l.scheduled_date);
    const leadsJobs = leads.map(l => ({
      source:        "lead",
      id:            l.id,
      date:          toLocalDate(l.scheduled_date),
      block:         l.schedule_window || inferBlock(l.scheduled_date),
      customer_name: l.name,
      address:       l.address,
      phone:         l.phone,
      job_type:      l.job_type,
      price:         l.quoted_price,
      status:        l.status,
      assigned_to:   l.assigned_to,
      duration_min:  l.duration_minutes,
    }));

    // Bookings from quote flow (Bookings sheet — accessed via blocks endpoint embedded)
    // Note: the blocks endpoint returns capacity info but not individual bookings.
    // We load bookings separately via the admin endpoint.
    const blocksBookingsResp = await fetch("/api/schedule/bookings").then(r => r.json()).catch(() => ({ ok: false, bookings: [] }));
    const rawBookings  = blocksBookingsResp.bookings || [];
    const bookingJobs  = rawBookings
      .filter(b => b.status !== "cancelled")
      .map(b => ({
        source:        "booking",
        id:            b.booking_id,
        date:          toLocalDate(b.scheduled_datetime),
        block:         b.schedule_block || inferBlock(b.scheduled_datetime),
        customer_name: b.customer_name,
        address:       b.address,
        phone:         b.phone || "",
        job_type:      b.job_type_id || "",
        price:         b.final_price,
        status:        b.status,
        assigned_to:   "",
        duration_min:  b.duration_minutes,
        booking_id:    b.booking_id,
        quote_id:      b.quote_id,
      }));

    // Merge, deduplicate by booking_id (leads first — richer data)
    const seen = new Set();
    const allJobs = [];
    for (const j of [...leadsJobs, ...bookingJobs]) {
      const key = j.id || `${j.date}:${j.customer_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allJobs.push(j);
    }

    // Capacity map from blocks endpoint
    const capacityMap = {};
    for (const blk of (blocksResp.blocks || [])) {
      capacityMap[`${blk.date}:${blk.block}`] = { capacity: blk.capacity, booked: blk.booked };
    }

    return { jobs: allJobs, capacityMap };
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
    const price = j.price ? `$${Number(j.price).toLocaleString()}` : "–";
    const dur   = j.duration_min ? `${j.duration_min} min` : "–";
    return `
      <tr>
        <td>${esc(j.customer_name || "–")}</td>
        <td style="font-size:13px;color:#555;">${esc(j.address || "–")}</td>
        <td>${esc(j.job_type || "–")}</td>
        <td>${price}</td>
        <td>${dur}</td>
        <td>${esc(j.assigned_to || "–")}</td>
        <td>${statusBadge(j.status)}</td>
      </tr>`;
  }

  function renderDateSection(date, blockGroups, capacityMap) {
    const blockSections = BLOCKS.map(block => {
      const jobs = blockGroups[block] || [];
      const capKey = `${date}:${block}`;
      const cap    = capacityMap[capKey];
      const capBadge = cap
        ? `<span style="font-size:11px;font-weight:600;color:#888;margin-left:8px;">${cap.booked}/${cap.capacity} booked</span>`
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
            ${capBadge}
          </div>
          <table class="sched-table">
            <thead>
              <tr>
                <th>Customer</th><th>Address</th><th>Service</th>
                <th>Price</th><th>Duration</th><th>Assigned</th><th>Status</th>
              </tr>
            </thead>
            <tbody>${jobRows}</tbody>
          </table>
        </div>`;
    }).join("");

    const unscheduled = blockGroups["Unscheduled"] || [];
    const unschBlock = unscheduled.length > 0 ? `
      <div class="sched-block-section">
        <div class="sched-block-heading" style="color:#888;">&#9685; Unscheduled Block</div>
        <table class="sched-table">
          <thead><tr><th>Customer</th><th>Address</th><th>Service</th><th>Price</th><th>Duration</th><th>Assigned</th><th>Status</th></tr></thead>
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
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Loading…";
    const container = document.getElementById("schedContainer");
    if (container) container.innerHTML = "";

    try {
      const data = await loadData();
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

    // Date filter
    const dateFilter = document.getElementById("date")?.value || "";
    const filtered   = dateFilter ? allJobs.filter(j => j.date === dateFilter) : allJobs;

    if (!filtered.length) {
      container.innerHTML = `<p style="color:#888;margin-top:24px;">No scheduled bookings${dateFilter ? " for " + dateFilter : ""}.</p>`;
      return;
    }

    const grouped = groupByDateBlock(filtered);
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
