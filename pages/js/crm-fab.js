/**
 * crm-fab.js — Global floating action button for all CRM pages.
 * Excluded automatically if the page already has a .cal-fab-wrap (scheduler).
 */
(function () {
  if (document.querySelector(".cal-fab-wrap")) return; // scheduler has its own FAB

  const ACTIONS = [
    { label: "New Lead",    icon: "👤", href: "/crm/lead?new=1" },
    { label: "New Job",     icon: "📋", href: "/crm/schedule?action=new" },
    { label: "New Invoice", icon: "🧾", href: "/invoices?action=new" },
    { label: "Log Time",    icon: "⏱",  href: "/crm/time" },
  ];

  const style = document.createElement("style");
  style.textContent = `
    .g-fab-wrap { position:fixed; right:18px; bottom:24px; z-index:900; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
    .g-fab {
      width:52px; height:52px; border-radius:50%;
      background: hsl(217 91% 55%);
      color:#fff; border:none; font-size:26px; line-height:1;
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; box-shadow:0 4px 18px rgba(45,106,224,0.50);
      transition: transform .2s, box-shadow .2s;
    }
    .g-fab:hover { box-shadow:0 6px 24px rgba(45,106,224,0.65); }
    .g-fab.open { transform:rotate(45deg); }
    .g-fab-dial {
      display:flex; flex-direction:column; gap:8px; align-items:flex-end;
      opacity:0; pointer-events:none;
      transform:translateY(10px);
      transition: opacity .18s, transform .18s;
    }
    .g-fab-dial.open { opacity:1; pointer-events:all; transform:translateY(0); }
    .g-fab-action { display:flex; align-items:center; gap:8px; }
    .g-fab-lbl {
      background: rgba(14,24,55,0.92);
      color:#e6eefc; font-size:13px; font-weight:600;
      padding:6px 12px; border-radius:8px;
      white-space:nowrap; border:1px solid rgba(100,150,255,0.18);
    }
    .g-fab-lbl:hover { background: rgba(45,106,224,0.22); }
    .g-fab-icon-btn {
      width:40px; height:40px; border-radius:50%;
      background: hsl(217 60% 28%);
      color:#fff; border:none; font-size:16px;
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,0.3);
    }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "g-fab-wrap";

  const dial = document.createElement("div");
  dial.className = "g-fab-dial";
  dial.innerHTML = ACTIONS.map(a =>
    `<div class="g-fab-action">
      <a href="${a.href}" class="g-fab-lbl">${a.label}</a>
      <a href="${a.href}" class="g-fab-icon-btn">${a.icon}</a>
    </div>`
  ).join("");

  const btn = document.createElement("button");
  btn.className = "g-fab";
  btn.innerHTML = "+";
  btn.setAttribute("aria-label", "Quick actions");

  btn.addEventListener("click", () => {
    const open = dial.classList.toggle("open");
    btn.classList.toggle("open", open);
  });

  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) {
      dial.classList.remove("open");
      btn.classList.remove("open");
    }
  });

  wrap.appendChild(dial);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
})();
