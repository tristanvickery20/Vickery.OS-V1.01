(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────────
  var PHONE         = '(409) 555-0100';
  var EMAIL         = 'info@vickeryelectric.com';
  var TECL          = '';          // set to TECL license number when ready
  var LOGO_LIGHT    = '/pages/img/logo-light.png';
  var LOGO_DARK     = '/pages/img/logo-dark.png';
  var SWORD_LIGHT   = '/pages/img/sword-light.png';
  var SWORD_DARK    = '/pages/img/sword-dark-mode.png';

  // ── SVG icon snippets ─────────────────────────────────────────────────────
  var ICON_MOON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var ICON_SUN  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var ICON_PHONE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.18 12.7 19.79 19.79 0 0 1 1.1 4.07 2 2 0 0 1 3.08 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var ICON_EMAIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';

  // ── Dark mode ─────────────────────────────────────────────────────────────
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function applyDark(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelectorAll('.logo-img').forEach(function (img) {
      img.src = dark ? LOGO_DARK : LOGO_LIGHT;
    });
    document.querySelectorAll('.sword-icon, .footer-crm-staff, .section-divider-icon').forEach(function (img) {
      img.src = dark ? SWORD_DARK : SWORD_LIGHT;
    });
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.innerHTML = dark
        ? ICON_SUN  + '<span>Light mode</span>'
        : ICON_MOON + '<span>Dark mode</span>';
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function initDark() {
    var stored = localStorage.getItem('theme');
    if (stored) {
      document.documentElement.setAttribute('data-theme-manual', stored);
    } else {
      document.documentElement.removeAttribute('data-theme-manual');
    }
    applyDark(stored === 'dark' || (!stored && systemDark.matches));
  }

  function toggleTheme() {
    var goingDark = !isDark();
    localStorage.setItem('theme', goingDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-manual', goingDark ? 'dark' : 'light');
    applyDark(goingDark);
  }

  systemDark.addEventListener('change', function (e) {
    if (!localStorage.getItem('theme')) applyDark(e.matches);
  });

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

  // ── Inject theme toggle pill into dropdown ────────────────────────────────
  function injectThemeToggle() {
    var dropdown = document.getElementById('navDropdown');
    if (!dropdown || dropdown.querySelector('.nav-theme-row')) return;

    var sep = document.createElement('div');
    sep.className = 'nav-dropdown-divider';
    sep.style.marginTop = '4px';

    var row = document.createElement('div');
    row.className = 'nav-theme-row';

    var toggle = document.createElement('button');
    toggle.className = 'theme-toggle';
    toggle.id = 'themeToggle';
    var dark = isDark();
    toggle.innerHTML = dark
      ? ICON_SUN  + '<span>Light mode</span>'
      : ICON_MOON + '<span>Dark mode</span>';
    toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleTheme();
    });

    row.appendChild(toggle);
    dropdown.appendChild(sep);
    dropdown.appendChild(row);
  }

  // ── Electric burst on click ───────────────────────────────────────────────
  function wireElectric() {
    var sel = '.cta-btn, .nav-cta-link, .service-cta, .nav-btn, a.cta';
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('click', function (e) {
        var href = el.getAttribute('href');
        var isNavLink = href &&
          !href.startsWith('#') &&
          !href.startsWith('javascript') &&
          !href.startsWith('tel:') &&
          !href.startsWith('mailto:');

        if (isNavLink) e.preventDefault();

        var burst = document.createElement('span');
        burst.className = 'elec-burst';
        el.appendChild(burst);

        if (isNavLink) {
          setTimeout(function () { window.location.href = href; }, 300);
        }

        setTimeout(function () {
          if (burst.parentNode) burst.parentNode.removeChild(burst);
        }, 780);
      });
    });
  }

  // ── Header scroll transparency ─────────────────────────────────────────────
  function wireHeaderScroll() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    window.addEventListener('scroll', function () {
      header.classList.toggle('is-scrolled', window.scrollY > 40);
    }, { passive: true });
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

  // ── Footer — full rebuild ─────────────────────────────────────────────────
  function wireFooter() {
    var year    = new Date().getFullYear();
    var teclTxt = TECL ? ' \u00b7 TECL #' + TECL : '';

    var bodyHTML =
      '<div class="footer-body">' +
        '<div class="footer-col">' +
          '<div class="footer-section-head">Contact Info</div>' +
          '<a href="tel:+14095550100" class="footer-contact-row">' +
            '<div class="footer-icon-ring">' + ICON_PHONE + '</div>' +
            PHONE +
          '</a>' +
          '<a href="mailto:' + EMAIL + '" class="footer-contact-row">' +
            '<div class="footer-icon-ring">' + ICON_EMAIL + '</div>' +
            EMAIL +
          '</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<div class="footer-section-head">Office Hours</div>' +
          '<div class="footer-hours-table">' +
            '<span class="footer-hours-day">Mon \u2013 Fri:</span>' +
            '<span class="footer-hours-time">7:00 AM \u2013 5:00 PM</span>' +
            '<span class="footer-hours-day">Saturday:</span>' +
            '<span class="footer-hours-closed">Closed</span>' +
            '<span class="footer-hours-day">Sunday:</span>' +
            '<span class="footer-hours-closed">Closed</span>' +
          '</div>' +
        '</div>' +
        '<div class="footer-crm-col">' +
          '<a href="/login" class="footer-crm-link" title="Staff portal">' +
            '<img src="/pages/img/sword-light.png" class="footer-crm-staff" alt="Staff login">' +
          '</a>' +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom-bar">' +
        '<span>\u00a9 ' + year + ' Vickery Electric. All rights reserved.</span>' +
        '<span>Licensed &amp; Insured' + teclTxt + '</span>' +
      '</div>';

    document.querySelectorAll('.site-footer').forEach(function (footer) {
      if (footer.dataset.veBuilt) return;
      footer.dataset.veBuilt = '1';
      // Only override layout properties; let page background and color inherit
      footer.style.padding    = '0';
      footer.style.textAlign  = 'left';
      footer.style.position   = 'relative';
      footer.innerHTML = bodyHTML;
      // applyDark runs before wireFooter — correct sword/logo after injection
      var dark = isDark();
      footer.querySelectorAll('.footer-crm-staff').forEach(function (img) {
        img.src = dark ? SWORD_DARK : SWORD_LIGHT;
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    initDark();
    injectThemeToggle();
    wireDropdown();
    wireElectric();
    wireHeaderScroll();
    wireScrollHint();
    wireNav();
    wireFooter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
