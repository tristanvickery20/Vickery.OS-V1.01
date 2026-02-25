window.LeadsHelpers = (() => {

  // Clean unified pipeline
  const STATUS_OPTIONS = [
    "Lead",
    "Requested Estimate",
    "Estimate Sent",
    "Approved",
    "Scheduled",
    "In Progress",
    "Complete",
    "Invoiced",
    "Paid",
    "Closed",
  ];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  function makeStatusSelect(current) {
    const select = document.createElement("select");

    for (const opt of STATUS_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === current) o.selected = true;
      select.appendChild(o);
    }

    return select;
  }

  function makeTechSelect(techs, currentTechId) {
    const select = document.createElement("select");

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(unassigned)";
    select.appendChild(none);

    for (const t of techs) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = `${t.name} (${t.id})`;
      if (t.id === currentTechId) o.selected = true;
      select.appendChild(o);
    }

    return select;
  }

  function isScheduling(statusValue, dateValue, originalStatus) {
    const schedulingStatuses = new Set(["Scheduled", "In Progress"]);

    if (schedulingStatuses.has(statusValue)) return true;

    // If date is entered but status wasn’t scheduling before
    if (dateValue && !schedulingStatuses.has(originalStatus)) return true;

    return false;
  }

  function numInput(val, step) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.step = step || "1";
    inp.value = String(val || 0);
    inp.style.width = "80px";
    return inp;
  }

  function handleApiError(result, warn) {
    if (result.error === "DEPOSIT_REQUIRED") {
      warn.textContent = "Deposit required. Check Override to proceed.";
    } else if (result.error === "INVALID_STAGE_TRANSITION") {
      warn.textContent = result.message || "Stage transition not allowed.";
    } else {
      warn.textContent = result.error || "Update failed";
    }
  }

  return {
    esc,
    makeStatusSelect,
    makeTechSelect,
    isScheduling,
    numInput,
    handleApiError
  };

})();