(function () {
  'use strict';

  // ── Electric burst on click ───────────────────────────────────────────────
  // Injects a <span class="elec-burst"> child into the button on click.
  // Using a child element means the button's own CSS transition never smooths
  // out the flicker — the burst animates freely with linear timing.
  function wireElectric() {
    var sel = '.cta-btn, .nav-btn-link, .service-cta, .nav-btn, a.cta';
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

  // ── Hamburger menu (injected into .header-inner) ──────────────────────────
  function wireHamburger() {
    var headerInner = document.querySelector('.header-inner');
    var appNav      = document.querySelector('.app-nav');
    if (!headerInner || !appNav) return;

    var btn = document.createElement('button');
    btn.className = 'nav-hamburger';
    btn.setAttribute('aria-label', 'Open navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';

    var navBtnLink = headerInner.querySelector('.nav-btn-link');
    headerInner.insertBefore(btn, navBtnLink || null);

    btn.addEventListener('click', function () {
      var open = appNav.classList.toggle('nav-open');
      btn.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    });

    appNav.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        appNav.classList.remove('nav-open');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Open navigation menu');
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

  function init() {
    wireElectric();
    wireHamburger();
    wireScrollHint();
    wireNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
