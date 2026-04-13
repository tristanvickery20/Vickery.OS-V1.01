// api/protocols.js
// Uses the Replit Google Drive connector proxy for authenticated Drive API calls.
// Connector ID: conn_google-drive_01KP1HTXPPG278SZF68ZTZTVA3

const { ReplitConnectors } = require("@replit/connectors-sdk");

function buildProtocolsText() {
  return `VICKERY ELECTRIC — OPERATIONAL PROTOCOLS
Last updated: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
Orange, TX | (409) 554-3392
==========================================================================

SECTION 1 — GO/NO-GO LAUNCH CHECKLIST
Every item must be true before Crew 1 rolls on its first paying job.

LEGAL & COMPLIANCE
[ ] 1. Texas Electrical Contractor License (TECL) confirmed active on TDLR.
[ ] 2. Master Electrician license confirmed active and tied to active TECL.
[ ] 3. General liability insurance active — minimum $1M per occurrence.
[ ] 4. Business entity registered and in good standing with State of Texas.
[ ] 5. Customer-facing service agreement finalized and in use.
[ ] 6. Contractor/technician agreement signed by all working techs.

FINANCIAL & INVOICING
[ ] 7.  Business bank account open and linked to entity (separated from personal).
[ ] 8.  Invoice system tested end-to-end — generate, SMS, customer view, payment recorded.
[ ] 9.  All launch services priced — no $0 or placeholder quotes in estimator.
[ ] 10. At least 4 weeks of operating cash on hand.

OPERATIONS & EQUIPMENT
[ ] 11. Service truck titled, registered, insured, and GPS tracker confirmed in fleet view.
[ ] 12. CRM operational — tech can log in, view jobs, generate invoice from mobile.
[ ] 13. Standard material kit stocked for first 5 jobs.
[ ] 14. Customer confirmation and reminder SMS workflow tested and functional.

COMMUNICATION & MARKET
[ ] 15. Google Business Profile claimed, verified, categorized as "Electrician" (Orange, TX).
[ ] 16. Instant quote / booking flow tested end-to-end on a real mobile device.
[ ] 17. Owner prepared for first inbound call — scripted answers for: price, licensing, availability.

==========================================================================

SECTION 2 — STAFFING CONTINGENCY PROTOCOL

SCENARIO A — TECH GIVES NOTICE (PLANNED DEPARTURE)
1. Same day: Owner decides — recoverable or not? One conversation, one offer. 24-hour limit.
2. If irreversible: freeze new bookings beyond tech's last day immediately.
3. Contact every customer booked after last day — proactively reschedule or cancel.
4. Start replacement pipeline same week — do not wait on optimism about timeline.
5. Exit procedure: deactivate CRM accounts, return equipment/keys, process final pay.

SCENARIO B — TECH CALLS IN SICK (DAY-OF)
1. Within 15 minutes: pull today's schedule. Triage by urgency.
2. Can owner self-perform highest-priority job? If yes, do it. If no, go to step 3.
3. Call backup list (minimum 2 licensed contacts maintained at all times). Call — don't text.
4. Within 2 hours: contact every affected customer. Offer reschedule or free cancellation.
   Script: "Good morning — I'm Joshua Vickery. We have a tech out sick. Can I get you rescheduled for [date/time]?"
5. Update CRM — reschedule or cancel every affected booking.
6. If this happens 2+ times in 30 days: treat as reliability issue, make a staffing decision.

SCENARIO C — TECH LOSES LICENSE OR LEGAL AUTHORITY TO WORK
1. Immediately: tech performs no electrical work under the Vickery Electric TECL.
2. Within 24 hours: verify status directly with TDLR. Do not rely on tech's account.
3. Freeze all jobs that require the tech's licensed authority.
4. If revoked for cause: consult an employment/business attorney within 72 hours.
5. If restorable: set a clear reinstatement deadline. Do not pay idle-tech rates indefinitely.
6. If not restorable: treat as resignation and follow Scenario A steps 3–5.

==========================================================================

SECTION 3 — REFUND & DISPUTE HANDLING POLICY
Refunds are executed via invoice change-order deduct in the CRM.

SITUATIONS THAT WARRANT REFUND / ADJUSTMENT
- Workmanship defect reported within 30 days: return to fix at no charge. If unable to fix within
  5 business days, issue partial or full refund for the affected line item.
- No-show by Vickery Electric without 2+ hour advance notice: $50 credit on next service, automatic.
- Scope mismatch (billed for work not performed): deduct unperformed work as change order immediately.

SITUATIONS THAT DO NOT WARRANT A REFUND
- Customer changed mind after work began: labor is earned once work starts. Charge for work completed.
  Script: "Once we opened the wall and pulled the wire, that labor is complete. I'm not able to refund
  work that's been done. We can finish at the quoted price or stop here and charge for today's work."
- Permit delays or inspection failures from pre-existing conditions not caused by our work: not our cost.
- Customer complaints about price after work is complete: the quote was accepted before work began.
  Script: "The quote you approved was $[X]. The work is complete as described. I'm not able to reduce
  the price after the job is done."
- Customer-supplied materials that fail or are incompatible: not our liability if we flagged the risk.

WRITTEN DISPUTE PROCESS (DISPUTES OVER $300)
1. Customer submits concern in writing — what went wrong, what resolution they want.
2. Owner responds within 2 business days: agree to refund, or explain why not.
3. If unresolved: schedule one phone call within 3 business days. Document the call.
4. If still unresolved: small claims court or mediation per service agreement. We do not
   pay settlements to avoid conflict — we pay them when we are wrong.

==========================================================================

SECTION 4 — WEEKLY BUSINESS REVIEW PROCESS
Every Monday before 9 AM. Use the CRM Weekly Pulse page for data. Under 20 minutes.

STEP 1 — CHECK REVENUE COLLECTED LAST WEEK
  $2,000+        On track ($100K+ annual pace). Keep pipeline full.
  $1,000–$1,999  Below pace. Review last week's unconverted quotes. Follow up.
  Under $1,000   Pipeline or execution problem. Identify root cause this week.

STEP 2 — REVIEW AGED INVOICES (10+ DAYS UNPAID)
  10–20 days:    One follow-up SMS. One message only.
                 "Hi [Name] — following up on your Vickery Electric invoice for $[X]."
  20+ days:      Call directly. If no answer, leave voicemail + one final SMS.
  30+ days:      Owner decides: write off, collections, or small claims.

STEP 3 — CHECK NEXT 7 DAYS OF JOBS
  For each job: address confirmed, materials on hand, customer confirmed, permit pulled if needed.
  Fix any gaps before Wednesday — not the morning of the job.

STEP 4 — SCAN EXPENSES AND MARGINS
  Flag any expense over $200 that wasn't expected. If recurring, adjust pricing.
  Check change order trend: consistently up = good. Consistently down = investigate why.

STEP 5 — MAKE ONE DECISION BEFORE CLOSING
  No jobs last week            → Identify root cause. Pick one fix. Do it this week.
  3+ invoices past 15 days     → Start collections on the oldest.
  Revenue over $3K two weeks   → Consider adding capacity (booking slot, tech, service).
  Revenue under $800 two weeks → Owner makes 5 outreach calls to past customers this week.
  Tech sick 2+ times/30 days   → Have the staffing reliability conversation per Protocol B.

==========================================================================
End of Operational Protocols — Vickery Electric
`;
}

