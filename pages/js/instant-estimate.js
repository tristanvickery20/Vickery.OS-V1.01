// pages/js/instant-estimate.js — Instant Estimate Wizard Engine
"use strict";

const S = { config:null, segment:null, service:null, qty:1, modules:[], idx:0, answers:{}, photos:{}, disqualified:false };
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setProgress(n) {
  ['ps1','ps2','ps3','ps4'].forEach((id,i) => {
    const el=$(id); el.className='progress-step'+(i+1<n?' done':i+1===n?' active':'');
  });
}
function reset() { Object.assign(S,{segment:null,service:null,qty:1,modules:[],idx:0,answers:{},photos:{},disqualified:false}); }

// ── Step 1: Segment ──────────────────────────────────────────────────────────
function renderSegment() {
  setProgress(1);
  $('stepContent').innerHTML = `
    <div class="seg-grid">
      ${['residential','commercial'].map(s=>`
        <div class="seg-card${S.segment===s?' picked':''}" data-seg="${s}">
          <div class="icon">${s==='residential'?'🏠':'🏢'}</div>
          <div class="label">${s==='residential'?'Residential':'Commercial'}</div>
          <div class="desc">${s==='residential'?'Home upgrades, repairs & installations':'Office, retail & industrial solutions'}</div>
        </div>`).join('')}
    </div>
    <div class="actions"><button class="btn btn-primary" id="nextSeg"${S.segment?'':' disabled'}>Next →</button></div>`;
  document.querySelectorAll('.seg-card').forEach(c=>c.addEventListener('click',()=>{ S.segment=c.dataset.seg; renderSegment(); }));
  $('nextSeg')?.addEventListener('click', renderService);
}

// ── Step 2: Service ──────────────────────────────────────────────────────────
function renderService() {
  setProgress(2);
  const svcs=(S.config.services||[]).filter(sv=>sv.segment===S.segment);
  const TC={instant:'tier-instant',instant_with_safeguards:'tier-safeguards',site_visit_required:'tier-site-visit'};
  const TL={instant:'Instant',instant_with_safeguards:'Instant',site_visit_required:'Site Visit'};
  $('stepContent').innerHTML = `
    <input class="search-box" id="svcSearch" placeholder="Search services…" autocomplete="off"/>
    <div class="service-list" id="svcList">
      ${svcs.map(sv=>`
        <div class="svc-card${S.service?.service_id===sv.service_id?' picked':''}" data-id="${sv.service_id}">
          <span class="svc-name">${esc(sv.service_name)}</span>
          <span class="tier-badge ${TC[sv.tier]||''}">${TL[sv.tier]||sv.tier}</span>
        </div>`).join('')}
    </div>
    ${S.service?.tier==='site_visit_required'?`<div class="site-visit-notice">⚠️ This service requires an on-site assessment for an accurate estimate.</div>`:''}
    <div class="actions">
      <button class="btn btn-ghost" id="backSeg">← Back</button>
      <button class="btn btn-primary" id="nextSvc"${S.service?'':' disabled'}>Next →</button>
    </div>`;
  $('svcSearch').addEventListener('input',function(){
    const q=this.value.toLowerCase();
    document.querySelectorAll('.svc-card').forEach(c=>{ c.style.display=c.querySelector('.svc-name').textContent.toLowerCase().includes(q)?'':'none'; });
  });
  document.querySelectorAll('.svc-card').forEach(c=>c.addEventListener('click',()=>{
    S.service=(S.config.services||[]).find(sv=>sv.service_id===c.dataset.id); renderService();
  }));
  $('backSeg').addEventListener('click', renderSegment);
  $('nextSvc')?.addEventListener('click', startModules);
}

// ── Step 3: Modules ──────────────────────────────────────────────────────────
function startModules() {
  S.modules=(S.service.modules_csv||'').split(',').map(m=>m.trim()).filter(Boolean).map(mid=>S.config.modulesById[mid]).filter(Boolean);
  S.idx=0; S.answers={}; S.photos={}; S.disqualified=S.service.tier==='site_visit_required';
  if(S.disqualified){ renderResult(); return; }
  renderModule();
}

function renderModule() {
  setProgress(3);
  const m=S.modules[S.idx]; if(!m){ renderResult(); return; }
  const body=m.input_type==='photo'?renderPhotoModule(m):m.input_type==='number'?renderNumberModule(m):renderSelectModule(m);
  $('stepContent').innerHTML=`
    <div class="module-header">
      <div class="module-progress">${esc(S.service.service_name)} · Question ${S.idx+1} of ${S.modules.length}</div>
      <h2 class="module-question">${esc(m.question)}</h2>
    </div>
    <div id="moduleBody">${body}</div>
    <div class="actions" style="justify-content:space-between">
      <button class="btn btn-ghost" id="modBack">${S.idx===0?'← Service':'← Back'}</button>
      <button class="btn btn-primary" id="modNext" disabled>Next →</button>
    </div>`;
  bindModuleEvents(m);
}

function renderSelectModule(m) {
  const opts=[...(m.options||[])];
  if(!opts.some(o=>/not sure|unknown|unsure/i.test(o.label||'')))
    opts.push({value:'_unsure',label:'Not sure / skip',multiplier:1.1});
  return `<div class="option-grid">${opts.map(o=>`
    <button class="option-btn${S.answers[m.module_id]===o.value?' selected':''}"
      data-val="${esc(o.value)}" data-dis="${o.disqualify?'1':''}">${esc(o.label)}</button>`).join('')}</div>`;
}

