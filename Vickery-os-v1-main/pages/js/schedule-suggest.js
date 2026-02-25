window.ScheduleSuggest = (() => {
  async function fetchSuggestion(targetDate, durationMinutes, preference) {
    const resp = await fetch("/api/schedule/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_date: targetDate,
        duration_minutes: Number(durationMinutes) || 60,
        preference: preference || "",
      }),
    });
    return resp.json();
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function createSuggestBtn(opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Suggest";
    btn.style.cssText = "font-size:13px;padding:4px 10px;";

    btn.addEventListener("click", async () => {
      const dateVal = opts.getDate ? opts.getDate() : todayStr();
      const targetDate = (dateVal || "").slice(0, 10) || todayStr();
      const dur = opts.getDuration ? opts.getDuration() : 60;
      const pref = opts.getPreference ? opts.getPreference() : "";

      opts.setMsg("Finding slot...");
      try {
        const result = await fetchSuggestion(targetDate, dur, pref);
        if (result.ok) {
          opts.setMsg(result.reason);
          if (opts.onApply) {
            const applyBtn = document.createElement("button");
            applyBtn.type = "button";
            applyBtn.textContent = "Apply";
            applyBtn.style.cssText = "font-size:12px;padding:2px 8px;margin-left:6px;background:hsl(var(--primary));color:white;border:none;border-radius:4px;cursor:pointer;";
            applyBtn.addEventListener("click", () => {
              opts.onApply(result.suggested_tech_id, result.suggested_start_time);
              opts.setMsg("Applied \u2705");
            });
            opts.appendEl(applyBtn);
          }
        } else {
          opts.setMsg(result.reason || result.error || "No slot found.");
        }
      } catch (e) { opts.setMsg("Error: " + e.message); }
    });

    return btn;
  }

  return { createSuggestBtn, fetchSuggestion, todayStr };
})();
