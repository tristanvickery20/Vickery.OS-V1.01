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
  let invoicesData = [];
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

    const actionBarStyle = "display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;";
    const btnStyle = (primary) =>
      "padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;" +
      (primary
        ? "background:hsl(221,83%,53%);color:#fff;"
        : "background:hsl(220,15%,22%);color:hsl(220,15%,80%);border:1px solid hsl(220,15%,30%);");

    let html =
      '<div style="' + actionBarStyle + '">' +
        '<button id="cdInvCreate" style="' + btnStyle(true) + '">+ New Invoice</button>' +
      '</div>' +
      (invoicesData.length
        ? '<div class="cd-overview-grid" style="margin-bottom:16px;">' +
            stat(fmtMoney(totalBilled), "Total Billed") +
            stat(fmtMoney(totalPaid),   "Total Paid") +
            stat(fmtMoney(totalBal),    "Balance Due") +
          '</div><div class="cd-list">'
        : '<div class="cd-empty" style="margin-top:0;">No invoices yet.</div>');

    for (const inv of invoicesData) {
      const sc = (inv.status_code || "").toLowerCase();
      const s = CD_INV_STATUS[sc] || { label: inv.status_code || "Unknown", dot: "hsl(215,16%,47%)" };
      const bal = Number(inv.balance_due || 0);
      const overdue = inv.overdue;
      const canSend = sc === "draft" || sc === "sent";
      const canPay  = sc !== "paid" && sc !== "void" && bal > 0;

      html += '<div class="cd-list-item" style="flex-direction:column;align-items:stretch;gap:8px;">' +
        '<div style="display:flex;align-items:flex-start;gap:8px;">' +
          '<div class="cd-list-main" style="flex:1;">' +
            '<div class="cd-list-title">' + esc(inv.invoice_number || inv.id) + '</div>' +
            '<div class="cd-list-sub">' + fmtShortDate(inv.issued_at) +
              (inv.due_at ? " \u00b7 Due " + fmtShortDate(inv.due_at) : "") +
              (inv.sent_at ? " \u00b7 Sent" : "") +
              (inv.notes ? " \u00b7 " + esc(inv.notes.slice(0, 40)) : "") +
            "</div>" +
          "</div>" +
          '<div class="cd-list-right" style="text-align:right;flex-shrink:0;">' +
            '<span class="cd-status">' +
              '<span class="cd-dot" style="background:' + (overdue ? "hsl(0,70%,55%)" : s.dot) + ';"></span>' +
              (overdue ? "Overdue" : esc(s.label)) +
            "</span>" +
            '<div style="font-size:13px;font-weight:700;margin-top:4px;">' + fmtMoney(inv.total) + '</div>' +
            (bal > 0 ? '<div style="font-size:12px;color:hsl(38,80%,40%);">Bal: ' + fmtMoney(bal) + '</div>' : '') +
          "</div>" +
        "</div>" +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          (canSend
            ? '<button class="cd-inv-send" data-id="' + esc(inv.id) + '" style="' + btnStyle(false) + 'font-size:12px;padding:5px 12px;">Send</button>'
            : '') +
          (canPay
            ? '<button class="cd-inv-pay" data-id="' + esc(inv.id) + '" style="' + btnStyle(false) + 'font-size:12px;padding:5px 12px;">Record Payment</button>'
            : '') +
        '</div>' +
      "</div>";
    }

    if (invoicesData.length) html += "</div>";
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
      const r = await fetchJSON("/api/invoices?client_id=" + encodeURIComponent(clientId));
      invoicesData = r.ok ? r.invoices : [];
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
      const [cRes, rRes, qRes, jRes, nRes, aRes, invRes] = await Promise.all([
        fetchJSON(base),
        fetchJSON(base + "/requests"),
        fetchJSON(base + "/quotes"),
        fetchJSON(base + "/jobs"),
        fetchJSON(base + "/notes"),
        fetchJSON(base + "/attachments"),
        fetchJSON("/api/invoices?client_id=" + encodeURIComponent(clientId)),
      ]);

      if (!cRes.ok) return showError("Client not found.");

      clientData = cRes.client;
      requestsData = rRes.ok ? rRes.requests : [];
      quotesData = qRes.ok ? qRes.quotes : [];
      jobsData = jRes.ok ? jRes.jobs : [];
      notesData = nRes.ok ? nRes.notes : [];
      attachmentsData = aRes.ok ? aRes.attachments : [];
      invoicesData = invRes.ok ? invRes.invoices : [];

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