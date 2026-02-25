(() => {
  let lastCalc = null;

  document.getElementById("calcBtn").addEventListener("click", async () => {
    const lights = Number(document.getElementById("lights").value);
    const resp = await fetch("/api/quote?lights=" + lights);
    const data = await resp.json();
    lastCalc = { lights, data };

    const laborTotal = data.laborPerUnit * data.qty;
    const materialTotal = data.materialPerUnit * data.qty;

    document.getElementById("result").innerHTML =
      "<div>Estimated Price: $" + data.total + "</div>" +
      "<div style='font-size:14px;font-weight:400;color:hsl(var(--muted-foreground));margin-top:6px;'>Labor $" +
      laborTotal + " + Material $" + materialTotal + "</div>";

    document.getElementById("saveSection").style.display = "block";
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    if (!lastCalc) return;
    const phone = document.getElementById("custPhone").value.trim();
    if (!phone) { document.getElementById("saveResult").textContent = "Phone is required."; return; }

    document.getElementById("saveResult").textContent = "Saving...";

    try {
      const resp = await fetch("/api/quotes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("custName").value.trim(),
          phone,
          address: document.getElementById("custAddress").value.trim(),
          service_key: "recessed_light",
          inputs: { lights: lastCalc.lights },
        }),
      });
      const result = await resp.json();
      if (result.ok) {
        document.getElementById("saveResult").innerHTML =
          '<span style="color:green;">Lead saved!</span> ' +
          '<a href="/clients" style="color:hsl(var(--primary));font-weight:600;">View in CRM &rarr;</a>' +
          '<br><span class="muted">Lead: ' + result.lead_id + ' &bull; Quote: ' + result.quote_id + '</span>';
      } else {
        document.getElementById("saveResult").textContent = result.error || "Failed to save.";
      }
    } catch (e) {
      document.getElementById("saveResult").textContent = "Error: " + e.message;
    }
  });
})();