function renderNumberModule(m) {
  const min=S.service.qty_min||1, max=S.service.qty_max||20, cur=S.answers[m.module_id]??S.qty;
  return `<div class="qty-stepper">
    <button class="qty-btn" id="qtyDec"${cur<=min?' disabled':''}>−</button>
    <span class="qty-val" id="qtyVal">${cur}</span>
    <button class="qty-btn" id="qtyInc"${cur>=max?' disabled':''}>+</button>
  </div>`;
}

function renderPhotoModule(m) {
  const stored=S.photos[m.module_id]||[];
  return `<div class="photo-zone">
    <label class="photo-label" for="photoInput">
      📷 Tap to add photos
      <input type="file" id="photoInput" accept="image/*" multiple style="display:none"/>
    </label>
    <div class="thumb-row" id="thumbRow">
      ${stored.map((f,i)=>`<div class="thumb-wrap"><img class="thumb" src="${f._url}" alt="${esc(f.name)}"/>
        <button class="thumb-remove" data-idx="${i}">✕</button></div>`).join('')}
    </div>
    <p class="photo-hint">At least 1 photo required to continue.</p>
  </div>`;
}

function bindModuleEvents(m) {
  const nextBtn=$('modNext');
  const check=()=>{
    nextBtn.disabled=m.input_type==='photo'?!(S.photos[m.module_id]?.length):m.input_type==='number'?false:!S.answers[m.module_id];
  };
  if(m.input_type!=='photo'&&m.input_type!=='number'){
    document.querySelectorAll('.option-btn').forEach(btn=>btn.addEventListener('click',()=>{
      S.answers[m.module_id]=btn.dataset.val;
      if(btn.dataset.dis==='1') S.disqualified=true;
      document.querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected'); check();
    }));
  }
  if(m.input_type==='number'){
    const min=S.service.qty_min||1,max=S.service.qty_max||20;
    let cur=S.answers[m.module_id]??S.qty;
    const refresh=()=>{ $('qtyVal').textContent=cur; $('qtyDec').disabled=cur<=min; $('qtyInc').disabled=cur>=max; S.answers[m.module_id]=cur; S.qty=cur; check(); };
    $('qtyDec').addEventListener('click',()=>{ if(cur>min){cur--;refresh();} });
    $('qtyInc').addEventListener('click',()=>{ if(cur<max){cur++;refresh();} });
    refresh();
  }
  if(m.input_type==='photo'){
    if(!S.photos[m.module_id]) S.photos[m.module_id]=[];
    $('photoInput').addEventListener('change',async function(){
      for(const f of this.files){ f._url=await readFileURL(f); S.photos[m.module_id].push(f); }
      renderModule();
    });
    document.querySelectorAll('.thumb-remove').forEach(btn=>btn.addEventListener('click',()=>{
      S.photos[m.module_id].splice(Number(btn.dataset.idx),1); renderModule();
    }));
  }
  nextBtn.addEventListener('click',()=>{ S.idx++; renderModule(); });
  $('modBack').addEventListener('click',()=>{ S.idx===0?renderService():(S.idx--,renderModule()); });
  check();
}

function readFileURL(f){ return new Promise(r=>{ const fr=new FileReader(); fr.onload=e=>r(e.target.result); fr.readAsDataURL(f); }); }

// ── Step 4: Result ───────────────────────────────────────────────────────────
async function renderResult() {
  setProgress(4);
  $('stepContent').innerHTML='<div class="status-msg">Processing…</div>';
  const photoCount=Object.values(S.photos).reduce((s,a)=>s+a.length,0);
  const summary=`<div class="result-summary">
    <div class="rs-row"><span class="rs-lbl">Service</span><span>${esc(S.service.service_name)}</span></div>
    <div class="rs-row"><span class="rs-lbl">Qty</span><span>${S.qty}</span></div>
    <div class="rs-row"><span class="rs-lbl">Photos</span><span>${photoCount} attached</span></div>
    ${Object.entries(S.answers).map(([k,v])=>`<div class="rs-row"><span class="rs-lbl">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
  </div>`;
  const retryBtn=`<button class="btn btn-ghost" onclick="reset();renderSegment()">← Start Over</button>`;
  if(S.disqualified){
    $('stepContent').innerHTML=`<div class="outcome-card outcome-site-visit">
      <div class="outcome-icon">📋</div><h2>Site Visit Required</h2>
      <p>Based on your answers, this service requires an on-site assessment before we can provide an accurate quote. We'll schedule a free visit.</p>
      ${summary}
      <div class="actions" style="justify-content:center">${retryBtn}<a class="btn btn-gold" href="/contact">Request Site Visit →</a></div>
    </div>`; return;
  }
  try {
    const r=await fetch('/api/estimator/quote',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({segment:S.segment,service_id:S.service.service_id,service_name:S.service.service_name,qty:S.qty,answersByModule:S.answers,photoCount})});
    const d=await r.json();
    $('stepContent').innerHTML=`<div class="outcome-card outcome-instant">
      <div class="outcome-icon">✅</div><h2>Estimate Ready</h2>
      <p>${esc(d.message||'Your estimate has been generated!')}</p>
      ${summary}
      <div class="price-preview">Estimated total: <strong>We'll confirm pricing when we call to schedule.</strong></div>
      <div class="actions" style="justify-content:center">${retryBtn}<a class="btn btn-primary" href="/contact">Book Appointment →</a></div>
    </div>`;
  } catch(e){
    $('stepContent').innerHTML=`<div class="status-msg error-msg">Error: ${esc(e.message)}</div>`;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function init(){
  try{
    const r=await fetch('/api/estimator/config');
    const d=await r.json();
    if(!d.ok) throw new Error(d.error||'Config load failed');
    S.config=d; renderSegment();
  }catch(e){ $('stepContent').innerHTML=`<div class="status-msg error-msg">Could not load: ${esc(e.message)}</div>`; }
}
init();
