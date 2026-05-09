const { getSheetsClient } = require('../lib/sheets');

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseJsonSafe(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function readTab(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function handleGetLeadMaterials(req, res) {
  try {
    const m = req.url.match(/^\/api\/leads\/([^/?]+)\/materials/);
    const leadId = decodeURIComponent((m && m[1]) || '').trim();
    if (!leadId) return json(res, 400, { ok: false, error: 'lead_id required' });

    const sheets = await getSheetsClient();
    const crmId = process.env.CRM_SHEET_ID;
    const estId = process.env.ESTIMATOR_V2_SHEET_ID;

    const leadsRows = await readTab(sheets, crmId, 'Leads!A1:AZ5000');
    const lh = leadsRows[0] || [];
    const lid = lh.indexOf('id');
    const lqid = lh.indexOf('last_quote_id');
    const leadRow = (leadsRows.slice(1).find(r => String(r[lid] || '').trim() === leadId) || null);
    if (!leadRow) return json(res, 404, { ok: false, error: 'Lead not found' });

    const quoteId = String(leadRow[lqid] || '').trim();
    if (!quoteId) return json(res, 200, { ok: true, lead_id: leadId, quote_id: '', materials: [], warnings: ['No quote is linked to this lead.'] });

    const snapRows = await readTab(sheets, crmId, 'QuoteSnapshots!A1:AZ5000');
    const sh = snapRows[0] || [];
    const sqid = sh.indexOf('quote_id');
    const sev = sh.indexOf('event_type');
    const sJob = sh.indexOf('job_type_id');
    const sOpts = sh.indexOf('selected_options_json');
    const sAdds = sh.indexOf('selected_addons_json');

    const snaps = snapRows.slice(1).filter(r => String(r[sqid] || '').trim() === quoteId);
    const snap = snaps.find(r => String(r[sev] || '').trim() === 'locked') || snaps[snaps.length - 1];
    if (!snap) return json(res, 200, { ok: true, lead_id: leadId, quote_id: quoteId, materials: [], warnings: ['No quote snapshot was found.'] });

    const selectedOptions = parseJsonSafe(String(snap[sOpts] || '{}'), {});
    const answers = selectedOptions && typeof selectedOptions === 'object' ? (selectedOptions.answers || {}) : {};
    const addonIds = parseJsonSafe(String(snap[sAdds] || '[]'), []);
    const jobTypeId = String(snap[sJob] || '').trim();

    if (!estId) return json(res, 200, { ok: true, lead_id: leadId, quote_id: quoteId, materials: [], warnings: ['Estimator V2 sheet is not configured for material extraction.'] });

    const [materialsRows, itemsRows, multRows, addonsRows] = await Promise.all([
      readTab(sheets, estId, 'Materials!A1:Z3000').catch(() => []),
      readTab(sheets, estId, 'AssemblyItems!A1:Z5000').catch(() => []),
      readTab(sheets, estId, 'Driver_Multipliers!A1:Z3000').catch(() => []),
      readTab(sheets, estId, 'AddOns!A1:Z3000').catch(() => []),
    ]);

    const matH = materialsRows[0] || [];
    const itemH = itemsRows[0] || [];
    const mulH = multRows[0] || [];
    const addH = addonsRows[0] || [];

    const matNameById = {};
    for (const r of materialsRows.slice(1)) {
      const id = String(r[matH.indexOf('material_id')] || '').trim();
      if (!id) continue;
      matNameById[id] = String(r[matH.indexOf('material_name')] || r[matH.indexOf('name')] || id).trim();
    }

    const out = new Map();
    const add = (name, quantity, unit, source, notes) => {
      if (!name) return;
      const key = [name, unit || '', source || '', notes || ''].join('|').toLowerCase();
      if (!out.has(key)) out.set(key, { name, quantity: 0, unit: unit || 'each', source: source || 'Base service', notes: notes || '' });
      const row = out.get(key);
      row.quantity += Number(quantity) || 0;
    };

    for (const r of itemsRows.slice(1)) {
      if (String(r[itemH.indexOf('assembly_id')] || '').trim() !== jobTypeId) continue;
      if (String(r[itemH.indexOf('item_type')] || '').trim().toLowerCase() !== 'material') continue;
      const refId = String(r[itemH.indexOf('item_ref_id')] || '').trim();
      add(matNameById[refId] || refId, Number(r[itemH.indexOf('qty_per_unit')] || 0), String(r[itemH.indexOf('unit')] || 'each'), 'Base service', String(r[itemH.indexOf('notes')] || ''));
    }

    const addonSet = new Set(Array.isArray(addonIds) ? addonIds.map(String) : []);
    for (const r of addonsRows.slice(1)) {
      const id = String(r[addH.indexOf('addon_id')] || '').trim();
      if (!id || !addonSet.has(id)) continue;
      const mat = String(r[addH.indexOf('material_id')] || '').trim();
      const name = matNameById[mat] || String(r[addH.indexOf('name')] || id).trim();
      add(name, Number(r[addH.indexOf('material_qty')] || r[addH.indexOf('qty')] || 1), String(r[addH.indexOf('material_unit')] || r[addH.indexOf('unit')] || 'each'), 'Add-on', String(r[addH.indexOf('notes')] || ''));
    }

    const multIdxQ = mulH.indexOf('driver_id');
    const multIdxOpt = mulH.indexOf('option_id');
    const multIdxMat = mulH.indexOf('material_id');
    const multIdxQty = mulH.indexOf('material_qty');
    const multIdxNote = mulH.indexOf('material_note');
    if (multIdxQ >= 0 && multIdxOpt >= 0 && multIdxMat >= 0) {
      for (const r of multRows.slice(1)) {
        const q = String(r[multIdxQ] || '').trim();
        const o = String(r[multIdxOpt] || '').trim();
        if (!q || !o) continue;
        if (String(answers[q] || '') !== o) continue;
        const mat = String(r[multIdxMat] || '').trim();
        add(matNameById[mat] || mat, Number(r[multIdxQty] || 1), 'each', 'Modifier', String(r[multIdxNote] || ''));
      }
    }

    const materials = Array.from(out.values()).map(m => ({ ...m, quantity: m.quantity || 1 }));
    const warnings = [];
    if (!materials.length) warnings.push('No material list was captured for this quote yet.');

    return json(res, 200, { ok: true, lead_id: leadId, quote_id: quoteId, materials, warnings });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetLeadMaterials };
