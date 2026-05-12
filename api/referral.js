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
      const utm_source   = String(d.utm_source   || "").trim();
      const utm_medium   = String(d.utm_medium   || "").trim();
      const utm_campaign = String(d.utm_campaign || "").trim();
      const utm_content  = String(d.utm_content  || "").trim();
      const gclid        = String(d.gclid        || "").trim();
      const landing_page = String(d.landing_page || "").trim();
      const referrer_url = String(d.referrer_url || "").trim();

      if (!your_name || !your_phone || !ref_name || !ref_phone) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Missing required fields." }));
      }

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      // Read current Leads headers so we can write in header order
      let headers = [];
      try {
        const hr = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!1:1" });
        headers = (hr.data.values || [[]])[0] || [];
      } catch (_) { /* fall through to positional write */ }

      const now = new Date().toISOString().slice(0, 16).replace("T", " ");

      if (headers.length > 0) {
        const idxOf = h => headers.indexOf(h);
        const row = new Array(headers.length).fill("");
        const set = (h, v) => { const i = idxOf(h); if (i >= 0) row[i] = v; };
        set("created_at",         now);
        set("name",               ref_name);
        set("phone",              ref_phone);
        set("address",            ref_city ? ref_city + ", TX" : "");
        set("notes",              ref_job);
        set("lead_source",        "Referral");
        set("referrer_name",      your_name);
        set("referrer_phone",     your_phone);
        set("status",             "New");
        set("utm_source",         utm_source);
        set("utm_medium",         utm_medium);
        set("utm_campaign",       utm_campaign);
        set("utm_content",        utm_content);
        set("gclid",              gclid);
        set("landing_page",       landing_page);
        set("referrer_url",       referrer_url);

        // Score lead quality
        try {
          const { scoreLeadQuality } = require("../lib/leadQualityScore");
          const score = scoreLeadQuality({ address: ref_city ? ref_city + ", TX" : "", job_type: "", notes: ref_job, lead_source: "Referral", phone: ref_phone, quote_snapshot_json: "" });
          if (score) set("lead_quality_score", score);
        } catch (_) { /* non-fatal */ }

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range:            "Leads!A:A",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody:      { majorDimension: "ROWS", values: [row] },
        });
      } else {
        // Fallback: positional append (legacy format)
        const row = [now, ref_name, ref_phone, ref_city, ref_job, "Referral", your_name, your_phone, "New"];
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range:            "Leads!A:I",
          valueInputOption: "USER_ENTERED",
          requestBody:      { values: [row] },
        });
      }

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
