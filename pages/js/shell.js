function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

function ensureBackdrop() {
  var bd = document.getElementById("backdrop");
  if (bd) return bd;

  bd = document.createElement("div");
  bd.id = "backdrop";
  bd.className = "backdrop";
  document.body.insertBefore(bd, document.body.firstChild);
  return bd;
}

// iOS Safari ignores overflow:hidden on body — block touchmove on the backdrop/body
// but allow native scroll inside the sidebar nav.
var _navTouchStartY = 0;

function _blockBodyTouch(e) {
  // If the touch target is inside the scrollable nav, allow it
  var nav = qs(".sidebar-nav");
  if (nav && nav.contains(e.target)) return;
  e.preventDefault();
}

function _navBoundaryGuard(e) {
  // Prevent rubber-band when nav is at top or bottom edge
  var nav = qs(".sidebar-nav");
  if (!nav) return;
  var touch = e.touches[0];
  var delta = _navTouchStartY - touch.clientY;
  var atTop    = nav.scrollTop === 0;
  var atBottom = nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1;
  if ((atTop && delta < 0) || (atBottom && delta > 0)) {
    e.preventDefault();
  }
}

function _navTouchStart(e) {
  _navTouchStartY = e.touches[0].clientY;
}

function openSidebar() {
  var sb = qs(".sidebar");
  var bd = ensureBackdrop();
  if (sb) sb.classList.add("open");
  if (bd) bd.classList.add("show");
  document.body.style.overflow = "hidden";
  // iOS Safari: block body bounce and guard nav edges
  document.addEventListener("touchmove", _blockBodyTouch, { passive: false });
  var nav = qs(".sidebar-nav");
  if (nav) {
    nav.addEventListener("touchstart", _navTouchStart, { passive: true });
    nav.addEventListener("touchmove", _navBoundaryGuard, { passive: false });
  }
}

function closeSidebar() {
  var sb = qs(".sidebar");
  var bd = ensureBackdrop();
  if (sb) sb.classList.remove("open");
  if (bd) bd.classList.remove("show");
  document.body.style.overflow = "";
  document.removeEventListener("touchmove", _blockBodyTouch);
  var nav = qs(".sidebar-nav");
  if (nav) {
    nav.removeEventListener("touchstart", _navTouchStart);
    nav.removeEventListener("touchmove", _navBoundaryGuard);
  }
}

function getPageTitle() {
  var h1 = qs(".page-header-row h1") || qs("h1");
  if (h1 && h1.textContent) return h1.textContent.trim();
  // fallback to document title before bullet
  var t = document.title || "CRM";
  return t.split("•")[0].trim();
}

function ensureMobileBar() {
  // invoices has its own bar; if present, do nothing
  if (qs(".mobile-bar")) return;

  var main = qs(".main-area");
  if (!main) return;

  var bar = document.createElement("div");
  bar.className = "mobile-bar";
  bar.innerHTML =
    '<button class="m-btn" id="menuBtn">Menu</button>' +
    '<div class="m-title" id="mTitle"></div>' +
    '<button class="m-btn" id="mActionBtn">Refresh</button>';

  main.insertBefore(bar, main.firstChild);

  var title = qs("#mTitle");
  if (title) title.textContent = getPageTitle();

  var menuBtn = qs("#menuBtn");
  if (menuBtn) menuBtn.addEventListener("click", openSidebar);

  // "Refresh" button: if the page already has #refreshBtn, click it.
  // Otherwise it does nothing (safe).
  var actionBtn = qs("#mActionBtn");
  if (actionBtn) {
    actionBtn.addEventListener("click", function() {
      var rb = document.getElementById("refreshBtn");
      if (rb && typeof rb.click === "function") rb.click();
    });
  }
}

function initCreateDropdown() {
  var createBtn = qs(".create-btn");
  var createMenu = qs(".create-menu");
  if (!createBtn || !createMenu) return;

  createBtn.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    createMenu.classList.toggle("open");
  });

  document.addEventListener("click", function(e) {
    if (!createMenu.contains(e.target) && e.target !== createBtn) {
      createMenu.classList.remove("open");
    }
  });
}

function highlightNav() {
  var path = window.location.pathname;
  qsa(".sidebar-link[data-nav]").forEach(function(link) {
    var nav = link.getAttribute("data-nav");
    if (!nav) return;

    // exact match or prefix match
    var active =
      nav === path ||
      (nav !== "/" && nav !== "" && path.indexOf(nav) === 0);

    if (active) link.classList.add("active");
    else link.classList.remove("active");
  });
}

function closeDrawerOnNavClick() {
  qsa(".sidebar a").forEach(function(a) {
    a.addEventListener("click", function() {
      if (window.matchMedia && window.matchMedia("(max-width: 980px)").matches) {
        closeSidebar();
      }
    });
  });
}

function initShell() {
  ensureBackdrop().addEventListener("click", closeSidebar);

  ensureMobileBar();
  initCreateDropdown();
  highlightNav();
  closeDrawerOnNavClick();

  // safety: close drawer on ESC
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeSidebar();
  });
}

function loadSidebar() {
  var mount = document.getElementById("sidebarMount");
  if (!mount) return;

  fetch("/pages/partials/sidebar.html", { cache: "no-store" })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      mount.innerHTML = html;
      initShell();
    })
    .catch(function(err) {
      console.error("Sidebar load error:", err);
      initShell();
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadSidebar);
} else {
  loadSidebar();
}