async function handleProtocolsToDrive(req, res) {
  const jsonOut = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  try {
    // Use the Replit Google Drive connector proxy — handles OAuth token refresh automatically.
    const connectors = new ReplitConnectors();

    const boundary = "protoboundary_" + Date.now();
    const metadata = JSON.stringify({
      name:     "Vickery Electric — Operational Protocols",
      mimeType: "application/vnd.google-apps.document",
    });
    const textContent = buildProtocolsText();

    const multipartBody = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      textContent,
      `--${boundary}--`,
    ].join("\r\n");

    const uploadResp = await connectors.proxy(
      "google-drive",
      "/upload/drive/v3/files?uploadType=multipart",
      {
        method:  "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body:    multipartBody,
      }
    );

    const uploadData = await uploadResp.json();

    if (!uploadResp.ok) {
      const errMsg = uploadData?.error?.message || "Drive upload failed";
      console.error("[protocols-to-drive] Drive error:", errMsg);
      return jsonOut(500, { ok: false, error: errMsg });
    }

    const docId  = uploadData.id;
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
    console.log(`[protocols-to-drive] Created Google Doc: ${docId}`);

    return jsonOut(200, { ok: true, doc_id: docId, doc_url: docUrl });
  } catch (err) {
    console.error("[protocols-to-drive] Error:", err.message);
    return jsonOut(500, { ok: false, error: err.message });
  }
}

module.exports = { handleProtocolsToDrive };
