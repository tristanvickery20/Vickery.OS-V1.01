// /pages/js/client-detail.js
(() => {
  const STATUS_MAP = {
    active: { label: "Active", dot: "hsl(221,83%,53%)" },
    awaiting_response: { label: "Awaiting Response", dot: "hsl(215,16%,47%)" },
    scheduled: { label: "Scheduled", dot: "hsl(221,83%,53%)" },
    in_progress: { label: "In Progress", dot: "hsl(221,83%,53%)" },
    awaiting_payment: { label: "Awaiting Payment", dot: "hsl(40,95%,50%)" },
    overdue: { label: "Overdue", dot: "hsl(0,84%,60%)" },
  };

  const TABS = ["Overview", "Requests", "Quotes", "Jobs", "Invoices", "Notes", "Photos"];

  const pathParts = window.location.pathname.split("/clients/");
  const clientId = pathParts[1] ? decodeURIComponent(pathParts[1]) : "";

  let clientData = null;
  let requestsData = [];
  let quotesData = [];
  let jobsData = [];
  let notesData = [];
  let attachmentsData = [];
  let activeTab = "Overview";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDate(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function fmtShortDate(iso) {
    if (!iso) return "\u2014";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[d.getMonth()] + " " + d.getDate();
  }

  function fmtMoney(val) {
    const n = Number(val);
    if (val === "" || val == null || isNaN(n)) return "\u2014";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusBadge(code) {
    const s = STATUS_MAP[(code || "").toLowerCase()] || { label: code || "Unknown", dot: "hsl(215,16%,47%)" };
    return (
      '<span class="cd-status"><span class="cd-dot" style="background:' +
      s.dot +
      '"></span>' +
      esc(s.label) +
      "</span>"
    );
  }

  function addrOneLine(prop) {
    if (!prop) return "";
    const parts = [prop.address_line1];
    if (prop.address_line2) parts.push(prop.address_line2);
    parts.push([prop.city, prop.state].filter(Boolean).join(", "));
    if (prop.zip) parts[parts.length - 1] += " " + prop.zip;
    return parts.filter(Boolean).join(", ");
  }

  function mapsUrl(prop) {
    if (!prop) return "#";
    return "https://maps.google.com/?q=" + encodeURIComponent(addrOneLine(prop));
  }

  function getPhotos() {
    return (attachmentsData || []).filter(function (a) {
      const cat = String(a.category || "").toLowerCase();
      const ft = String(a.file_type || "").toLowerCase();
      return ft === "image" || cat === "before" || cat === "after" || cat === "general";
    });
  }

  function renderHeader() {
    const c = clientData;
    document.getElementById("clientName").textContent = c.name || "Client";
    document.title = (c.name || "Client") + " \u2022 Vickery CRM";
    document.getElementById("clientSub").textContent = addrOneLine(c.primary_property) || "\u2014";
  }

  function renderActions() {
    const c = clientData;
    let html = "";

    if (c.phone) {
      html += '<a href="tel:' + esc(c.phone) + '" class="cd-action">Call</a>';
      html += '<a href="sms:' + esc(c.phone) + '" class="cd-action">Text</a>';
    }
    if (c.email) {
      html += '<a href="mailto:' + esc(c.email) + '" class="cd-action">Email</a>';
    }

    html += '<a href="/quote" class="cd-action">Create Quote</a>';
    html += '<a href="/crm/new" class="cd-action">Create Job</a>';
    html += '<a href="/crm/schedule" class="cd-action">Schedule Visit</a>';

    document.getElementById("quickActions").innerHTML = html;
  }

  function renderCards() {
    const c = clientData;
    const prop = c.primary_property;
    let html = "";

    // Property card
    html += '<div class="cd-card"><div class="cd-card-title">Property Address</div><div class="cd-card-body">';
    if (prop) {
      html += esc(prop.address_line1 || "") + "<br>";
      if (prop.address_line2) html += esc(prop.address_line2) + "<br>";
      html += esc([prop.city, prop.state].filter(Boolean).join(", "));
      if (prop.zip) html += " " + esc(prop.zip);
      html += '<br><a href="' + esc(mapsUrl(prop)) + '" target="_blank" rel="noopener">Directions \u2192</a>';
    } else {
      html += '<span style="color:hsl(var(--muted-foreground))">No property on file.</span>';
    }
    html += "</div></div>";

    // Contact card
    html += '<div class="cd-card"><div class="cd-card-title">Contact Info</div><div class="cd-card-body">';
    html += "<div>" + (c.phone ? esc(c.phone) : "No phone") + "</div>";
    html += "<div>" + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "No email") + "</div>";
    const smsYes = c.sms_opt_in === "true" || c.sms_opt_in === "1" || c.sms_opt_in === "yes";
    html += '<div style="margin-top:4px;font-size:13px;color:hsl(var(--muted-foreground))">SMS: ' + (smsYes ? "Yes" : "No") + "</div>";
    html += "</div></div>";

    // Job description card
    html += '<div class="cd-card"><div class="cd-card-title">Job Description</div><div class="cd-card-body">';
    html += c.job_description ? esc(c.job_description) : '<span style="color:hsl(var(--muted-foreground))">No description yet.</span>';
    html += "</div></div>";

    document.getElementById("cards").innerHTML = html;
  }

  function renderTabs() {
    document.getElementById("tabs").innerHTML = TABS.map(function (t) {
      return (
        '<button class="cd-tab' +
        (t === activeTab ? " cd-tab-active" : "") +
        '" data-tab="' +
        t +
        '">' +
        t +
        "</button>"
      );
    }).join("");
  }

  function renderTabContent() {
    const el = document.getElementById("tabContent");
    switch (activeTab) {
      case "Overview":
        el.innerHTML = renderOverview();
        break;
      case "Requests":
        el.innerHTML = renderRequests();
        break;
      case "Quotes":
        el.innerHTML = renderQuotes();
        break;
      case "Jobs":
        el.innerHTML = renderJobs();
        break;
      case "Invoices":
        el.innerHTML = '<div class="cd-empty">Invoices coming later.</div>';
        break;
      case "Notes":
        el.innerHTML = renderNotes();
        break;
      case "Photos":
        el.innerHTML = renderPhotos();
        break;
      default:
        el.innerHTML = "";
    }
  }

  function stat(val, label) {
    return '<div class="cd-stat"><div class="cd-stat-val">' + val + '</div><div class="cd-stat-label">' + esc(label) + "</div></div>";
  }

  function renderOverview() {
    const c = clientData;
    const photos = getPhotos();
    return (
      '<div class="cd-overview-grid">' +
      stat(statusBadge(c.status_code), "Status") +
      stat(fmtShortDate(c.last_activity_at), "Last Activity") +
      stat(fmtShortDate(c.created_at), "Created") +
      stat(String(requestsData.length), "Requests") +
      stat(String(quotesData.length), "Quotes") +
      stat(String(jobsData.length), "Jobs") +
      stat(String(notesData.length), "Notes") +
      stat(String(photos.length), "Photos") +
      "</div>"
    );
  }

  function renderRequests() {
    if (!requestsData.length) return '<div class="cd-empty">No requests yet.</div>';
    return (
      '<div class="cd-list">' +
      requestsData
        .map(function (r) {
          return (
            '<div class="cd-list-item">' +
            '<div class="cd-list-main">' +
            '<div class="cd-list-title">' +
            esc(r.summary || r.id) +
            "</div>" +
            '<div class="cd-list-sub">' +
            fmtShortDate(r.created_at) +
            (r.estimated_value ? " \u00b7 Est. " + fmtMoney(r.estimated_value) : "") +
            "</div>" +
            "</div>" +
            '<div class="cd-list-right">' +
            statusBadge(r.status_code) +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderQuotes() {
    if (!quotesData.length) return '<div class="cd-empty">No quotes yet.</div>';
    return (
      '<div class="cd-list">' +
      quotesData
        .map(function (q) {
          const line =
            fmtShortDate(q.created_at) +
            (q.quoted_price ? " \u00b7 " + fmtMoney(q.quoted_price) : "") +
            (q.service_key ? " \u00b7 " + esc(q.service_key) : "");
          return (
            '<div class="cd-list-item">' +
            '<div class="cd-list-main">' +
            '<div class="cd-list-title">' +
            esc(q.id || "Quote") +
            "</div>" +
            '<div class="cd-list-sub">' +
            line +
            "</div>" +
            "</div>" +
            '<div class="cd-list-right">' +
            statusBadge(q.status_code) +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderJobs() {
    if (!jobsData.length) return '<div class="cd-empty">No jobs yet.</div>';
    return (
      '<div class="cd-list">' +
      jobsData
        .map(function (j) {
          const line =
            fmtShortDate(j.created_at) + (j.completed_at ? " \u00b7 Done " + fmtShortDate(j.completed_at) : "");
          return (
            '<div class="cd-list-item">' +
            '<div class="cd-list-main">' +
            '<div class="cd-list-title">' +
            esc(j.description || j.id || "Job") +
            "</div>" +
            '<div class="cd-list-sub">' +
            line +
            "</div>" +
            "</div>" +
            '<div class="cd-list-right">' +
            statusBadge(j.status_code) +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderNotes() {
    if (!notesData.length) return '<div class="cd-empty">No notes yet.</div>';
    return (
      '<div class="cd-list">' +
      notesData
        .map(function (n) {
          return (
            '<div class="cd-list-item">' +
            '<div class="cd-list-main">' +
            '<div class="cd-list-title">' +
            esc(n.author || "Unknown") +
            " \u00b7 " +
            fmtShortDate(n.created_at) +
            "</div>" +
            '<div class="cd-note-body">' +
            esc(n.body) +
            "</div>" +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderPhotos() {
    const photos = getPhotos();
    if (!photos.length) return '<div class="cd-empty">No photos yet.</div>';

    return (
      '<div class="cd-photos">' +
      photos
        .map(function (p) {
          const url = p.file_url || "";
          const cat = p.category || "general";
          // Ticket 12: clicking opens in new tab (lightbox comes in Ticket 13)
          return (
            '<a class="cd-photo-tile" href="' +
            esc(url) +
            '" target="_blank" rel="noopener">' +
            '<img src="' +
            esc(url) +
            '" alt="' +
            esc(cat) +
            '" loading="lazy" />' +
            '<span class="cd-photo-badge">' +
            esc(cat) +
            "</span>" +
            "</a>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function showError(msg) {
    document.getElementById("loadingMsg").style.display = "none";
    document.getElementById("clientContent").style.display = "none";
    const el = document.getElementById("errorMsg");
    el.style.display = "block";
    el.innerHTML =
      '<h2 style="margin-bottom:8px;">' + esc(msg) + '</h2><a href="/clients" class="cd-back">&larr; Back to Clients</a>';
  }

  async function fetchJSON(u) {
    const r = await fetch(u, { cache: "no-store" });
    return r.json();
  }

  async function init() {
    if (!clientId) return showError("No client ID provided.");

    try {
      const base = "/api/clients/" + encodeURIComponent(clientId);
      const [cRes, rRes, qRes, jRes, nRes, aRes] = await Promise.all([
        fetchJSON(base),
        fetchJSON(base + "/requests"),
        fetchJSON(base + "/quotes"),
        fetchJSON(base + "/jobs"),
        fetchJSON(base + "/notes"),
        fetchJSON(base + "/attachments"),
      ]);

      if (!cRes.ok) return showError("Client not found.");

      clientData = cRes.client;
      requestsData = rRes.ok ? rRes.requests : [];
      quotesData = qRes.ok ? qRes.quotes : [];
      jobsData = jRes.ok ? jRes.jobs : [];
      notesData = nRes.ok ? nRes.notes : [];
      attachmentsData = aRes.ok ? aRes.attachments : [];

      document.getElementById("loadingMsg").style.display = "none";
      document.getElementById("clientContent").style.display = "block";

      renderHeader();
      renderActions();
      renderCards();
      renderTabs();
      renderTabContent();

      document.getElementById("tabs").addEventListener("click", function (e) {
        const btn = e.target.closest(".cd-tab");
        if (!btn) return;
        activeTab = btn.dataset.tab;
        renderTabs();
        renderTabContent();
      });
    } catch (err) {
      showError("Error loading client data.");
    }
  }

  init();
})();