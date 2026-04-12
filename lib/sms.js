// lib/sms.js — SMS provider (SignalWire Twilio-compat API)
// Swap provider by changing env vars — business logic never changes.
"use strict";
const https = require("https");

// Normalize any US phone number to E.164 (+1XXXXXXXXXX).
function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`; // international — pass through
  return raw; // fallback — let provider reject it with a clear error
}

function sendSms(to, body) {
  const spaceUrl  = process.env.SW_SPACE_URL;   // e.g. example.signalwire.com
  const projectId = process.env.SW_PROJECT_ID;
  const apiToken  = process.env.SW_API_TOKEN;
  const from      = process.env.SW_FROM_NUMBER; // E.164, e.g. +19361234567

  if (!spaceUrl || !projectId || !apiToken || !from) {
    console.log("[sms] SignalWire not configured — SMS not sent:", body.slice(0, 80));
    return Promise.resolve(false);
  }

  const toE164Num = toE164(to);
  const postBody  = new URLSearchParams({ To: toE164Num, From: from, Body: body }).toString();
  console.log(`[sms] Sending to ${toE164Num} via ${spaceUrl}`);

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
          console.log("[sms] Accepted by SignalWire:", r.statusCode, data.slice(0, 120));
          resolve(true);
        } else {
          console.error("[sms] Rejected by SignalWire:", r.statusCode, data.slice(0, 300));
          resolve(false);
        }
      });
    });
    req.on("error", err => { console.error("[sms] Request error:", err.message); resolve(false); });
    req.write(postBody);
    req.end();
  });
}

// Fill {{placeholder}} tokens in a template string.
function buildMessage(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? "").toString());
}

// Crew one-tap notification templates. Supports {{tech_name}} placeholder.
const CREW_TEMPLATES = {
  on_the_way:   "Vickery Electric: {{tech_name}} is on the way! We'll see you shortly.",
  we_are_here:  "Vickery Electric: {{tech_name}} is here! See you in just a moment.",
  running_late: "Vickery Electric: {{tech_name}} is running a little behind — thanks for your patience. We'll be there soon!",
};

// Invoice SMS templates.
// INVOICE_CUSTOMER: sent to customer with a link to view their invoice.
//   Vars: {{invoice_number}}, {{invoice_url}}
// INVOICE_TECH_PROMPT: sent to the assigned tech when a job is marked complete.
//   Vars: {{tech_first_name}}, {{address}}, {{crew_url}}
const INVOICE_TEMPLATES = {
  INVOICE_CUSTOMER:
    "Vickery Electric — Your invoice {{invoice_number}} is ready. View it here: {{invoice_url}}\n\nQuestions? Call us at (409) 554-3392.",
  INVOICE_TECH_PROMPT:
    "Hey {{tech_first_name}}, job at {{address}} is marked complete! Don\u2019t forget to send the invoice before you leave: {{crew_url}}",
};

// Reschedule-request SMS templates.
// RESCHEDULE_REQUEST: sent to customer with accept/decline links.
//   Vars: {{customer_name}}, {{old_date}}, {{new_date}}, {{accept_url}}, {{decline_url}}
// RESCHEDULE_ACCEPTED: confirmation to customer when they accept.
//   Vars: {{new_date}}
// RESCHEDULE_DECLINED: confirmation to customer when they decline.
//   (no vars)
// RESCHEDULE_ADMIN_NOTIFY: sent to OWNER_PHONE with the customer's response.
//   Vars: {{response}}, {{customer_name}}, {{address}}, {{new_date}}
const RESCHEDULE_TEMPLATES = {
  RESCHEDULE_REQUEST:
    "Hi {{customer_name}}, Vickery Electric needs to reschedule your appointment (currently {{old_date}}) to {{new_date}}.\n\n✅ Accept: {{accept_url}}\n❌ Decline: {{decline_url}}\n\nQuestions? Call (409) 554-3392.",
  RESCHEDULE_ACCEPTED:
    "Confirmed! Your Vickery Electric appointment has been updated to {{new_date}}. We\u2019ll see you then!",
  RESCHEDULE_DECLINED:
    "Got it \u2014 your original appointment stands. A team member will follow up shortly. Questions? Call (409) 554-3392.",
  RESCHEDULE_ADMIN_NOTIFY:
    "[Reschedule] {{customer_name}} at {{address}} {{response}} the proposed new date ({{new_date}}).",
};

module.exports = { sendSms, buildMessage, CREW_TEMPLATES, INVOICE_TEMPLATES, RESCHEDULE_TEMPLATES };
