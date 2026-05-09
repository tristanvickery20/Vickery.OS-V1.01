(function () {
  if (window.location.pathname !== "/crm/lead") return;

  var cachedTechs = null;
  var loading = false;

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function techName(t) {
    return String(t.name || [t.first_name || t.firstName, t.last_name || t.lastName].filter(Boolean).join(" ") || t.username || t.id || "").trim();
  }

  async function loadTechs() {
    if (cachedTechs) return cachedTechs;
    if (loading) {
      return new Promise(function (resolve) {
        var tries = 0;
        var timer = setInterval(function () {
          tries += 1;
          if (cachedTechs || tries > 20) {
            clearInterval(timer);
            resolve(cachedTechs || []);
          }
        }, 100);
      });
    }
    loading = true;
    try {
      var r = await fetch("/api/techs", { cache: "no-store" });
      var d = await r.json();
      cachedTechs = Array.isArray(d.techs) ? d.techs : Array.isArray(d.staff) ? d.staff : [];
    } catch (_) {
      cachedTechs = [];
    } finally {
      loading = false;
    }
    return cachedTechs;
  }

  async function replaceAssignedInput() {
    var input = document.getElementById("ldSchedAssigned");
    if (!input || input.tagName === "SELECT") return;

    var current = String(input.value || "").trim();
    var select = document.createElement("select");
    select.id = "ldSchedAssigned";
    select.className = input.className || "ld-status-select";
    select.setAttribute("aria-label", "Assigned technician");
    select.innerHTML = '<option value="">Loading staff…</option>';
    input.replaceWith(select);

    var techs = await loadTechs();
    if (!techs.length) {
      select.innerHTML = current
        ? '<option value="' + esc(current) + '">' + esc(current) + ' (current)</option><option value="" disabled>Staff unavailable</option>'
        : '<option value="" disabled selected>Staff unavailable</option>';
      return;
    }

    var names = techs.map(techName).filter(Boolean);
    var seen = {};
    names = names.filter(function (n) {
      var key = n.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    if (current && !names.some(function (n) { return n.toLowerCase() === current.toLowerCase(); })) {
      names.unshift(current);
    }
    select.innerHTML = '<option value="">— Unassigned —</option>' + names.map(function (name) {
      return '<option value="' + esc(name) + '"' + (current && name.toLowerCase() === current.toLowerCase() ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join("");
  }

  var observer = new MutationObserver(function () { replaceAssignedInput(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "ldEditScheduleBtn") {
      setTimeout(replaceAssignedInput, 0);
      setTimeout(replaceAssignedInput, 250);
    }
  });
})();
