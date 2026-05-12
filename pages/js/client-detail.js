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

  const TABS = ["Timeline", "Overview", "Requests", "Quotes", "Jobs", "Invoices", "Notes", "Photos"];

  const pathParts = window.location.pathname.split("/clients/");
  const clientId = pathParts[1] ? decodeURIComponent(pathParts[1]) : "";

  let clientData = null;
  let requestsData = [];
  let quotesData = [];
  let jobsData = [];
  let notesData = [];
  let attachmentsData = [];
  let invoicesData = [];
  let timelineData = null;
  let activeTab = "Timeline";

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
      case "Timeline":
        el.innerHTML = renderTimeline();
        break;
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
        el.innerHTML = renderInvoices();
        attachInvoiceTabHandlers();
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

  const TIMELINE_ICON = {
    request: { emoji: "R",  color: "hsl(217,91%,60%)" },
    quote:   { emoji: "$",  color: "hsl(38,80%,50%)" },
    booking: { emoji: "B",  color: "hsl(270,50%,55%)" },
    job:     { emoji: "J",  color: "hsl(142,50%,45%)" },
    invoice: { emoji: "I",  color: "hsl(270,50%,55%)" },
    payment: { emoji: "P",  color: "hsl(142,70%,40%)" },
  };

  const TIMELINE_STATUS_LABEL = {
    draft: "Draft", sent: "Sent", deposit_received: "Deposit Received",
    partial: "Partial", paid: "Paid", void: "Void", recorded: "Recorded",
    complete: "Complete", complete_invoiced: "Invoiced", active: "Active",
    in_progress: "In Progress", scheduled: "Scheduled",
  };

  function tlStatusBadge(status) {
    const label = TIMELINE_STATUS_LABEL[String(status || "").toLowerCase()] || (status || "");
    const colors = {
      paid: "background:#d1fae5;color:#065f46;",
      recorded: "background:#d1fae5;color:#065f46;",
      draft: "background:#e5e7eb;color:#374151;",
      sent: "background:#dbeafe;color:#1d4ed8;",
      partial: "background:#fef3c7;color:#92400e;",
      deposit_received: "background:#ede9fe;color:#5b21b6;",
      void: "background:#fee2e2;color:#991b1b;",
      complete: "background:#d1fae5;color:#065f46;",
      active: "background:#dbeafe;color:#1d4ed8;",
      in_progress: "background:#dbeafe;color:#1d4ed8;",
      scheduled: "background:#dbeafe;color:#1d4ed8;",
    };
    const style = colors[String(status || "").toLowerCase()] || "background:#e5e7eb;color:#374151;";
    return '<span style="' + style + 'display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">' + esc(label) + '</span>';
  }

  function renderTimeline() {
    if (!timelineData) {
      return '<div class="cd-empty">Loading timeline…</div>';
    }

    const { events, summary } = timelineData;

    // Balance summary bar
    const totalInv = Number(summary.total_invoiced || 0);
    const totalPaid = Number(summary.total_paid || 0);
    const openBal = Number(summary.open_balance || 0);

    let html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">' +
      stat(fmtMoney(totalInv), "Total Invoiced") +
      stat(fmtMoney(totalPaid), "Total Paid") +
      stat('<span style="color:' + (openBal > 0 ? "hsl(38,80%,40%)" : "inherit") + '">' + fmtMoney(openBal) + '</span>', "Open Balance") +
    '</div>';

    if (!events || events.length === 0) {
      html += '<div class="cd-empty">No activity yet.</div>';
      return html;
    }

    html += '<div class="cd-list">';

    for (const ev of events) {
      const icon = TIMELINE_ICON[ev.type] || { emoji: "\u2022", color: "hsl(215,16%,47%)" };
      const date = ev.date ? fmtDate(ev.date) : "\u2014";
      const amount = ev.amount ? fmtMoney(ev.amount) : "";

      // Tri-state sync badge for invoices (Synced / Pending / Error)
      let syncBadge = "";
      if (ev.type === "invoice") {
        const ss = ev.sync_state || (ev.provider_ref ? "synced" : "pending");
        if (ss === "synced") {
          syncBadge = '<span style="font-size:10px;background:#d1fae5;color:#065f46;border-radius:10px;padding:1px 7px;font-weight:700;margin-left:6px;">Synced</span>';
        } else if (ss === "error") {
          syncBadge = '<span style="font-size:10px;background:#fee2e2;color:#991b1b;border-radius:10px;padding:1px 7px;font-weight:700;margin-left:6px;">Error</span>';
        } else {
          syncBadge = '<span style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:10px;padding:1px 7px;font-weight:700;margin-left:6px;">Pending</span>';
        }
      }

      // Extra sub-line detail
      let detail = "";
      if (ev.type === "invoice" && Number(ev.balance_due || 0) > 0) {
        detail = " \u00b7 Bal: " + fmtMoney(ev.balance_due);
      }
      if (ev.type === "payment" && ev.reference) {
        detail = " \u00b7 Ref: " + ev.reference;
      }
      if (ev.type === "job" && ev.completed_at) {
        detail = " \u00b7 Done " + fmtShortDate(ev.completed_at);
      }
      if (ev.type === "booking" && ev.assigned_to) {
        detail = " \u00b7 Tech: " + ev.assigned_to;
      }

      // Wrap in anchor tag if the event has a navigable link
      const isLink = ev.link && ev.link !== "null";
      const wrapOpen = isLink
        ? '<a href="' + esc(ev.link) + '" class="cd-list-item" style="align-items:flex-start;gap:12px;text-decoration:none;color:inherit;display:flex;">'
        : '<div class="cd-list-item" style="align-items:flex-start;gap:12px;">';
      const wrapClose = isLink ? '</a>' : '</div>';

      html +=
        wrapOpen +
          '<div style="flex-shrink:0;width:34px;height:34px;border-radius:50%;background:' + icon.color + '18;border:1.5px solid ' + icon.color + '44;display:flex;align-items:center;justify-content:center;font-size:15px;margin-top:2px;">' + icon.emoji + '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:600;">' + esc(ev.label) + syncBadge + '</div>' +
            '<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-top:2px;">' + esc(date) + (detail ? esc(detail) : "") + '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            (amount ? '<div style="font-size:13px;font-weight:700;">' + amount + '</div>' : '') +
            '<div style="margin-top:3px;">' + tlStatusBadge(ev.status) + '</div>' +
          '</div>' +
        wrapClose;
    }

    html += '</div>';
    return html;
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
      stat(String(invoicesData.length), "Invoices") +
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
    return quotesData.map(function (q) {
      const title = q.service_key || q.id || "Quote";
      const meta = [fmtShortDate(q.created_at), q.quoted_price ? fmtMoney(q.quoted_price) : ""].filter(Boolean).join(" \u00b7 ");
      const body =
        (q.id && q.id !== q.service_key ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Quote ID</span><span class="cd-acc-row-val" style="font-family:monospace;font-size:12px;">' + esc(q.id) + "</span></div>" : "") +
        (q.service_key ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Service</span><span class="cd-acc-row-val">' + esc(q.service_key) + "</span></div>" : "") +
        (q.quoted_price ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Price</span><span class="cd-acc-row-val">' + fmtMoney(q.quoted_price) + "</span></div>" : "") +
        '<div class="cd-acc-row"><span class="cd-acc-row-label">Created</span><span class="cd-acc-row-val">' + fmtDate(q.created_at) + "</span></div>";
      return (
        '<div class="cd-acc">' +
          '<button class="cd-acc-hdr is-open" aria-expanded="true">' +
            '<div class="cd-acc-summary">' +
              '<span class="cd-acc-title">' + esc(title) + "</span>" +
              (meta ? '<span class="cd-acc-meta">' + meta + "</span>" : "") +
            "</div>" +
            '<div class="cd-acc-right">' + statusBadge(q.status_code) + '<span class="cd-acc-chevron">&#9660;</span></div>' +
          "</button>" +
          '<div class="cd-acc-body open" role="region">' + body + "</div>" +
        "</div>"
      );
    }).join("");
  }

  const JOB_STATUS_COLORS = {
    new:               { bg: "hsl(220,15%,88%)", color: "hsl(220,10%,35%)" },
    awaiting_response: { bg: "hsl(220,15%,88%)", color: "hsl(220,10%,35%)" },
    scheduled:         { bg: "hsl(214,90%,90%)", color: "hsl(217,70%,35%)" },
    in_progress:       { bg: "hsl(214,90%,90%)", color: "hsl(217,70%,35%)" },
    awaiting_payment:  { bg: "hsl(40,90%,88%)",  color: "hsl(38,70%,30%)"  },
    complete:          { bg: "hsl(142,60%,88%)",  color: "hsl(142,50%,28%)" },
    complete_invoiced: { bg: "hsl(142,60%,88%)",  color: "hsl(142,50%,28%)" },
    overdue:           { bg: "hsl(0,80%,90%)",    color: "hsl(0,65%,38%)"   },
    cancelled:         { bg: "hsl(0,10%,88%)",    color: "hsl(0,5%,40%)"    },
  };

  const JOB_STATUS_LABELS = {
    new:               "New",
    awaiting_response: "Awaiting Response",
    scheduled:         "Scheduled",
    in_progress:       "In Progress",
    awaiting_payment:  "Awaiting Payment",
    complete:          "Complete",
    complete_invoiced: "Invoiced",
    overdue:           "Overdue",
    cancelled:         "Cancelled",
  };

  function renderJobs() {
    if (!jobsData.length) return '<div class="cd-empty">No jobs on file yet.</div>';

    const clientName = (clientData && clientData.name) ? clientData.name : "";

    const rows = jobsData.map(function (j) {
      const jId    = j.id || "";
      const desc   = j.job_description || j.description || j.notes || j.job_type || "\u2014";
      const status = (j.status_code || j.status || "").toLowerCase();
      const sc     = JOB_STATUS_COLORS[status] || { bg: "hsl(220,15%,20%)", color: "hsl(220,15%,70%)" };
      const slabel = JOB_STATUS_LABELS[status] || j.status_code || j.status || "Unknown";
      const val    = Number(j.quoted_price || j.estimated_value || 0);
      const valStr = val > 0 ? fmtMoney(val) : "";
      const dateShort = fmtShortDate(j.created_at || j.scheduled_date);
      const shortDesc = desc.length > 45 ? desc.slice(0, 43) + "\u2026" : desc;

      // Summary line: Name • Date • Job desc  (matching the reference design)
      const bulletParts = [clientName, dateShort, shortDesc].filter(Boolean);
      const summaryText = bulletParts.join(" \u2022 ");

      // Expanded body
      const body =
        '<div class="cd-acc-row"><span class="cd-acc-row-label">Status</span>' +
          '<span class="cd-acc-row-val"><span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;background:' + sc.bg + ';color:' + sc.color + ';">' + esc(slabel) + '</span></span>' +
        '</div>' +
        (val > 0 ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Estimated Value</span><span class="cd-acc-row-val">' + esc(valStr) + '</span></div>' : '') +
        (j.notes && j.notes !== desc ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Notes</span><span class="cd-acc-row-val" style="max-width:200px;white-space:normal;word-break:break-word;">' + esc(j.notes) + '</span></div>' : '') +
        (jId ? '<div class="cd-acc-actions"><a href="/crm/lead?id=' + encodeURIComponent(jId) + '" style="display:inline-block;padding:7px 16px;border-radius:9px;background:hsl(var(--primary));color:#fff;font-size:13px;font-weight:600;text-decoration:none;">Open in CRM &rarr;</a></div>' : '');

      return (
        '<div class="cd-acc" style="margin-bottom:8px;">' +
          '<button class="cd-acc-hdr" aria-expanded="false">' +
            '<div class="cd-acc-summary">' +
              '<span class="cd-acc-title" style="max-width:none;white-space:normal;line-height:1.4;">' + esc(summaryText) + '</span>' +
            '</div>' +
            '<div class="cd-acc-right">' +
              '<span class="cd-acc-chevron">&#9660;</span>' +
            '</div>' +
          '</button>' +
          '<div class="cd-acc-body" role="region">' + body + '</div>' +
        '</div>'
      );
    });

    return (
      rows.join("") +
      '<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-top:10px;">' +
        jobsData.length + " job" + (jobsData.length !== 1 ? "s" : "") + " on file" +
      '</div>'
    );
  }

  const CD_INV_STATUS = {
    draft:            { label: "Draft",            dot: "hsl(220,15%,60%)" },
    sent:             { label: "Sent",             dot: "hsl(221,83%,53%)" },
    deposit_received: { label: "Deposit Received", dot: "hsl(270,50%,50%)" },
    partial:          { label: "Partial",          dot: "hsl(38,80%,45%)"  },
    paid:             { label: "Paid",             dot: "hsl(142,50%,45%)" },
    void:             { label: "Void",             dot: "hsl(0,70%,55%)"   },
  };

  function renderInvoices() {
    const totalBilled = invoicesData.reduce((s, i) => s + Number(i.total || 0), 0);
    const totalPaid   = invoicesData.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const totalBal    = invoicesData.reduce((s, i) => s + Number(i.balance_due || 0), 0);

    const btnStyle = (primary) =>
      "padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;" +
      (primary
        ? "background:hsl(221,83%,53%);color:#fff;"
        : "background:hsl(220,15%,22%);color:hsl(220,15%,80%);border:1px solid hsl(220,15%,30%);");

    let html =
      '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button id="cdInvCreate" style="' + btnStyle(true) + 'padding:8px 16px;font-size:13px;">+ New Invoice</button>' +
      "</div>" +
      (invoicesData.length
        ? '<div class="cd-overview-grid" style="margin-bottom:16px;">' +
            stat(fmtMoney(totalBilled), "Total Billed") +
            stat(fmtMoney(totalPaid),   "Total Paid") +
            stat(fmtMoney(totalBal),    "Balance Due") +
          "</div>"
        : '<div class="cd-empty" style="margin-top:0;">No invoices yet.</div>');

    for (const inv of invoicesData) {
      const sc = (inv.status_code || "").toLowerCase();
      const s = CD_INV_STATUS[sc] || { label: inv.status_code || "Unknown", dot: "hsl(215,16%,47%)" };
      const bal = Number(inv.balance_due || 0);
      const overdue = inv.overdue;
      const canSend = sc === "draft" || sc === "sent";
      const canPay  = sc !== "paid" && sc !== "void" && bal > 0;

      const invNum = esc(inv.invoice_number || inv.id || "Invoice");
      const totalFmt = fmtMoney(inv.total);
      const statusLabel = overdue ? "Overdue" : esc(s.label);
      const dotColor = overdue ? "hsl(0,70%,55%)" : s.dot;

      const body =
        '<div class="cd-acc-row"><span class="cd-acc-row-label">Invoice #</span><span class="cd-acc-row-val" style="font-family:monospace;font-size:12px;">' + invNum + "</span></div>" +
        '<div class="cd-acc-row"><span class="cd-acc-row-label">Total</span><span class="cd-acc-row-val">' + totalFmt + "</span></div>" +
        (bal > 0 ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Balance Due</span><span class="cd-acc-row-val" style="color:hsl(38,80%,40%);">' + fmtMoney(bal) + "</span></div>" : "") +
        (inv.issued_at ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Issued</span><span class="cd-acc-row-val">' + fmtDate(inv.issued_at) + "</span></div>" : "") +
        (inv.due_at ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Due</span><span class="cd-acc-row-val">' + fmtDate(inv.due_at) + "</span></div>" : "") +
        (inv.sent_at ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Sent</span><span class="cd-acc-row-val">' + fmtDate(inv.sent_at) + "</span></div>" : "") +
        (inv.notes ? '<div class="cd-acc-row"><span class="cd-acc-row-label">Notes</span><span class="cd-acc-row-val">' + esc(inv.notes) + "</span></div>" : "") +
        ((canSend || canPay)
          ? '<div class="cd-acc-actions">' +
              (canSend ? '<button class="cd-inv-send" data-id="' + esc(inv.id) + '" style="' + btnStyle(false) + '">Send</button>' : "") +
              (canPay  ? '<button class="cd-inv-pay"  data-id="' + esc(inv.id) + '" style="' + btnStyle(false) + '">Record Payment</button>' : "") +
            "</div>"
          : "");

      html +=
        '<div class="cd-acc">' +
          '<button class="cd-acc-hdr is-open" aria-expanded="true">' +
            '<div class="cd-acc-summary">' +
              '<span class="cd-acc-title">' + invNum + "</span>" +
              '<span class="cd-acc-meta">' + totalFmt + "</span>" +
            "</div>" +
            '<div class="cd-acc-right">' +
              '<span class="cd-status"><span class="cd-dot" style="background:' + dotColor + ';"></span>' + statusLabel + "</span>" +
              '<span class="cd-acc-chevron">&#9660;</span>' +
            "</div>" +
          "</button>" +
          '<div class="cd-acc-body open" role="region">' + body + "</div>" +
        "</div>";
    }

    return html;
  }

  function attachInvoiceTabHandlers() {
    const createBtn = document.getElementById("cdInvCreate");
    if (createBtn) {
      createBtn.onclick = () => openCdCreateInvoiceModal();
    }
    document.querySelectorAll(".cd-inv-send").forEach(btn => {
      btn.onclick = () => sendInvoice(btn.dataset.id);
    });
    document.querySelectorAll(".cd-inv-pay").forEach(btn => {
      btn.onclick = () => {
        const inv = invoicesData.find(i => i.id === btn.dataset.id);
        if (inv) openCdPaymentModal(inv);
      };
    });
  }

  async function reloadInvoices() {
    try {
      const base = "/api/clients/" + encodeURIComponent(clientId);
      const [invR, tlR] = await Promise.all([
        fetchJSON("/api/invoices?client_id=" + encodeURIComponent(clientId)),
        fetchJSON(base + "/timeline").catch(() => ({ ok: false })),
      ]);
      invoicesData = invR.ok ? invR.invoices : [];
      if (tlR.ok) {
        timelineData = { events: tlR.timeline, summary: tlR.summary };
      }
      renderTabContent();
      attachInvoiceTabHandlers();
    } catch {}
  }

  async function sendInvoice(invoiceId) {
    if (!invoiceId) return;
    try {
      const r = await fetch("/api/invoices/" + encodeURIComponent(invoiceId) + "/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (data.ok) {
        await reloadInvoices();
      } else {
        alert("Send failed: " + (data.error || data.message || "Unknown error"));
      }
    } catch (e) {
      alert("Send failed: " + e.message);
    }
  }

  /* ---- Create Invoice Modal (client detail) ---- */
  function ensureCdCreateModal() {
    if (document.getElementById("cdCreateInvModal")) return;
    const div = document.createElement("div");
    div.id = "cdCreateInvModal";
    div.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;";
    div.innerHTML =
      '<div id="cdCreateInvBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);"></div>' +
      '<div style="position:relative;background:hsl(220,10%,13%);border-radius:16px;padding:28px 24px;width:380px;max-width:95vw;box-shadow:0 8px 40px rgba(0,0,0,.5);z-index:1;">' +
        '<h3 style="margin:0 0 18px;font-size:17px;font-weight:700;color:#fff;">New Invoice</h3>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Subtotal ($) *</label>' +
          '<input id="cdCreateSubtotal" type="number" min="0.01" step="0.01" placeholder="0.00" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Tax Rate (%)</label>' +
          '<input id="cdCreateTaxRate" type="number" min="0" step="0.1" value="0" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Due Date</label>' +
          '<input id="cdCreateDueAt" type="date" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:18px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Notes (optional)</label>' +
          '<input id="cdCreateNotes" type="text" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div id="cdCreateErr" style="color:hsl(0,70%,50%);font-size:13px;margin-bottom:8px;display:none;"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="cdCreateCancel" style="padding:8px 16px;border-radius:8px;font-size:13px;background:hsl(220,15%,22%);color:hsl(220,15%,80%);border:1px solid hsl(220,15%,30%);cursor:pointer;">Cancel</button>' +
          '<button id="cdCreateSubmit" style="padding:8px 16px;border-radius:8px;font-size:13px;background:hsl(221,83%,53%);color:#fff;border:none;cursor:pointer;font-weight:600;">Create Invoice</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
  }

  function openCdCreateInvoiceModal() {
    ensureCdCreateModal();
    const modal = document.getElementById("cdCreateInvModal");
    document.getElementById("cdCreateSubtotal").value = "";
    document.getElementById("cdCreateTaxRate").value = "0";
    document.getElementById("cdCreateDueAt").value = "";
    document.getElementById("cdCreateNotes").value = "";
    document.getElementById("cdCreateErr").style.display = "none";
    document.getElementById("cdCreateSubmit").disabled = false;
    document.getElementById("cdCreateSubmit").textContent = "Create Invoice";
    modal.style.display = "flex";

    const close = () => { modal.style.display = "none"; };
    document.getElementById("cdCreateCancel").onclick = close;
    document.getElementById("cdCreateInvBackdrop").onclick = close;

    document.getElementById("cdCreateSubmit").onclick = async () => {
      const subtotal = parseFloat(document.getElementById("cdCreateSubtotal").value);
      const errEl = document.getElementById("cdCreateErr");
      if (!subtotal || subtotal <= 0) {
        errEl.textContent = "Enter a valid subtotal.";
        errEl.style.display = "block";
        return;
      }
      const submitBtn = document.getElementById("cdCreateSubmit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating…";
      errEl.style.display = "none";
      try {
        const r = await fetch("/api/invoices/from-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            customer_name: clientData ? (clientData.name || clientId) : clientId,
            subtotal,
            tax_rate: parseFloat(document.getElementById("cdCreateTaxRate").value) || 0,
            due_at: document.getElementById("cdCreateDueAt").value || "",
            notes: document.getElementById("cdCreateNotes").value.trim(),
          }),
        });
        const data = await r.json();
        if (!data.ok) throw new Error(data.error || data.message || "Create failed");
        close();
        await reloadInvoices();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Invoice";
      }
    };
  }

  /* ---- Payment Modal (client detail) ---- */
  function ensureCdPaymentModal() {
    if (document.getElementById("cdPayModal")) return;
    const div = document.createElement("div");
    div.id = "cdPayModal";
    div.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;";
    div.innerHTML =
      '<div id="cdPayBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);"></div>' +
      '<div style="position:relative;background:hsl(220,10%,13%);border-radius:16px;padding:28px 24px;width:360px;max-width:95vw;box-shadow:0 8px 40px rgba(0,0,0,.5);z-index:1;">' +
        '<h3 id="cdPayTitle" style="margin:0 0 18px;font-size:17px;font-weight:700;color:#fff;">Record Payment</h3>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Amount ($) *</label>' +
          '<input id="cdPayAmount" type="number" min="0.01" step="0.01" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Method</label>' +
          '<select id="cdPayMethod" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;">' +
            '<option value="check">Check</option>' +
            '<option value="cash">Cash</option>' +
            '<option value="card">Card</option>' +
            '<option value="ach">ACH/Bank Transfer</option>' +
            '<option value="deposit">Deposit</option>' +
            '<option value="other">Other</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Reference / Check # (optional)</label>' +
          '<input id="cdPayReference" type="text" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Payment Date</label>' +
          '<input id="cdPayDate" type="date" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
          '<label style="font-size:12px;color:hsl(220,15%,60%);display:block;margin-bottom:4px;">Note (optional)</label>' +
          '<input id="cdPayNote" type="text" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(220,15%,30%);border-radius:8px;font-size:14px;background:hsl(220,14%,8%);color:#fff;" />' +
        '</div>' +
        '<div id="cdPayErr" style="color:hsl(0,70%,50%);font-size:13px;margin-bottom:8px;display:none;"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="cdPayCancel" style="padding:8px 16px;border-radius:8px;font-size:13px;background:hsl(220,15%,22%);color:hsl(220,15%,80%);border:1px solid hsl(220,15%,30%);cursor:pointer;">Cancel</button>' +
          '<button id="cdPaySubmit" style="padding:8px 16px;border-radius:8px;font-size:13px;background:hsl(221,83%,53%);color:#fff;border:none;cursor:pointer;font-weight:600;">Save Payment</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
  }

  function openCdPaymentModal(inv) {
    ensureCdPaymentModal();
    const modal = document.getElementById("cdPayModal");
    document.getElementById("cdPayAmount").value = Number(inv.balance_due || 0).toFixed(2);
    document.getElementById("cdPayMethod").value = "check";
    document.getElementById("cdPayReference").value = "";
    document.getElementById("cdPayDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("cdPayNote").value = "";
    document.getElementById("cdPayErr").style.display = "none";
    document.getElementById("cdPaySubmit").disabled = false;
    document.getElementById("cdPaySubmit").textContent = "Save Payment";
    modal.style.display = "flex";

    const close = () => { modal.style.display = "none"; };
    document.getElementById("cdPayCancel").onclick = close;
    document.getElementById("cdPayBackdrop").onclick = close;

    document.getElementById("cdPaySubmit").onclick = async () => {
      const amount = parseFloat(document.getElementById("cdPayAmount").value);
      const errEl = document.getElementById("cdPayErr");
      if (!amount || amount <= 0) {
        errEl.textContent = "Enter a valid amount.";
        errEl.style.display = "block";
        return;
      }
      const submitBtn = document.getElementById("cdPaySubmit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";
      errEl.style.display = "none";
      try {
        const r = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoice_id: inv.id,
            amount,
            method: document.getElementById("cdPayMethod").value,
            reference: document.getElementById("cdPayReference").value.trim(),
            payment_date: document.getElementById("cdPayDate").value || "",
            note: document.getElementById("cdPayNote").value.trim(),
          }),
        });
        const data = await r.json();
        if (!data.ok) throw new Error(data.error || data.message || "Save failed");
        close();
        await reloadInvoices();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Save Payment";
      }
    };
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

      // Fetch client first so we have the phone number for the leads-by-phone lookup
      const cRes = await fetchJSON(base);
      if (!cRes.ok) return showError("Client not found.");
      clientData = cRes.client;

      const phone = (clientData.phone || "").replace(/\D/g, "");
      const [rRes, qRes, leadsRes, nRes, aRes, invRes, tlRes] = await Promise.all([
        fetchJSON(base + "/requests"),
        fetchJSON(base + "/quotes"),
        phone
          ? fetchJSON("/api/leads?phone=" + encodeURIComponent(phone))
          : Promise.resolve({ ok: true, leads: [] }),
        fetchJSON(base + "/notes"),
        fetchJSON(base + "/attachments"),
        fetchJSON("/api/invoices?client_id=" + encodeURIComponent(clientId)),
        fetchJSON(base + "/timeline").catch(() => ({ ok: false })),
      ]);

      requestsData = rRes.ok ? rRes.requests : [];
      quotesData = qRes.ok ? qRes.quotes : [];
      jobsData = leadsRes.ok ? (leadsRes.leads || []) : [];
      notesData = nRes.ok ? nRes.notes : [];
      attachmentsData = aRes.ok ? aRes.attachments : [];
      invoicesData = invRes.ok ? invRes.invoices : [];
      timelineData = tlRes.ok
        ? { events: tlRes.timeline, summary: tlRes.summary }
        : { events: [], summary: { total_invoiced: 0, total_paid: 0, open_balance: 0 } };

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

      document.getElementById("tabContent").addEventListener("click", function (e) {
        const hdr = e.target.closest(".cd-acc-hdr");
        if (!hdr) return;
        const body = hdr.nextElementSibling;
        if (!body || !body.classList.contains("cd-acc-body")) return;
        const isOpen = body.classList.toggle("open");
        hdr.classList.toggle("is-open", isOpen);
        hdr.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    } catch (err) {
      showError("Error loading client data.");
    }
  }

  async function silentRefresh() {
    if (!clientData) return;
    try {
      const base = "/api/clients/" + encodeURIComponent(clientId);
      const phone = (clientData.phone || "").replace(/\D/g, "");
      const [rRes, qRes, leadsRes, nRes, aRes, invRes, tlRes] = await Promise.all([
        fetchJSON(base + "/requests"),
        fetchJSON(base + "/quotes"),
        phone
          ? fetchJSON("/api/leads?phone=" + encodeURIComponent(phone))
          : Promise.resolve({ ok: true, leads: [] }),
        fetchJSON(base + "/notes"),
        fetchJSON(base + "/attachments"),
        fetchJSON("/api/invoices?client_id=" + encodeURIComponent(clientId)),
        fetchJSON(base + "/timeline").catch(() => ({ ok: false })),
      ]);
      requestsData  = rRes.ok   ? rRes.requests       : requestsData;
      quotesData    = qRes.ok   ? qRes.quotes          : quotesData;
      jobsData      = leadsRes.ok ? (leadsRes.leads || []) : jobsData;
      notesData     = nRes.ok   ? nRes.notes           : notesData;
      attachmentsData = aRes.ok ? aRes.attachments     : attachmentsData;
      invoicesData  = invRes.ok ? invRes.invoices      : invoicesData;
      if (tlRes.ok) {
        timelineData = { events: tlRes.timeline, summary: tlRes.summary };
      }
      renderTabContent();
    } catch (_) {}
  }

  init();
  setInterval(silentRefresh, 60000);
})();