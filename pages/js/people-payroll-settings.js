(function () {
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  fetch("/api/hr/payroll/settings").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) return;
    var s = d.settings;
    document.getElementById("workingDaySource").value = s.working_day_source || "attendance";
    document.getElementById("holidayHandling").value   = s.holiday_handling   || "exclude";
    document.getElementById("halfDayFraction").value   = s.half_day_fraction  || "0.5";
    document.getElementById("payPeriodType").value     = s.pay_period_type    || "monthly";
  });

  document.getElementById("saveBtn").addEventListener("click", function () {
    var body = {
      working_day_source: document.getElementById("workingDaySource").value,
      holiday_handling:   document.getElementById("holidayHandling").value,
      half_day_fraction:  document.getElementById("halfDayFraction").value,
      pay_period_type:    document.getElementById("payPeriodType").value,
    };
    fetch("/api/hr/payroll/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) toast("Settings saved"); else toast(d.error || "Error", true);
      });
  });
})();
