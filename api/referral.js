const { getSheetsClient } = require("../lib/sheets");

async function handleReferralSubmit(req, res) {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", async () => {
    try {
      const d = JSON.parse(body || "{}");
      const your_name  = String(d.your_name  || "").trim();
      const your_phone = String(d.your_phone || "").trim();
      const ref_name   = String(d.ref_name   || "").trim();
      const ref_phone  = String(d.ref_phone  || "").trim();
      const ref_city   = String(d.ref_city   || "").trim();
      const ref_job    = String(d.ref_job    || "").trim();

      if (!your_name || !your_phone || !ref_name || !ref_phone) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Missing required fields." }));
      }

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;
      const now = new Date().toISOString().slice(0, 16).replace("T", " ");

      const row = [
        now,
        ref_name,
        ref_phone,
        ref_city,
        ref_job,
        "Referral",
        your_name,
        your_phone,
        "New",
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range:            "Leads!A:I",
        valueInputOption: "USER_ENTERED",
        requestBody:      { values: [row] },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("referral submit error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Server error. Please try again." }));
    }
  });
}

module.exports = { handleReferralSubmit };
