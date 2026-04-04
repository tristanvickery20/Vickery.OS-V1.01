(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const leadId = params.get('id');
  const root   = document.getElementById('ldRoot');

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
    const status = lead.status_code || lead.status || '';
    const profit = Number(lead.gross_profit || 0);
    const margin = lead.gross_margin_pct != null ? lead.gross_margin_pct + '%' : '—';
    const profitColor = profit < 0 ? 'hsl(0,70%,50%)' : profit > 0 ? 'hsl(142,50%,40%)' : '';

    const balance = Math.max(0, Number(lead.quoted_price || 0) - Number(lead.paid_amount || 0));

    const hasQuoteId = !!lead.last_quote_id;

    root.innerHTML = `
      <div class="ld-hero">
        <div class="ld-hero-left">
          <div class="ld-avatar">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </div>
          <div>
            <div class="ld-hero-name">${esc(lead.name || 'Unnamed Lead')} ${badge(status)}</div>
            <div class="ld-hero-sub">
              ${lead.job_number ? `Job ${esc(lead.job_number)} &bull; ` : ''}
              ${lead.lead_id ? `ID ${esc(lead.lead_id)} &bull; ` : `ID ${esc(lead.id)} &bull; `}
              Added ${fmtDate(lead.created_at)}
            </div>
          </div>
        </div>
        <div class="ld-actions">
          ${lead.phone ? `<a class="ld-btn" href="tel:${esc(lead.phone.replace(/\D/g,''))}">&#128222; Call</a>` : ''}
          ${lead.email ? `<a class="ld-btn" href="mailto:${esc(lead.email)}">&#9993; Email</a>` : ''}
          <button class="ld-btn ld-btn-primary" id="ldSaveBtn" style="display:none;">Save Changes</button>
        </div>
      </div>

      <div class="ld-grid">

        <!-- LEFT COLUMN -->
        <div class="ld-left">

          <!-- Contact Info -->
          <div class="ld-card">
            <div class="ld-card-title">Contact Info</div>
            ${fieldRow('Name', lead.name)}
            ${fieldRow('Phone', lead.phone, { href: lead.phone ? `tel:${lead.phone.replace(/\D/g,'')}` : '' })}
            ${fieldRow('Email', lead.email, { href: lead.email ? `mailto:${lead.email}` : '' })}
            ${fieldRow('Address', lead.address)}
            ${fieldRow('SMS Opt-in', lead.sms_opt_in === 'true' ? 'Yes' : lead.sms_opt_in === 'false' ? 'No' : '—')}
          </div>

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
            <div class="ld-card-title">Scheduling</div>
            ${fieldRow('Scheduled Date', fmtDate(lead.scheduled_date))}
            ${fieldRow('Time Window', lead.schedule_window)}
            ${fieldRow('Preference', lead.schedule_preference)}
            ${fieldRow('Duration', lead.duration_minutes > 0 ? lead.duration_minutes + ' min' : '—')}
            ${fieldRow('Assigned To', lead.assigned_to)}
          </div>

          <!-- Notes -->
          <div class="ld-card">
            <div class="ld-card-title">
              Notes
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

          ${hasQuoteId ? `
          <!-- Quote Breakdown -->
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

          <!-- Financial Summary -->
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

        </div>
      </div>
    `;

    attachEvents(lead);
    if (hasQuoteId) loadSnapshot(lead.last_quote_id);
  }

  async function loadSnapshot(quoteId) {
    const el = document.getElementById('ldSnapshotContent');
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

      // Service + quantity header
      html += `<div style="margin-bottom:12px;">
        <div style="font-size:15px;font-weight:700;color:hsl(var(--foreground));">${esc(data.job_type_label)}</div>
        ${data.qty > 1 ? `<div style="font-size:12px;margin-top:2px;color:hsl(var(--muted-foreground));">Quantity: ${data.qty}</div>` : ''}
        ${data.classification && data.classification !== 'standard' ? `<div style="font-size:12px;margin-top:2px;color:hsl(var(--muted-foreground));">Scope: ${esc(data.classification)}</div>` : ''}
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

  async function load() {
    if (!leadId) {
      root.innerHTML = '<div class="ld-loading">No lead ID in URL.</div>';
      return;
    }
    try {
      const data = await window.Api.fetchJson('/api/leads');
      const leads = data.leads || [];
      const lead  = leads.find(l =>
        String(l.id)      === String(leadId) ||
        String(l.lead_id) === String(leadId)
      );
      if (!lead) {
        root.innerHTML = `<div class="ld-loading">Lead not found.<br><small style="opacity:.6;">Looking for: ${esc(leadId)}<br>Available: ${leads.slice(0,8).map(l=>`${esc(l.id)}${l.lead_id ? ' / '+esc(l.lead_id) : ''}`).join(', ')}</small></div>`;
        return;
      }
      render(lead);
    } catch (err) {
      root.innerHTML = `<div class="ld-loading" style="color:hsl(0,70%,50%);">Error loading lead: ${esc(err.message)}</div>`;
    }
  }

  load();
})();
