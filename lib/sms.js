// lib/sms.js — SMS provider (SignalWire Twilio-compat API)
// Swap provider by changing env vars — business logic never changes.
"use strict";
const https = require("https");

function sendSms(to, body) {
  const spaceUrl  = process.env.SW_SPACE_URL;   // e.g. example.signalwire.com
  const projectId = process.env.SW_PROJECT_ID;
  const apiToken  = process.env.SW_API_TOKEN;
  const from      = process.env.SW_FROM_NUMBER; // E.164, e.g. +19361234567

  if (!spaceUrl || !projectId || !apiToken || !from) {
    console.log("[sms] SignalWire not configured — SMS not sent:", body.slice(0, 80));
    return Promise.resolve(false);
  }

  const postBody = new URLSearchParams({ To: to, From: from, Body: body }).toString();
  return new Promise((resolve) => {
    const req = https.request({
      hostname: spaceUrl,
      path:     `/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`,
      method:   "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Authorization":  "Basic " + Buffer.from(`${projectId}:${apiToken}`).toString("base64"),
        "Content-Length": Buffer.byteLength(postBody),
      },
    }, (r) => {
      let data = "";
      r.on("data", d => { data += d; });
      r.on("end", () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          console.log("[sms] Sent to", to);
          resolve(true);
        } else {
          console.error("[sms] Failed:", r.statusCode, data.slice(0, 200));
          resolve(false);
        }
      });
    });
    req.on("error", err => { console.error("[sms] Error:", err.message); resolve(false); });
    req.write(postBody);
    req.end();
  });
}

// Fill {{placeholder}} tokens in a template string.
function buildMessage(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? "").toString());
}

// Crew one-tap notification templates.
const CREW_TEMPLATES = {
  on_the_way:   "Vickery Electric: Your technician is on the way! We'll see you shortly.",
  we_are_here:  "Vickery Electric: We're here! See you in just a moment.",
  running_late: "Vickery Electric: We're running a little behind schedule — thanks for your patience. We'll be there soon!",
};

module.exports = { sendSms, buildMessage, CREW_TEMPLATES };
