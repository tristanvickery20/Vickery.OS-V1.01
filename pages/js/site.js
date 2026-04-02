(function () {
  'use strict';

  // ── Dark mode ─────────────────────────────────────────────────────────────
  // Approach: html.dark class drives all CSS. JS reads system preference and
  // localStorage('theme') = 'dark' | 'light'. No override stored = follow system.

  var LOGO_LIGHT = '/pages/img/logo.jpg';
  var LOGO_DARK  = '/pages/img/logo-dark.png';

  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function isDarkActive() {
    return document.documentElement.classList.contains('dark');
  }

  function applyDark(dark) {
    document.documentElement.classList.toggle('dark', dark);
    // Swap logo images
    document.querySelectorAll('.logo-img').forEach(function (img) {
      img.src = dark ? LOGO_DARK : LOGO_LIGHT;
    });
    // Update toggle button icon if present
    var toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      toggleBtn.innerHTML = dark ? SVG_SUN : SVG_MOON;
    }
  }

  function initDark() {
    var stored = localStorage.getItem('theme');
    // Mark that a manual override is NOT set (used by CSS media query)
    if (!stored) {
      document.documentElement.removeAttribute('data-theme-manual');
    } else {
      document.documentElement.setAttribute('data-theme-manual', stored);
    }
    var dark = stored === 'dark' || (!stored && systemDark.matches);
    applyDark(dark);
  }

  // Listen for OS-level changes (no manual override stored)
  systemDark.addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) applyDark(e.matches);
  });

  // SVG icons for the toggle button
  var SVG_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SVG_SUN  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

  function injectThemeToggle() {
    var inner = document.querySelector('.header-inner');
    if (!inner || document.getElementById('themeToggle')) return;

    var btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.className = 'theme-toggle';
    btn.setAttribute('aria-label', isDarkActive() ? 'Switch to light mode' : 'Switch to dark mode');
    btn.innerHTML = isDarkActive() ? SVG_SUN : SVG_MOON;

    btn.addEventListener('click', function () {
      var goingDark = !isDarkActive();
      localStorage.setItem('theme', goingDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme-manual', goingDark ? 'dark' : 'light');
      applyDark(goingDark);
    });

    // Insert before nav-menu-wrap (or append to header-inner)
    var wrap = inner.querySelector('.nav-menu-wrap');
    if (wrap) {
      inner.insertBefore(btn, wrap);
    } else {
      inner.appendChild(btn);
    }
  }

  // ── Electric burst on click ───────────────────────────────────────────────
  function wireElectric() {
    var sel = '.cta-btn, .nav-cta-link, .service-cta, .nav-btn, a.cta';
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('click', function () {
        var burst = document.createElement('span');
        burst.className = 'elec-burst';
        el.appendChild(burst);
        setTimeout(function () {
          if (burst.parentNode) burst.parentNode.removeChild(burst);
        }, 780);
      });
    });
  }

  // ── Dropdown nav ──────────────────────────────────────────────────────────
  function wireDropdown() {
    var btn      = document.getElementById('navMenuBtn');
    var dropdown = document.getElementById('navDropdown');
    if (!btn || !dropdown) return;

    function open() {
      dropdown.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      dropdown.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.contains('is-open') ? close() : open();
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    dropdown.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', close);
    });
  }

  // ── Scroll hint (home page only) ───────────────────────────────────────────
  function wireScrollHint() {
    var hint = document.getElementById('scrollHint');
    if (!hint) return;
    window.addEventListener('scroll', function () {
      if (window.scrollY > 90) hint.classList.add('hidden');
    }, { passive: true });
  }

  // ── Nav active state ───────────────────────────────────────────────────────
  function wireNav() {
    var path = window.location.pathname;
    document.querySelectorAll('.nav-link[data-page]').forEach(function (el) {
      var pg = el.getAttribute('data-page');
      if (
        (pg === 'home'         && (path === '/' || path === ''))        ||
        (pg === 'services'     && path === '/services')                 ||
        (pg === 'about'        && path === '/about')                    ||
        (pg === 'contact'      && path === '/contact')                  ||
        (pg === 'service-area' && path === '/service-area')             ||
        (pg === 'why-vickery'  && path === '/why-vickery')              ||
        (pg === 'reviews'      && path === '/reviews')                  ||
        (pg === 'referral'     && path === '/referral')                 ||
        (pg === 'financing'    && path === '/financing')
      ) {
        el.classList.add('active');
      }
    });
  }

  // ── Footer license badge ───────────────────────────────────────────────────
  var TECL = '';   // ← set to your actual TECL number when ready, e.g. '12345'

  function wireFooterLicense() {
    document.querySelectorAll('.site-footer').forEach(function (footer) {
      if (footer.querySelector('.footer-license')) return;
      var badge = document.createElement('span');
      badge.className = 'footer-license';
      badge.textContent = 'Licensed & Insured' + (TECL ? ' · TECL #' + TECL : '');
      footer.appendChild(badge);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Dark mode must run before paint — already applied at top of <head> via
    // inline script for flash-prevention, but we reinforce here for safety.
    initDark();
    injectThemeToggle();
    wireElectric();
    wireDropdown();
    wireScrollHint();
    wireNav();
    wireFooterLicense();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
