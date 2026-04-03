(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────────
  var TECL          = '';            // ← set to your TECL licence number when ready
  var WORK_SCHEDULE = 'Mon–Fri · 7:00 AM – 5:00 PM';
  var LOGO_LIGHT    = '/pages/img/logo.jpg';
  var LOGO_DARK     = '/pages/img/logo-dark.png';

  // ── Dark mode ─────────────────────────────────────────────────────────────
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function applyDark(dark) {
    document.documentElement.classList.toggle('dark', dark);
    // Swap logo src
    document.querySelectorAll('.logo-img').forEach(function (img) {
      img.src = dark ? LOGO_DARK : LOGO_LIGHT;
    });
    // Update every toggle knob's aria-label and the CSS ::after handles the visuals
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-checked', dark ? 'true' : 'false');
    });
    // Update label text in dropdown rows
    document.querySelectorAll('.nav-theme-label').forEach(function (el) {
      el.textContent = dark ? 'Light mode' : 'Dark mode';
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

  // React to OS-level changes when no manual override is stored
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

  // ── Inject theme toggle row into dropdown ─────────────────────────────────
  function injectThemeToggle() {
    var dropdown = document.getElementById('navDropdown');
    if (!dropdown || dropdown.querySelector('.nav-theme-row')) return;

    // Small divider
    var sep = document.createElement('div');
    sep.className = 'nav-dropdown-divider';
    sep.style.marginTop = '4px';

    var row = document.createElement('div');
    row.className = 'nav-theme-row';

    var label = document.createElement('span');
    label.className = 'nav-theme-label';
    label.textContent = isDark() ? 'Light mode' : 'Dark mode';

    var toggle = document.createElement('button');
    toggle.className = 'theme-toggle';
    toggle.id = 'themeToggle';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', isDark() ? 'true' : 'false');
    toggle.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();   // keep dropdown open
      toggleTheme();
    });

    row.appendChild(label);
    row.appendChild(toggle);
    row.addEventListener('click', function () { toggleTheme(); });

    dropdown.appendChild(sep);
    dropdown.appendChild(row);
  }

  // ── Electric burst on click ───────────────────────────────────────────────
  // For navigation links we delay the page change 300ms so the flash is visible.
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

        // Append burst child — its own animation, not affected by parent transition
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

  // ── Footer extras (hours + license) ───────────────────────────────────────
  function wireFooter() {
    document.querySelectorAll('.site-footer').forEach(function (footer) {
      if (!footer.querySelector('.footer-hours')) {
        var h = document.createElement('span');
        h.className = 'footer-hours';
        h.textContent = WORK_SCHEDULE;
        footer.appendChild(h);
      }
      if (!footer.querySelector('.footer-license')) {
        var b = document.createElement('span');
        b.className = 'footer-license';
        b.textContent = 'Licensed & Insured' + (TECL ? ' \u00b7 TECL #' + TECL : '');
        footer.appendChild(b);
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    initDark();          // must run first to set class before render
    injectThemeToggle(); // needs dropdown to exist (DOM ready)
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
