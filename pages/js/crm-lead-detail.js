(() => {
  'use strict';

  const params  = new URLSearchParams(window.location.search);
  const leadId  = params.get('id');
  const quoteId = params.get('quote_id');
  const root   = document.getElementById('ldRoot');

  let CURRENT_LEAD = null;

  const STATUS_LABELS = {
    awaiting_response: 'Awaiting Response',
    quoted:            'Quoted',
    scheduled:         'Scheduled',
    in_progress:       'In Progress',
    invoiced:          'Invoiced',
    paid:              'Paid',
    closed_won:        'Closed Won',
    closed_lost:       'Closed Lost',
    on_hold:           'On Hold',
  };

  const STATUS_COLORS = {
    awaiting_response: { bg: 'hsl(38 90% 92%)',  color: 'hsl(38 70% 30%)' },
    quoted:            { bg: 'hsl(210 80% 92%)', color: 'hsl(210 70% 30%)' },
    scheduled:         { bg: 'hsl(270 70% 92%)', color: 'hsl(270 60% 30%)' },
    in_progress:       { bg: 'hsl(38 90% 92%)',  color: 'hsl(38 70% 30%)' },
    invoiced:          { bg: 'hsl(190 70% 90%)', color: 'hsl(190 60% 25%)' },
    paid:              { bg: 'hsl(142 60% 90%)', color: 'hsl(142 50% 25%)' },
    closed_won:        { bg: 'hsl(142 60% 90%)', color: 'hsl(142 50% 25%)' },
    closed_lost:       { bg: 'hsl(0 60% 92%)',   color: 'hsl(0 50% 35%)' },
    on_hold:           { bg: 'hsl(220 15% 88%)', color: 'hsl(220 10% 35%)' },
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
  }

  function stripHtml(s) {
    return String(s || '').replace(/<[^>]*>/g, '').trim();
  }

  function cleanPhone(s) {
    return stripHtml(s).replace(/[^\d+\-\s().]/g, '').trim();
  }

  function fmt$(n) {
    const v = Number(n || 0);
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function badge(status) {
    const c = STATUS_COLORS[status] || { bg: 'hsl(220 15% 88%)', color: 'hsl(220 10% 35%)' };
    const label = STATUS_LABELS[status] || status || 'Unknown';
    return `<span class="ld-status-badge" style="background:${c.bg};color:${c.color};">${esc(label)}</span>`;
  }

  function fieldRow(label, value, opts = {}) {
    let val = value !== '' && value !== null && value !== undefined ? value : '—';
    if (opts.href && value) val = `<a href="${opts.href}">${esc(String(value))}</a>`;
    if (opts.raw) val = value;
    return `
      <div class="ld-field-row">
        <span class="ld-field-label">${esc(label)}</span>
        <span class="ld-field-value">${opts.raw ? val : esc(String(val))}</span>
      </div>`;
  }

  function finItem(label, value, opts = {}) {
    const color = opts.color || '';
    return `
      <div class="ld-fin-item">
        <div class="ld-fin-label">${esc(label)}</div>
        <div class="ld-fin-value" style="color:${color};">${esc(String(value))}</div>
      </div>`;
  }

  function statusOptions(current) {
    return Object.entries(STATUS_LABELS).map(([k, v]) =>
      `<option value="${k}"${k === current ? ' selected' : ''}>${v}</option>`
    ).join('');
  }

  function render(lead) {
    CURRENT_LEAD = lead;
    const status = lead.status_code || lead.status || '';
    const profit = Number(lead.gross_profit || 0);
    const margin = lead.gross_margin_pct != null ? lead.gross_margin_pct + '%' : '—';
    const profitColor = profit < 0 ? 'hsl(0,70%,50%)' : profit > 0 ? 'hsl(142,50%,40%)' : '';
    const balance = Math.max(0, Number(lead.quoted_price || 0) - Number(lead.paid_amount || 0));
    const hasQuoteId = !!lead.last_quote_id;
    const jobTitle = lead.job_description || lead.job_type || '(No description)';
    const jobMeta = [
      lead.job_number ? 'Job #' + lead.job_number : '',
      fmtDate(lead.created_at) !== '—' ? 'Added ' + fmtDate(lead.created_at) : '',
    ].filter(Boolean).join(' · ');

    root.innerHTML = `
      <div class="ld-hero">
        <div class="ld-hero-left">
          <div class="ld-avatar">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </div>
          <div>
            <div class="ld-hero-name" style="display:flex;align-items:center;gap:8px;">
              ${esc(lead.name || 'Unnamed Lead')}
              ${(function(){
                const score = lead.lead_quality_score || "";
                const SCORE_COLORS = { A: 'hsl(142,50%,40%)', B: 'hsl(38,80%,40%)', C: 'hsl(0,70%,50%)' };
                const SCORE_BG     = { A: 'hsl(142,30%,94%)', B: 'hsl(38,50%,94%)',  C: 'hsl(0,50%,95%)' };
                return score
                  ? `<span title="Lead quality score: ${esc(score)}" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:800;background:${SCORE_BG[score]||'hsl(220,10%,94%)'};color:${SCORE_COLORS[score]||'hsl(220,15%,55%)'};border:1.5px solid ${SCORE_COLORS[score]||'hsl(220,15%,55%)'};flex-shrink:0;">${esc(score)}</span>`
                  : '';
              })()}
            </div>
            <div class="ld-hero-sub">
              ${lead.lead_id ? `ID ${esc(lead.lead_id)}` : `ID ${esc(lead.id)}`}
            </div>
          </div>
        </div>
        <div class="ld-actions">
          ${cleanPhone(lead.phone) ? `<a class="ld-btn" href="tel:${esc(cleanPhone(lead.phone).replace(/\D/g,''))}">&#128222; Call</a>` : ''}
          ${stripHtml(lead.email) ? `<a class="ld-btn" href="mailto:${esc(stripHtml(lead.email))}">&#9993; Email</a>` : ''}
          <button class="ld-btn ld-btn-primary" id="ldSaveBtn" style="display:none;">Save Changes</button>
        </div>
      </div>

      <!-- Contact Card — always visible -->
      <div class="ld-card" style="margin-bottom:12px;">
        <div class="ld-card-title">Contact Info</div>
        ${fieldRow('Name', lead.name)}
        ${fieldRow('Phone', cleanPhone(lead.phone))}
        ${fieldRow('Email', stripHtml(lead.email))}
        ${fieldRow('Address', lead.address)}
        ${fieldRow('SMS Opt-in', lead.sms_opt_in === 'true' ? 'Yes' : lead.sms_opt_in === 'false' ? 'No' : '—')}
      </div>

      <!-- Current Job Accordion — open by default -->
      <div class="ld-job-acc">
        <button class="ld-job-hdr is-open" id="ldCurrentJobHdr" type="button">
          <div class="ld-job-hdr-left">
            <div class="ld-job-hdr-title">${esc(jobTitle)}</div>
            ${jobMeta ? `<div class="ld-job-hdr-meta">${esc(jobMeta)} &bull; ${badge(status)}</div>` : ''}
          </div>
          <span class="ld-job-chevron">&#9660;</span>
        </button>
        <div class="ld-job-body is-open" id="ldCurrentJobBody">

          <div class="ld-grid">

            <!-- LEFT COLUMN -->
            <div class="ld-left">

              <!-- Job Details -->
              <div class="ld-card">
                <div class="ld-card-title">Job Details</div>
                ${fieldRow('Job Number', lead.job_number)}
                ${fieldRow('Quoted Price', lead.quoted_price > 0 ? fmt$(lead.quoted_price) : '—')}
                ${fieldRow('Quote Version', lead.pricing_version)}
                ${fieldRow('Last Quote ID', lead.last_quote_id)}
                ${fieldRow('Job Description', lead.job_description || lead.notes)}
              </div>

              <!-- Scheduling -->
              <div class="ld-card">
                <div class="ld-card-title">Scheduling
                  <div class="ld-card-title-actions">
                    <button class="ld-btn" id="ldEditScheduleBtn" style="padding:4px 10px;font-size:12px;">Edit</button>
                  </div>
                </div>
                ${fieldRow('Scheduled Date', fmtDate(lead.scheduled_date))}
                ${fieldRow('Time Window', lead.schedule_window)}
                ${fieldRow('Preference', lead.schedule_preference)}
                ${fieldRow('Duration', lead.duration_minutes > 0 ? lead.duration_minutes + ' min' : '—')}
                ${fieldRow('Assigned To', lead.assigned_to)}
              </div>

              <!-- Notes -->
              <div class="ld-card">
                <div class="ld-card-title">Notes
                  <div class="ld-card-title-actions">
                    <button class="ld-btn" id="ldEditNotesBtn" style="padding:4px 10px;font-size:12px;">Edit</button>
                  </div>
                </div>
                <div id="ldNotesDisplay">
                  ${lead.notes
                    ? `<div class="ld-notes-text">${esc(lead.notes)}</div>`
                    : `<div class="ld-notes-empty">No notes yet.</div>`}
                </div>
                <textarea class="ld-notes-editor" id="ldNotesEditor" rows="4" placeholder="Add notes…">${esc(lead.notes || '')}</textarea>
                <div class="ld-msg" id="ldNoteMsg"></div>
              </div>

              <!-- Photos & Marketing -->
              <div class="ld-card" id="ldPhotosCard">
                <div class="ld-card-title">Photos
                  <div class="ld-card-title-actions">
                    <button class="ld-btn" id="ldAddPhotoBtn" style="padding:4px 10px;font-size:12px;">+ Add URL</button>
                  </div>
                </div>
                <div id="ldPhotosContent" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading…</div>
              </div>

              ${hasQuoteId ? `
              <div class="ld-card" id="ldMaterialsCard">
                <div class="ld-card-title">Estimated Materials</div>
                <div class="ld-materials-helper">Preliminary pull list based on quote answers. Verify before dispatch.</div>
                <div id="ldMaterialsContent" style="padding:8px 0;color:hsl(var(--muted-foreground));font-size:13px;">Loading materials…</div>
              </div>

              <div class="ld-card" id="ldSnapshotCard">
                <div class="ld-card-title">Quote Breakdown</div>
                <div id="ldSnapshotContent" style="padding:8px 0;color:hsl(var(--muted-foreground));font-size:13px;">Loading answers…</div>
              </div>` : ''}

            </div>

            <!-- RIGHT COLUMN -->
            <div class="ld-right">

              <!-- Status -->
              <div class="ld-card">
                <div class="ld-card-title">Status</div>
                <select class="ld-status-select" id="ldStatusSelect">${statusOptions(status)}</select>
                <div class="ld-msg" id="ldStatusMsg"></div>
              </div>

              <!-- Financials -->
              <div class="ld-card">
                <div class="ld-card-title">Financials</div>
                <div class="ld-fin-grid">
                  ${finItem('Quoted', fmt$(lead.quoted_price))}
                  ${finItem('Invoiced', fmt$(lead.invoiced_amount))}
                  ${finItem('Paid', fmt$(lead.paid_amount))}
                  ${finItem('Balance Due', fmt$(balance), { color: balance > 0 ? 'hsl(38,80%,40%)' : '' })}
                  ${finItem('Labor Cost', fmt$(lead.labor_cost))}
                  ${finItem('Expense Cost', fmt$(lead.expense_cost))}
                  ${finItem('Total Cost', fmt$(lead.total_cost))}
                  ${finItem('Gross Profit', fmt$(lead.gross_profit), { color: profitColor })}
                </div>
                ${lead.gross_margin_pct != null ? `
                <div style="margin-top:12px;padding-top:12px;border-top:1px solid hsl(var(--border));display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:13px;color:hsl(var(--muted-foreground));">Gross Margin</span>
                  <span style="font-size:18px;font-weight:800;font-family:var(--font-display);color:${profitColor};">${margin}</span>
                </div>` : ''}
              </div>

              <!-- Billing -->
              <div class="ld-card">
                <div class="ld-card-title">Billing</div>
                ${fieldRow('Deposit Received', lead.deposit_received > 0 ? fmt$(lead.deposit_received) : '—')}
                ${fieldRow('Invoice Date', fmtDate(lead.invoice_date))}
                ${fieldRow('Paid Date', fmtDate(lead.paid_date))}
                ${fieldRow('Deposit Override', lead.deposit_override ? 'Yes' : '—')}
              </div>

              <!-- Invoicing -->
              <div class="ld-card" id="ldInvoiceCard">
                <div class="ld-card-title">Invoicing</div>
                <div id="ldInvoiceContent" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading&hellip;</div>
              </div>

              <!-- Bonus Eligibility -->
              <div class="ld-card" id="ldBonusCard">
                <div class="ld-card-title">Bonus Eligibility</div>
                <div id="ldBonusContent" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading&hellip;</div>
              </div>

              <!-- Source & Attribution -->
              <div class="ld-card" id="ldAttrCard">
                <div class="ld-card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;" id="ldAttrToggle">
                  <span>Source &amp; Attribution</span>
                  <span id="ldAttrChevron" style="font-size:12px;color:hsl(var(--muted-foreground));">&#9660;</span>
                </div>
                <div id="ldAttrContent" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading&hellip;</div>
              </div>

            </div>
          </div>

        </div>
      </div>

      <!-- Related jobs inserted here by loadRelatedJobs() -->
      <div id="ldRelatedJobsWrap"></div>
    `;

    // Wire current job accordion toggle
    document.getElementById('ldCurrentJobHdr').addEventListener('click', () => {
      const hdr  = document.getElementById('ldCurrentJobHdr');
      const body = document.getElementById('ldCurrentJobBody');
      hdr.classList.toggle('is-open');
      body.classList.toggle('is-open');
    });

    attachEvents(lead);
    if (hasQuoteId) {
      loadMaterials(lead.id || lead.lead_id);
      loadSnapshot(lead.last_quote_id);
    }
    loadLeadInvoice(lead.id || lead.lead_id, lead);
    loadBonusPanel(lead.id || lead.lead_id);
    loadAttributionPanel(lead.id || lead.lead_id, lead);
    loadPhotosCard(lead.id || lead.lead_id, lead);
    loadRelatedJobs(lead);
  }

  async function loadSnapshot(quoteId, targetEl) {
    const el = targetEl || document.getElementById('ldSnapshotContent');
    if (!el) return;
    try {
      const data = await window.Api.fetchJson('/api/lead-snapshot?quote_id=' + encodeURIComponent(quoteId));
      if (!data.ok) {
        el.innerHTML = `<span style="opacity:.6;">No snapshot found for this quote.</span>`;
        return;
      }

      const p = data.pricing || {};
      const qaLines = data.answers || [];

      let html = '';

      // Readable classification labels (hide internal engineering flags)
      const CLASS_LABELS = {
        standard: 'Standard scope',
        xl: 'Large scope',
        disqualified: 'Needs site visit',
        site_visit_required: 'Needs site visit',
        ready_with_review_flag: 'Ready — flagged for review',
      };
      const clsKey = (data.classification || '').toLowerCase();
      const clsLabel = CLASS_LABELS[clsKey] || null;

      // Service + quantity header
      html += `<div style="margin-bottom:12px;">
        <div style="font-size:15px;font-weight:700;color:hsl(var(--foreground));">${esc(data.job_type_label)}</div>
        ${data.qty > 1 ? `<div style="font-size:12px;margin-top:2px;color:hsl(var(--muted-foreground));">Quantity: ${data.qty}</div>` : ''}
        ${clsLabel && clsLabel !== 'Standard scope' ? `<div style="font-size:12px;margin-top:2px;color:hsl(var(--muted-foreground));">${esc(clsLabel)}</div>` : ''}
      </div>`;

      // Q&A table
      if (qaLines.length) {
        html += `<div class="ld-qa-list">`;
        for (const qa of qaLines) {
          html += `
            <div class="ld-qa-row">
              <div class="ld-qa-q">${esc(qa.question)}</div>
              <div class="ld-qa-a">${esc(qa.answer)}</div>
            </div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="opacity:.6;font-size:13px;margin-bottom:10px;">No question answers recorded.</div>`;
      }

      // Customer notes from quote form
      if (data.notes) {
        html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid hsl(var(--border));">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-foreground));margin-bottom:4px;">Customer Notes</div>
          <div style="font-size:13px;color:hsl(var(--foreground));">${esc(data.notes)}</div>
        </div>`;
      }

      // Pricing summary (collapsible detail)
      if (p.final_price > 0) {
        html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid hsl(var(--border));">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-foreground));margin-bottom:8px;">Pricing Detail</div>
          <div class="ld-snap-price-grid">
            ${p.total_hours   > 0 ? `<span class="ld-sp-label">Est. Hours</span><span class="ld-sp-val">${Number(p.total_hours).toFixed(1)} h</span>` : ''}
            ${p.labor_cost    > 0 ? `<span class="ld-sp-label">Labor</span><span class="ld-sp-val">${fmt$(p.labor_cost)}</span>` : ''}
            ${p.material_allowance > 0 ? `<span class="ld-sp-label">Materials</span><span class="ld-sp-val">${fmt$(p.material_allowance)}</span>` : ''}
            ${p.travel_fee    > 0 ? `<span class="ld-sp-label">Travel</span><span class="ld-sp-val">${fmt$(p.travel_fee)}</span>` : ''}
            ${p.overhead_cost > 0 ? `<span class="ld-sp-label">Overhead</span><span class="ld-sp-val">${fmt$(p.overhead_cost)}</span>` : ''}
            <span class="ld-sp-label" style="font-weight:700;">Total Quote</span>
            <span class="ld-sp-val" style="font-weight:700;color:hsl(var(--primary));">${fmt$(p.final_price)}</span>
          </div>
        </div>`;
      }

      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<span style="color:hsl(0,70%,50%);font-size:13px;">Could not load breakdown: ${esc(err.message)}</span>`;
    }
  }

  async function loadMaterials(leadId, targetEl) {
    const el = targetEl || document.getElementById('ldMaterialsContent');
    if (!el || !leadId) return;
    try {
      const data = await window.Api.fetchJson('/api/leads/' + encodeURIComponent(leadId) + '/materials');
      if (!data.ok) throw new Error(data.error || 'Failed to load materials');
      const mats = Array.isArray(data.materials) ? data.materials : [];
      if (!mats.length) {
        el.innerHTML = '<div class="ld-notes-empty">No material list was captured for this quote yet.</div>';
        return;
      }
      el.innerHTML = '<div class="ld-mat-list">' + mats.map((m) => {
        const qtyLabel = m.is_allowance
          ? `<span class="ld-mat-allowance">(as needed)</span>`
          : `${esc(String(m.quantity ?? 1))} ${esc(m.unit || 'each')}`;
        const sourceLabel = m.source ? ` — ${esc(m.source)}` : '';
        return `
        <div class="ld-mat-row">
          <div class="ld-mat-main">${esc(m.name || 'Material')}</div>
          <div class="ld-mat-meta">${qtyLabel}${sourceLabel}</div>
          ${m.notes ? `<div class="ld-mat-note">${esc(m.notes)}</div>` : ''}
        </div>`;
      }).join('') + '</div>';
    } catch (err) {
      el.innerHTML = '<span style="color:hsl(0,70%,50%);font-size:13px;">Could not load materials: ' + esc(err.message) + '</span>';
    }
  }

  function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'ld-msg ' + type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function attachEvents(lead) {
    // Status select — auto-save on change
    const statusSelect = document.getElementById('ldStatusSelect');
    if (statusSelect) {
      statusSelect.addEventListener('change', async () => {
        try {
          const r = await window.Api.fetchJson('/api/leads/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: lead.id, status: statusSelect.value }),
          });
          if (!r.ok) throw new Error(r.error || 'Update failed');
          showMsg('ldStatusMsg', 'Status updated.', 'ok');
        } catch (e) {
          showMsg('ldStatusMsg', 'Error: ' + e.message, 'err');
        }
      });
    }

    // Notes edit toggle
    const editNotesBtn = document.getElementById('ldEditNotesBtn');
    const notesEditor  = document.getElementById('ldNotesEditor');
    const notesDisplay = document.getElementById('ldNotesDisplay');
    const saveBtn      = document.getElementById('ldSaveBtn');

    let notesEditing = false;

    if (editNotesBtn) {
      editNotesBtn.addEventListener('click', () => {
        notesEditing = !notesEditing;
        notesEditor.style.display = notesEditing ? 'block' : 'none';
        notesDisplay.style.display = notesEditing ? 'none' : 'block';
        editNotesBtn.textContent = notesEditing ? 'Cancel' : 'Edit';
        if (saveBtn) saveBtn.style.display = notesEditing ? 'inline-flex' : 'none';
      });
    }

    const editScheduleBtn = document.getElementById('ldEditScheduleBtn');
    if (editScheduleBtn) editScheduleBtn.addEventListener('click', () => openScheduleModal(lead));

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const newNotes = notesEditor.value.trim();
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          const r = await window.Api.fetchJson('/api/leads/update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: lead.id, notes: newNotes }),
          });
          if (!r.ok) throw new Error(r.error || 'Save failed');
          lead.notes = newNotes;
          notesDisplay.innerHTML = newNotes
            ? `<div class="ld-notes-text">${esc(newNotes)}</div>`
            : `<div class="ld-notes-empty">No notes yet.</div>`;
          notesEditing = false;
          notesEditor.style.display = 'none';
          notesDisplay.style.display = 'block';
          editNotesBtn.textContent = 'Edit';
          saveBtn.style.display = 'none';
          showMsg('ldNoteMsg', 'Notes saved.', 'ok');
        } catch (e) {
          showMsg('ldNoteMsg', 'Error: ' + e.message, 'err');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
        }
      });
    }
  }

  function ensureScheduleModal() {
    if (document.getElementById('ldScheduleModal')) return;
    const div = document.createElement('div');
    div.id = 'ldScheduleModal';
    div.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;';
    div.innerHTML = `<div id="ldScheduleBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.55);"></div>
      <div style="position:relative;background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:16px;padding:20px;width:420px;max-width:calc(100vw - 24px);">
        <div style="font-family:var(--font-display);font-size:16px;font-weight:800;margin-bottom:12px;">Edit Scheduling</div>
        <div class="ld-sched-grid">
          <label>Scheduled Date<input id="ldSchedDate" type="datetime-local" class="ld-status-select"></label>
          <label>Time Window<input id="ldSchedWindow" type="text" class="ld-status-select" placeholder="Morning / Afternoon"></label>
          <label>Schedule Preference<input id="ldSchedPref" type="text" class="ld-status-select" placeholder="Customer preference"></label>
          <label>Duration Minutes<input id="ldSchedDuration" type="number" min="0" max="1440" class="ld-status-select"></label>
          <label>Assigned To / Technician<input id="ldSchedAssigned" type="text" class="ld-status-select" placeholder="Technician name"></label>
        </div>
        <div id="ldSchedErr" style="display:none;color:hsl(0 70% 45%);font-size:12px;margin-top:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;"><button class="ld-btn" id="ldSchedCancel">Cancel</button><button class="ld-btn ld-btn-primary" id="ldSchedSave">Save</button></div>
      </div>`;
    document.body.appendChild(div);
  }

  function openScheduleModal(lead) {
    ensureScheduleModal();
    const modal = document.getElementById('ldScheduleModal');
    const toLocal = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return String(v).slice(0,16); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    document.getElementById('ldSchedDate').value = toLocal(lead.scheduled_date);
    document.getElementById('ldSchedWindow').value = lead.schedule_window || '';
    document.getElementById('ldSchedPref').value = lead.schedule_preference || '';
    document.getElementById('ldSchedDuration').value = lead.duration_minutes || '';
    document.getElementById('ldSchedAssigned').value = lead.assigned_to || '';
    document.getElementById('ldSchedErr').style.display = 'none';
    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; };
    document.getElementById('ldScheduleBackdrop').onclick = close;
    document.getElementById('ldSchedCancel').onclick = close;
    document.getElementById('ldSchedSave').onclick = async () => {
      const btn = document.getElementById('ldSchedSave');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const body = { id: lead.id, scheduled_date: document.getElementById('ldSchedDate').value, schedule_window: document.getElementById('ldSchedWindow').value.trim(), schedule_preference: document.getElementById('ldSchedPref').value.trim(), duration_minutes: Number(document.getElementById('ldSchedDuration').value || 0), assigned_to: document.getElementById('ldSchedAssigned').value.trim() };
        const r = await window.Api.fetchJson('/api/leads/schedule', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(r.error || 'Schedule save failed');
        Object.assign(lead, body, { status: 'Scheduled' });
        close();
        render(lead);
      } catch (e) {
        const errEl = document.getElementById('ldSchedErr'); errEl.textContent = e.message; errEl.style.display = 'block';
      } finally { btn.disabled = false; btn.textContent = 'Save'; }
    };
  }

  /* =============================================
     INVOICING CARD — fetches and renders invoice
  ============================================= */
  const INV_STATUS = {
    draft:             { label: 'Draft',             bg: 'hsl(220 15% 88%)', color: 'hsl(220 10% 35%)' },
    sent:              { label: 'Sent',              bg: 'hsl(210 80% 92%)', color: 'hsl(210 70% 30%)' },
    deposit_received:  { label: 'Deposit Received',  bg: 'hsl(270 60% 90%)', color: 'hsl(270 50% 30%)' },
    partial:           { label: 'Partial',           bg: 'hsl(38 90% 90%)',  color: 'hsl(38 70% 30%)' },
    paid:              { label: 'Paid',              bg: 'hsl(142 60% 90%)', color: 'hsl(142 50% 25%)' },
    void:              { label: 'Void',              bg: 'hsl(0 60% 92%)',   color: 'hsl(0 50% 35%)' },
  };

  function invBadge(status) {
    const s = INV_STATUS[status] || { label: status || 'Unknown', bg: 'hsl(220 15% 88%)', color: 'hsl(220 10% 35%)' };
    return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;background:${s.bg};color:${s.color};">${esc(s.label)}</span>`;
  }

  function invActionBtn(id, label, style) {
    return `<button class="ld-btn${style ? ' ld-btn-' + style : ''}" data-inv-action="${id}" style="font-size:12px;padding:6px 12px;">${esc(label)}</button>`;
  }

  async function loadLeadInvoice(lid, lead, targetEl) {
    const el = targetEl || document.getElementById('ldInvoiceContent');
    if (!el || !lid) return;
    try {
      const data = await window.Api.fetchJson('/api/invoices?lead_id=' + encodeURIComponent(lid));
      const invoices = (data.invoices || []).sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));
      const inv = invoices[0] || null;
      renderInvoiceCard(el, inv, lead, lid);
    } catch (e) {
      el.innerHTML = `<span style="color:hsl(0,70%,50%);">Failed to load invoice: ${esc(e.message)}</span>`;
    }
  }

  function renderInvoiceCard(el, inv, lead, lid) {
    if (!inv) {
      const quotedPrice = Number(lead.quoted_price || 0);
      el.innerHTML = `
        <div style="color:hsl(var(--muted-foreground));font-style:italic;margin-bottom:10px;">No invoice created yet.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${invActionBtn('create', 'Create Invoice', 'primary')}
        </div>
        <div class="ld-msg" id="ldInvMsg"></div>`;

      el.querySelector('[data-inv-action="create"]').addEventListener('click', async () => {
        const btn = el.querySelector('[data-inv-action="create"]');
        const subtotal = quotedPrice > 0 ? quotedPrice : parseFloat(prompt('Enter invoice amount:') || '0');
        if (!subtotal || subtotal <= 0) return;
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
          const r = await window.Api.fetchJson('/api/invoices/from-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lead_id: lid,
              customer_name: lead.name || lid,
              subtotal,
              client_id: lead.client_id || '',
            }),
          });
          if (!r.ok) throw new Error(r.error || 'Create failed');
          showMsg('ldInvMsg', `Invoice ${r.invoice_number} created (ref: ${r.provider_ref || 'none'}).`, 'ok');
          setTimeout(() => loadLeadInvoice(lid, lead), 600);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Create Invoice';
          showMsg('ldInvMsg', 'Error: ' + e.message, 'err');
        }
      });
      return;
    }

    const status = (inv.status_code || '').toLowerCase();
    const total = Number(inv.total || 0);
    const balance = Number(inv.balance_due || 0);
    const paid = Number(inv.paid_amount || 0);

    const canSend = status === 'draft' || status === 'sent';
    const canPay  = status !== 'void' && status !== 'paid' && balance > 0;

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-weight:700;font-size:14px;">${esc(inv.invoice_number)}</span>
        ${invBadge(status)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">
        <div style="background:hsl(var(--muted)/.5);border-radius:8px;padding:10px 12px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:hsl(var(--muted-foreground));">Total</div>
          <div style="font-size:17px;font-weight:800;font-family:var(--font-display);">${fmt$(total)}</div>
        </div>
        <div style="background:hsl(var(--muted)/.5);border-radius:8px;padding:10px 12px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:hsl(var(--muted-foreground));">Balance</div>
          <div style="font-size:17px;font-weight:800;font-family:var(--font-display);color:${balance > 0 ? 'hsl(38,80%,40%)' : 'hsl(142,50%,35%)'};">${fmt$(balance)}</div>
        </div>
      </div>
      ${inv.sent_at ? `<div style="font-size:12px;color:hsl(var(--muted-foreground));margin-bottom:8px;">Sent ${fmtDate(inv.sent_at)}</div>` : ''}
      ${inv.provider_ref ? `<div style="font-size:11px;color:hsl(var(--muted-foreground));margin-bottom:8px;">Ref: ${esc(inv.provider_ref)}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        ${canSend ? invActionBtn('send', status === 'sent' ? 'Resend Invoice' : 'Send Invoice', 'primary') : ''}
        ${canPay ? invActionBtn('deposit', 'Record Deposit', '') : ''}
        ${canPay ? invActionBtn('pay', 'Mark Paid', '') : ''}
      </div>
      <div class="ld-msg" id="ldInvMsg"></div>`;

    const btnSend = el.querySelector('[data-inv-action="send"]');
    const btnDeposit = el.querySelector('[data-inv-action="deposit"]');
    const btnPay = el.querySelector('[data-inv-action="pay"]');

    if (btnSend) {
      btnSend.addEventListener('click', async () => {
        btnSend.disabled = true; btnSend.textContent = 'Sending…';
        try {
          const r = await window.Api.fetchJson(`/api/invoices/${encodeURIComponent(inv.id)}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (!r.ok) throw new Error(r.error || r.message || 'Send failed');
          showMsg('ldInvMsg', 'Invoice marked as sent.', 'ok');
          setTimeout(() => loadLeadInvoice(lid, lead), 600);
        } catch (e) {
          btnSend.disabled = false; btnSend.textContent = status === 'sent' ? 'Resend Invoice' : 'Send Invoice';
          showMsg('ldInvMsg', 'Error: ' + e.message, 'err');
        }
      });
    }

    if (btnDeposit) {
      btnDeposit.addEventListener('click', () => {
        openPaymentModal(inv, lid, lead, 'deposit');
      });
    }

    if (btnPay) {
      btnPay.addEventListener('click', () => {
        openPaymentModal(inv, lid, lead, 'full');
      });
    }
  }

  /* =============================================
     PAYMENT MODAL
  ============================================= */
  function ensurePaymentModal() {
    if (document.getElementById('ldPayModal')) return;
    const div = document.createElement('div');
    div.id = 'ldPayModal';
    div.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;';
    div.innerHTML = `
      <div id="ldPayBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.55);"></div>
      <div style="position:relative;background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:16px;padding:24px 28px;width:340px;max-width:calc(100vw - 32px);box-shadow:0 8px 40px rgba(0,0,0,.25);">
        <div style="font-family:var(--font-display);font-size:16px;font-weight:800;margin-bottom:16px;" id="ldPayTitle">Record Payment</div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Amount ($)</label>
          <input id="ldPayAmount" type="number" min="0.01" step="0.01" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:14px;background:hsl(var(--background));color:hsl(var(--foreground));" />
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Method</label>
          <select id="ldPayMethod" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:14px;background:hsl(var(--background));color:hsl(var(--foreground));">
            <option value="check">Check</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="zelle">Zelle</option>
            <option value="deposit">Deposit</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Reference / Check # (optional)</label>
          <input id="ldPayReference" type="text" placeholder="e.g. #1042" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:14px;background:hsl(var(--background));color:hsl(var(--foreground));" />
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Payment Date</label>
          <input id="ldPayDate" type="date" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:14px;background:hsl(var(--background));color:hsl(var(--foreground));" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Note (optional)</label>
          <input id="ldPayNote" type="text" placeholder="" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:14px;background:hsl(var(--background));color:hsl(var(--foreground));" />
        </div>
        <div id="ldPayErr" style="color:hsl(0,70%,50%);font-size:13px;margin-bottom:8px;display:none;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="ld-btn" id="ldPayCancel">Cancel</button>
          <button class="ld-btn ld-btn-primary" id="ldPaySubmit">Save Payment</button>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  function openPaymentModal(inv, lid, lead, mode) {
    ensurePaymentModal();
    const modal = document.getElementById('ldPayModal');
    const balance = Number(inv.balance_due || 0);
    const total = Number(inv.total || 0);

    document.getElementById('ldPayTitle').textContent = mode === 'deposit' ? 'Record Deposit' : 'Record Payment';
    document.getElementById('ldPayAmount').value = mode === 'deposit' ? '' : balance.toFixed(2);
    document.getElementById('ldPayMethod').value = mode === 'deposit' ? 'deposit' : 'check';
    document.getElementById('ldPayReference').value = '';
    document.getElementById('ldPayDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ldPayNote').value = mode === 'deposit' ? 'Deposit received' : '';
    document.getElementById('ldPayErr').style.display = 'none';
    document.getElementById('ldPaySubmit').disabled = false;
    document.getElementById('ldPaySubmit').textContent = 'Save Payment';

    modal.style.display = 'flex';

    const close = () => { modal.style.display = 'none'; };
    document.getElementById('ldPayCancel').onclick = close;
    document.getElementById('ldPayBackdrop').onclick = close;

    document.getElementById('ldPaySubmit').onclick = async () => {
      const amount = parseFloat(document.getElementById('ldPayAmount').value);
      const errEl = document.getElementById('ldPayErr');
      if (!amount || amount <= 0) {
        errEl.textContent = 'Enter a valid amount.';
        errEl.style.display = 'block';
        return;
      }
      const submitBtn = document.getElementById('ldPaySubmit');
      submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
      errEl.style.display = 'none';
      try {
        const r = await window.Api.fetchJson('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_id: inv.id,
            amount,
            method: document.getElementById('ldPayMethod').value,
            reference: document.getElementById('ldPayReference').value.trim(),
            payment_date: document.getElementById('ldPayDate').value || '',
            note: document.getElementById('ldPayNote').value.trim(),
          }),
        });
        if (!r.ok) throw new Error(r.error || r.message || 'Save failed');
        close();
        showMsg('ldInvMsg', `Payment of ${fmt$(amount)} recorded. Balance: ${fmt$(r.balance_due)}.`, 'ok');
        setTimeout(() => loadLeadInvoice(lid, lead), 600);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        submitBtn.disabled = false; submitBtn.textContent = 'Save Payment';
      }
    };
  }

  async function loadBonusPanel(lid, targetEl) {
    const el = targetEl || document.getElementById('ldBonusContent');
    if (!el || !lid) return;
    try {
      const d = await window.Api.fetchJson('/api/bonus-eligibility?lead_id=' + encodeURIComponent(lid));
      if (!d.ok) {
        el.innerHTML = `<span style="opacity:.6;">Could not load bonus data.</span>`;
        return;
      }

      const pct  = d.gross_margin_pct !== null ? d.gross_margin_pct.toFixed(1) + '%' : '—';
      const rev  = d.collected_revenue;
      const cost = d.direct_job_cost;

      const STATUS_LABEL = {
        not_complete:    { text: 'Job Not Complete',        color: 'hsl(220,15%,55%)' },
        margin_fail:     { text: 'Below 40% Margin',        color: 'hsl(0,70%,50%)' },
        doc_fail:        { text: 'Missing Documentation',   color: 'hsl(38,80%,40%)' },
        budget_fail:     { text: 'Unauthorized Deviation',  color: 'hsl(0,70%,50%)' },
        pending_quality: { text: 'In Quality Window',       color: 'hsl(38,80%,40%)' },
        earned:          { text: 'Bonus Earned',            color: 'hsl(142,50%,40%)' },
      };
      const sl = STATUS_LABEL[d.status] || { text: d.status, color: 'hsl(220,15%,55%)' };

      function testRow(label, pass, detail) {
        const icon = pass
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(142,50%,45%)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(0,70%,55%)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        return `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid hsl(var(--border));">
            <div style="flex:0 0 auto;margin-top:1px;">${icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:hsl(var(--foreground));">${label}</div>
              ${detail ? `<div style="font-size:11px;color:hsl(var(--muted-foreground));margin-top:2px;">${detail}</div>` : ''}
            </div>
          </div>`;
      }

      const marginDetail = d.gross_margin_pct !== null
        ? `${pct} margin — Revenue ${fmt$(rev)}, Direct Cost ${fmt$(cost)}`
        : 'No collected revenue recorded';
      const docDetail = `${d.time_entries} time ${d.time_entries === 1 ? 'entry' : 'entries'}, ${d.photo_count} photo${d.photo_count === 1 ? '' : 's'}`;
      let qualityDetail = '';
      if (!d.is_complete) {
        qualityDetail = 'Job not yet marked complete';
      } else if (d.days_remaining_in_quality_window !== null) {
        qualityDetail = `${d.days_remaining_in_quality_window} day${d.days_remaining_in_quality_window === 1 ? '' : 's'} remaining in quality window`;
      } else if (d.tests.quality_ok) {
        qualityDetail = `${d.days_since_completion} days since completion — window closed`;
      }

      function finRow(label, val, opts = {}) {
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;${opts.bold ? 'font-weight:700;border-top:1px solid hsl(var(--border));padding-top:6px;margin-top:2px;' : ''}">
            <span style="font-size:12px;color:${opts.bold ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'};">${label}</span>
            <span style="font-size:12px;font-weight:${opts.bold ? '700' : '500'};color:${opts.color || 'hsl(var(--foreground))'};">${val}</span>
          </div>`;
      }

      const marginBadgeColor = d.tests.margin_ok ? 'hsl(142,50%,40%)' : 'hsl(0,70%,50%)';
      const marginBadge = `<span style="display:inline-block;padding:1px 7px;border-radius:9999px;font-size:10px;font-weight:700;background:${d.tests.margin_ok ? 'hsl(142,30%,94%)' : 'hsl(0,50%,95%)'};color:${marginBadgeColor};border:1px solid ${marginBadgeColor};margin-left:6px;">${d.tests.margin_ok ? 'PASS' : 'BELOW 40%'}</span>`;

      let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:13px;font-weight:700;color:${sl.color};">${sl.text}</span>
          ${d.all_pass ? `<span style="font-size:22px;font-weight:800;font-family:var(--font-display);color:hsl(142,50%,40%);">+$${d.bonus_amount}</span>` : ''}
        </div>

        <!-- Financial Breakdown -->
        <div style="background:hsl(var(--muted));border-radius:8px;padding:10px 12px;margin-bottom:14px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:hsl(var(--muted-foreground));margin-bottom:6px;">Financial Summary</div>
          ${finRow('Collected Revenue', fmt$(d.collected_revenue))}
          ${finRow('Direct Labor (' + d.total_minutes + ' min @ $' + Number(d.loaded_rate).toFixed(2) + '/hr)', '− ' + fmt$(d.labor_cost))}
          ${d.direct_materials > 0 ? finRow('Direct Materials', '− ' + fmt$(d.direct_materials)) : ''}
          ${d.direct_permits   > 0 ? finRow('Permits / Inspections', '− ' + fmt$(d.direct_permits)) : ''}
          ${d.direct_sub       > 0 ? finRow('Subcontractors', '− ' + fmt$(d.direct_sub)) : ''}
          ${finRow('Total Direct Cost', fmt$(d.direct_job_cost), { bold: true })}
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid hsl(var(--border));margin-top:2px;">
            <span style="font-size:12px;font-weight:700;">Gross Margin</span>
            <span style="font-size:13px;font-weight:800;color:${marginBadgeColor};">${pct}${marginBadge}</span>
          </div>
        </div>`;

      html += testRow('Gross Margin ≥ 40%', d.tests.margin_ok, marginDetail);
      html += testRow('Documentation (time + photo)', d.tests.doc_ok, docDetail);
      html += testRow('14-Day Quality Window', d.tests.quality_ok, qualityDetail);
      html += testRow('No Unauthorized Deviations', d.tests.budget_ok, d.tests.budget_ok ? 'No deviation flag on record' : 'Deviation flagged by admin');

      if (d.bonus_tier) {
        html += `
          <div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:hsl(142,30%,96%);border:1px solid hsl(142,40%,85%);">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:hsl(142,40%,40%);margin-bottom:2px;">Bonus Tier (${esc(d.bonus_tier.label)})</div>
            <div style="font-size:20px;font-weight:800;font-family:var(--font-display);color:hsl(142,50%,35%);">$${d.bonus_amount}</div>
          </div>`;
      }

      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<span style="color:hsl(0,70%,50%);font-size:13px;">Error: ${esc(err.message)}</span>`;
    }
  }

  async function loadAttributionPanel(lid, lead) {
    const el = document.getElementById('ldAttrContent');
    if (!el || !lid) return;
    try {
      const d = await window.Api.fetchJson('/api/marketing/lead-source-detail?lead_id=' + encodeURIComponent(lid));
      if (!d.ok) {
        el.innerHTML = `<span style="opacity:.6;">Could not load attribution data.</span>`;
        return;
      }

      const SCORE_COLORS = { A: 'hsl(142,50%,40%)', B: 'hsl(38,80%,40%)', C: 'hsl(0,70%,50%)' };
      const score = d.lead_quality_score;
      const scoreColor = SCORE_COLORS[score] || 'hsl(220,15%,55%)';
      const scoreBg    = score === 'A' ? 'hsl(142,30%,94%)' : score === 'B' ? 'hsl(38,50%,94%)' : score === 'C' ? 'hsl(0,50%,95%)' : 'hsl(220,10%,94%)';

      function attrRow(label, val) {
        if (!val) return '';
        return `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid hsl(var(--border));">
          <span style="font-size:12px;color:hsl(var(--muted-foreground));min-width:120px;flex:0 0 120px;">${label}</span>
          <span style="font-size:12px;color:hsl(var(--foreground));font-weight:500;word-break:break-all;">${esc(val)}</span>
        </div>`;
      }

      let html = '';
      if (score) {
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-foreground));">Quality Score</span>
          <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;font-size:13px;font-weight:800;background:${scoreBg};color:${scoreColor};border:1.5px solid ${scoreColor};">${esc(score)}</span>
        </div>`;
      }

      html += attrRow('Lead Source',    d.lead_source);
      html += attrRow('UTM Source',     d.utm_source);
      html += attrRow('UTM Medium',     d.utm_medium);
      html += attrRow('UTM Campaign',   d.utm_campaign);
      html += attrRow('UTM Content',    d.utm_content);
      html += attrRow('GCLID',          d.gclid);
      html += attrRow('Landing Page',   d.landing_page);
      html += attrRow('Tracking Phone', d.tracking_phone);
      html += attrRow('Referrer URL',   d.referrer_url);
      html += attrRow('Session ID',     d.estimator_session_id);
      if (d.lost_reason) {
        html += attrRow('Lost Reason',  d.lost_reason);
      }

      if (!html) {
        html = '<span style="opacity:.6;font-size:13px;">No attribution data captured yet.</span>';
      }

      el.innerHTML = html;

      // Wire collapse/expand toggle
      const toggle = document.getElementById('ldAttrToggle');
      const chevron = document.getElementById('ldAttrChevron');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const isOpen = el.style.display !== 'none';
          el.style.display = isOpen ? 'none' : '';
          if (chevron) chevron.innerHTML = isOpen ? '&#9658;' : '&#9660;';
        });
      }
    } catch (err) {
      el.innerHTML = `<span style="color:hsl(0,70%,50%);font-size:13px;">Error: ${esc(err.message)}</span>`;
    }
  }

  /* =============================================
     PHOTOS CARD + FLAG FOR MARKETING
  ============================================= */
  async function loadPhotosCard(lid, lead) {
    const el = document.getElementById('ldPhotosContent');
    if (!el || !lid) return;
    try {
      const data = await window.Api.fetchJson('/api/attachments?entity_type=lead&entity_id=' + encodeURIComponent(lid));
      const photos = (data.attachments || []).filter(a =>
        (a.file_type || '').startsWith('image') || /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(a.file_url || '')
      );

      if (!photos.length) {
        el.innerHTML = `<div style="opacity:.6;font-style:italic;">No photos attached yet. Use + Add URL to add one.</div>`;
      } else {
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-bottom:8px;">` +
          photos.map(p => `
            <div style="border-radius:8px;overflow:hidden;border:1px solid hsl(var(--border));position:relative;aspect-ratio:1;">
              <a href="${esc(p.file_url)}" target="_blank" rel="noopener">
                <img src="${esc(p.file_url)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display='none'" />
              </a>
              <button class="flag-mkt-btn" data-url="${esc(p.file_url)}" data-category="${esc(p.category || '')}"
                style="position:absolute;bottom:4px;right:4px;padding:2px 6px;font-size:10px;font-weight:700;
                border-radius:6px;border:none;background:hsl(220 80% 25% / .85);color:#fff;cursor:pointer;
                backdrop-filter:blur(4px);">📣 Flag</button>
            </div>`).join('') +
          `</div>`;
      }

      // Wire + Add URL button
      const addBtn = document.getElementById('ldAddPhotoBtn');
      if (addBtn) {
        addBtn.onclick = async () => {
          const url = prompt('Photo URL (https://…):');
          if (!url || !url.trim()) return;
          await window.Api.fetchJson('/api/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_type: 'lead', entity_id: lid, file_url: url.trim(), file_type: 'image/jpeg', category: 'job' }),
          });
          loadPhotosCard(lid, lead);
        };
      }

      // Wire Flag for Marketing buttons
      el.querySelectorAll('.flag-mkt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          openFlagMktModal(lid, lead, btn.dataset.url, btn.dataset.category);
        });
      });
    } catch (err) {
      el.innerHTML = `<span style="color:hsl(0,70%,50%);font-size:13px;">Error: ${esc(err.message)}</span>`;
    }
  }

  function ensureFlagMktModal() {
    if (document.getElementById('ldFlagMktModal')) return;
    const div = document.createElement('div');
    div.id = 'ldFlagMktModal';
    div.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;';
    div.innerHTML = `
      <div id="ldFlagMktBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.55);"></div>
      <div style="position:relative;background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:16px;padding:24px 28px;width:400px;max-width:calc(100vw - 32px);box-shadow:0 8px 40px rgba(0,0,0,.25);">
        <div style="font-family:var(--font-display);font-size:16px;font-weight:800;margin-bottom:16px;">📣 Flag for Marketing</div>
        <input type="hidden" id="ldFlagUrl" />
        <div style="margin-bottom:10px;font-size:12px;color:hsl(var(--muted-foreground));">Photo URL</div>
        <div id="ldFlagUrlDisplay" style="font-size:11px;word-break:break-all;margin-bottom:14px;color:hsl(var(--foreground));"></div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Asset Type</label>
          <select id="ldFlagType" style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:13px;background:hsl(var(--background));color:hsl(var(--foreground));">
            <option value="before_photo">Before Photo</option>
            <option value="after_photo">After Photo</option>
            <option value="panel_photo">Panel Photo</option>
            <option value="fixture_photo">Fixture Photo</option>
            <option value="job_story">Job Story</option>
            <option value="team_photo">Team Photo</option>
          </select>
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:6px;">Best For</label>
          <div style="display:flex;gap:14px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ldFlagGbp" /> GBP</label>
            <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ldFlagWebsite" /> Website</label>
            <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ldFlagSocial" /> Social</label>
            <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ldFlagAds" /> Ads</label>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-size:12px;color:hsl(var(--muted-foreground));display:block;margin-bottom:4px;">Notes / Caption Idea</label>
          <input id="ldFlagNotes" type="text" placeholder="Before: old panel. After: 200A upgrade." style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid hsl(var(--border));border-radius:8px;font-size:13px;background:hsl(var(--background));color:hsl(var(--foreground));" />
        </div>
        <div id="ldFlagMsg" style="font-size:13px;margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="ld-btn" id="ldFlagCancel">Cancel</button>
          <button class="ld-btn ld-btn-primary" id="ldFlagSave">Add to Asset Library</button>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  function openFlagMktModal(lid, lead, fileUrl, category) {
    ensureFlagMktModal();
    const modal = document.getElementById('ldFlagMktModal');
    document.getElementById('ldFlagUrl').value = fileUrl || '';
    document.getElementById('ldFlagUrlDisplay').textContent = fileUrl ? fileUrl.slice(0, 60) + (fileUrl.length > 60 ? '…' : '') : '';
    const typeMap = { before: 'before_photo', after: 'after_photo', panel: 'panel_photo', fixture: 'fixture_photo' };
    document.getElementById('ldFlagType').value = typeMap[category] || 'after_photo';
    document.getElementById('ldFlagGbp').checked = false;
    document.getElementById('ldFlagWebsite').checked = false;
    document.getElementById('ldFlagSocial').checked = false;
    document.getElementById('ldFlagAds').checked = false;
    document.getElementById('ldFlagNotes').value = '';
    document.getElementById('ldFlagMsg').innerHTML = '';
    modal.style.display = 'flex';

    const close = () => { modal.style.display = 'none'; };
    document.getElementById('ldFlagMktBackdrop').onclick = close;
    document.getElementById('ldFlagCancel').onclick = close;

    document.getElementById('ldFlagSave').onclick = async () => {
      const btn = document.getElementById('ldFlagSave');
      const msgEl = document.getElementById('ldFlagMsg');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await window.Api.fetchJson('/api/marketing/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id:               lid,
            asset_type:            document.getElementById('ldFlagType').value,
            file_url:              fileUrl,
            file_type:             'image',
            permission_status:     'not_asked',
            marketing_use_allowed: 'pending',
            best_for_gbp:          document.getElementById('ldFlagGbp').checked,
            best_for_website:      document.getElementById('ldFlagWebsite').checked,
            best_for_social:       document.getElementById('ldFlagSocial').checked,
            best_for_ads:          document.getElementById('ldFlagAds').checked,
            notes:                 document.getElementById('ldFlagNotes').value.trim(),
          }),
        });
        if (!r.ok) throw new Error(r.error || 'Save failed');
        msgEl.style.color = 'hsl(142,50%,35%)';
        msgEl.textContent = '✓ Added to Asset Library!';
        setTimeout(close, 1200);
      } catch (e) {
        msgEl.style.color = 'hsl(0,70%,45%)';
        msgEl.textContent = 'Error: ' + e.message;
        btn.disabled = false; btn.textContent = 'Add to Asset Library';
      }
    };
  }

  async function loadRelatedJobs(lead) {
    const wrap = document.getElementById('ldRelatedJobsWrap');
    if (!wrap) return;

    const rawPhone = (lead.phone || '').replace(/\D/g, '');
    if (!rawPhone) return;

    const currentId = String(lead.id || lead.lead_id || '');

    try {
      const data = await window.Api.fetchJson('/api/leads?phone=' + encodeURIComponent(rawPhone));
      const others = (data.leads || []).filter(l =>
        String(l.id || l.lead_id || '') !== currentId
      );
      if (!others.length) return;

      others.forEach((j, idx) => {
        const jId      = j.id || j.lead_id || '';
        const jStatus  = j.status_code || j.status || '';
        const jDesc    = j.job_description || j.job_type || '(No description)';
        const jDate    = fmtDate(j.created_at);
        const jMeta    = [
          j.job_number ? 'Job #' + j.job_number : '',
          jDate !== '—' ? 'Added ' + jDate : '',
        ].filter(Boolean).join(' · ');
        const jVal     = Number(j.quoted_price || j.estimated_value || 0);
        const jBalance = Math.max(0, jVal - Number(j.paid_amount || 0));
        const jProfit  = Number(j.gross_profit || 0);
        const jProfitColor = jProfit < 0 ? 'hsl(0,70%,50%)' : jProfit > 0 ? 'hsl(142,50%,40%)' : '';
        const jMargin  = j.gross_margin_pct != null ? j.gross_margin_pct + '%' : '—';
        const hasQ     = !!j.last_quote_id;

        const bodyHtml = `
          <div class="ld-grid">
            <div class="ld-left">

              <div class="ld-card">
                <div class="ld-card-title">Job Details</div>
                ${fieldRow('Job Number', j.job_number)}
                ${fieldRow('Quoted Price', jVal > 0 ? fmt$(jVal) : '—')}
                ${fieldRow('Quote Version', j.pricing_version)}
                ${fieldRow('Last Quote ID', j.last_quote_id)}
                ${fieldRow('Job Description', j.job_description || j.notes)}
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Scheduling</div>
                ${fieldRow('Scheduled Date', fmtDate(j.scheduled_date))}
                ${fieldRow('Time Window', j.schedule_window)}
                ${fieldRow('Preference', j.schedule_preference)}
                ${fieldRow('Duration', j.duration_minutes > 0 ? j.duration_minutes + ' min' : '—')}
                ${fieldRow('Assigned To', j.assigned_to)}
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Notes</div>
                ${j.notes
                  ? `<div class="ld-notes-text">${esc(j.notes)}</div>`
                  : `<div class="ld-notes-empty">No notes.</div>`}
              </div>

              ${hasQ ? `
              <div class="ld-card">
                <div class="ld-card-title">Estimated Materials</div>
                <div class="ld-materials-helper">Preliminary pull list. Verify before dispatch.</div>
                <div id="rjMat-${idx}" style="padding:8px 0;color:hsl(var(--muted-foreground));font-size:13px;">Loading…</div>
              </div>
              <div class="ld-card">
                <div class="ld-card-title">Quote Breakdown</div>
                <div id="rjSnap-${idx}" style="padding:8px 0;color:hsl(var(--muted-foreground));font-size:13px;">Loading…</div>
              </div>` : ''}

            </div>
            <div class="ld-right">

              <div class="ld-card">
                <div class="ld-card-title">Status</div>
                ${badge(jStatus)}
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Financials</div>
                <div class="ld-fin-grid">
                  ${finItem('Quoted', fmt$(jVal))}
                  ${finItem('Invoiced', fmt$(j.invoiced_amount))}
                  ${finItem('Paid', fmt$(j.paid_amount))}
                  ${finItem('Balance Due', fmt$(jBalance), { color: jBalance > 0 ? 'hsl(38,80%,40%)' : '' })}
                  ${finItem('Labor Cost', fmt$(j.labor_cost))}
                  ${finItem('Expense Cost', fmt$(j.expense_cost))}
                  ${finItem('Total Cost', fmt$(j.total_cost))}
                  ${finItem('Gross Profit', fmt$(j.gross_profit), { color: jProfitColor })}
                </div>
                ${j.gross_margin_pct != null ? `
                <div style="margin-top:12px;padding-top:12px;border-top:1px solid hsl(var(--border));display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:13px;color:hsl(var(--muted-foreground));">Gross Margin</span>
                  <span style="font-size:18px;font-weight:800;font-family:var(--font-display);color:${jProfitColor};">${jMargin}</span>
                </div>` : ''}
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Billing</div>
                ${fieldRow('Deposit Received', j.deposit_received > 0 ? fmt$(j.deposit_received) : '—')}
                ${fieldRow('Invoice Date', fmtDate(j.invoice_date))}
                ${fieldRow('Paid Date', fmtDate(j.paid_date))}
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Invoicing</div>
                <div id="rjInv-${idx}" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading…</div>
              </div>

              <div class="ld-card">
                <div class="ld-card-title">Bonus Eligibility</div>
                <div id="rjBonus-${idx}" style="font-size:13px;color:hsl(var(--muted-foreground));padding:4px 0;">Loading…</div>
              </div>

            </div>
          </div>

          <div style="margin-top:12px;text-align:right;">
            <a href="/crm/lead?id=${encodeURIComponent(jId)}"
               style="display:inline-block;padding:8px 18px;border-radius:9px;
                      background:hsl(var(--primary));color:#fff;font-size:13px;
                      font-weight:600;text-decoration:none;">Open full detail →</a>
          </div>`;

        const accEl = document.createElement('div');
        accEl.className = 'ld-job-acc';
        accEl.innerHTML = `
          <button class="ld-job-hdr" type="button">
            <div class="ld-job-hdr-left">
              <div class="ld-job-hdr-title">${esc(jDesc)}</div>
              ${jMeta ? `<div class="ld-job-hdr-meta">${esc(jMeta)} &bull; ${badge(jStatus)}</div>` : ''}
            </div>
            <span class="ld-job-chevron">&#9660;</span>
          </button>
          <div class="ld-job-body">${bodyHtml}</div>`;

        wrap.appendChild(accEl);

        // wire toggle
        const hdr  = accEl.querySelector('.ld-job-hdr');
        const body = accEl.querySelector('.ld-job-body');
        let loaded = false;
        hdr.addEventListener('click', () => {
          const opening = !body.classList.contains('is-open');
          hdr.classList.toggle('is-open');
          body.classList.toggle('is-open');
          if (opening && !loaded) {
            loaded = true;
            if (hasQ) {
              loadMaterials(jId, document.getElementById('rjMat-' + idx));
              loadSnapshot(j.last_quote_id, document.getElementById('rjSnap-' + idx));
            }
            loadLeadInvoice(jId, j, document.getElementById('rjInv-' + idx));
            loadBonusPanel(jId, document.getElementById('rjBonus-' + idx));
          }
        });
      });

    } catch (err) {
      wrap.innerHTML = `<p style="color:hsl(0,70%,50%);font-size:13px;">Could not load other jobs: ${esc(err.message)}</p>`;
    }
  }

  async function load() {
    if (!leadId && !quoteId) {
      root.innerHTML = '<div class="ld-loading">No lead ID in URL.</div>';
      return;
    }
    try {
      const data = await window.Api.fetchJson('/api/leads');
      const leads = data.leads || [];
      let lead;
      if (leadId) {
        lead = leads.find(l =>
          String(l.id)      === String(leadId) ||
          String(l.lead_id) === String(leadId)
        );
      } else {
        lead = leads.find(l =>
          String(l.last_quote_id) === String(quoteId) ||
          String(l.quote_id)      === String(quoteId)
        );
      }
      if (!lead) {
        const lookingFor = leadId || quoteId;
        root.innerHTML = `<div class="ld-loading">Lead not found.<br><small style="opacity:.6;">Looking for: ${esc(lookingFor)}</small></div>`;
        return;
      }
      render(lead);
    } catch (err) {
      root.innerHTML = `<div class="ld-loading" style="color:hsl(0,70%,50%);">Error loading lead: ${esc(err.message)}</div>`;
    }
  }

  load();
  setInterval(load, 30000);
})();
