(function () {
  'use strict';

  // ── Electric burst on click ───────────────────────────────────────────────
  // Injects a child <span> so the burst animation runs on a transition-free
  // element — the parent button's own CSS transition never smooths the flicker.
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

    // Close when clicking outside
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== btn) close();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // Close when a nav link is clicked (page navigates)
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
  // Appends "Licensed & Insured · TECL #XXXXXX" under the footer copy.
  // Update the TECL number here when ready.
  var TECL = '';   // ← set to your actual TECL number, e.g. '12345'

  function wireFooterLicense() {
    document.querySelectorAll('.site-footer').forEach(function (footer) {
      if (footer.querySelector('.footer-license')) return;  // already injected
      var badge = document.createElement('span');
      badge.className = 'footer-license';
      badge.textContent = 'Licensed & Insured' + (TECL ? ' · TECL #' + TECL : '');
      footer.appendChild(badge);
    });
  }

  function init() {
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
