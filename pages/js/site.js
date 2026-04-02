(function () {
  'use strict';

  // ── Electric click animation ───────────────────────────────────────────────
  // Adds .elec-zap to the clicked element, which triggers the @keyframes
  // electricZap animation defined in brand.css, then cleans up after.
  function wireElectric() {
    var sel = '.cta-btn, .nav-btn-link, .service-cta, .nav-btn, a.cta';
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('click', function () {
        el.classList.remove('elec-zap');
        void el.offsetWidth;          // force style recalc so animation restarts
        el.classList.add('elec-zap');
        setTimeout(function () { el.classList.remove('elec-zap'); }, 800);
      });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireElectric();
      wireScrollHint();
      wireNav();
    });
  } else {
    wireElectric();
    wireScrollHint();
    wireNav();
  }
})();
