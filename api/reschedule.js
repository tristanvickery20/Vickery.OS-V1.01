// api/reschedule.js
// POST /api/schedule/bookings/:id/reschedule-request  — admin sends a reschedule SMS to customer
// GET  /reschedule/:token?r=accept|decline             — public; customer taps link from SMS
"use strict";

const crypto = require("crypto");
const { getSheetsClient }   = require("../lib/sheets");
const { ensureTabHeaders }  = require("../lib/sheetsSchema");
const { sendSms, buildMessage, RESCHEDULE_TEMPLATES } = require("../lib/sms");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

// ── helpers ───────────────────────────────────────────────────────────────────

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function getHost(req) {
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const domains = (process.env.REPLIT_DOMAINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (domains.length) return `https://${domains[0]}`;
  return `https://${req.headers.host || "localhost"}`;
}

function fmtDt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      year: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/Chicago",
    });
  } catch { return iso; }
}

// Read Bookings sheet and find a row by field value.
async function findBookingRow(sheets, fieldName, fieldValue) {
  await ensureTabHeaders("Bookings");
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: "Bookings!A:AZ",
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return null;
  const headers = rows[0];
  const fi = headers.indexOf(fieldName);
  if (fi < 0) return null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][fi] || "") === fieldValue) {
      return { headers, row: [...rows[i]], rowIdx: i };
    }
  }
  return null;
}

// Write a partial update back to a specific Bookings row.
async function writeBookingRow(sheets, headers, row, rowIdx) {
  const endCol = String.fromCharCode(65 + Math.min(headers.length - 1, 25));
  const endColFull = headers.length > 26
    ? String.fromCharCode(64 + Math.floor((headers.length - 1) / 26)) + String.fromCharCode(65 + (headers.length - 1) % 26)
    : endCol;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID(),
    range: `Bookings!A${rowIdx + 1}:${endColFull}${rowIdx + 1}`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
  });
}

function setField(headers, row, field, value) {
  const idx = headers.indexOf(field);
  if (idx >= 0) {
    while (row.length <= idx) row.push("");
    row[idx] = String(value ?? "");
  }
}

function getField(headers, row, field) {
  const idx = headers.indexOf(field);
  return idx >= 0 ? String(row[idx] ?? "") : "";
}

// ── Response page HTML ────────────────────────────────────────────────────────
function responsePage({ title, message, color, customerName, newDate }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Vickery Electric</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f5f5f7;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border-radius: 20px;
    padding: 40px 32px;
    max-width: 420px;
    width: 100%;
    text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  .icon {
    font-size: 52px;
    margin-bottom: 20px;
  }
  .brand {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #8e8e93;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 24px;
    font-weight: 700;
    color: ${color};
    margin-bottom: 12px;
  }
  p {
    font-size: 16px;
    line-height: 1.6;
    color: #444;
    margin-bottom: 8px;
  }
  .phone {
    display: inline-block;
    margin-top: 20px;
    font-size: 15px;
    font-weight: 600;
    color: #007aff;
    text-decoration: none;
  }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${color === "#28a745" ? "✅" : "❌"}</div>
  <div class="brand">Vickery Electric</div>
  <h1>${title}</h1>
  ${customerName ? `<p>Hi ${customerName},</p>` : ""}
  <p>${message}</p>
  ${newDate ? `<p><strong>${newDate}</strong></p>` : ""}
  <a class="phone" href="tel:4095543392">Questions? (409) 554-3392</a>
</div>
</body>
</html>`;
}

// ── POST /api/schedule/bookings/:id/reschedule-request ────────────────────────
async function handleRescheduleRequest(req, res) {
  try {
    const rawPath   = req.url.split("?")[0];
    const bookingId = rawPath.replace(/^\/api\/schedule\/bookings\//, "").replace(/\/reschedule-request$/, "").trim();
    if (!bookingId) return json(res, 400, { ok: false, error: "booking_id required in path" });

    const body = await parseBody(req);
    const proposedDt = String(body.proposed_datetime || "").trim();
    if (!proposedDt) return json(res, 400, { ok: false, error: "proposed_datetime required" });

    const sheets = await getSheetsClient();
    const found  = await findBookingRow(sheets, "booking_id", bookingId);
    if (!found) return json(res, 404, { ok: false, error: "Booking not found" });

    const { headers, row, rowIdx } = found;

    const phone = getField(headers, row, "phone");
    if (!phone) return json(res, 400, { ok: false, error: "Booking has no customer phone number" });

    const customerName  = getField(headers, row, "customer_name") || "Customer";
    const currentDt     = getField(headers, row, "scheduled_datetime");
    const address       = getField(headers, row, "address") || bookingId;
    const token         = crypto.randomBytes(16).toString("hex");
    const host          = getHost(req);
    const acceptUrl     = `${host}/reschedule/${token}?r=accept`;
    const declineUrl    = `${host}/reschedule/${token}?r=decline`;

    setField(headers, row, "reschedule_token",        token);
    setField(headers, row, "reschedule_proposed_dt",  proposedDt);
    setField(headers, row, "reschedule_status",       "pending");
    setField(headers, row, "reschedule_requested_at", new Date().toISOString());

    await writeBookingRow(sheets, headers, row, rowIdx);
    console.log(`[reschedule] Request saved for booking ${bookingId}, token ${token}`);

    const msgBody = buildMessage(RESCHEDULE_TEMPLATES.RESCHEDULE_REQUEST, {
      customer_name: customerName,
      old_date:      fmtDt(currentDt),
      new_date:      fmtDt(proposedDt),
      accept_url:    acceptUrl,
      decline_url:   declineUrl,
    });

    const sent = await sendSms(phone, msgBody).catch(() => false);
    console.log(`[reschedule] SMS to ${phone}: ${sent ? "sent" : "failed"}`);

    json(res, 200, { ok: true, sent, token });
  } catch (err) {
    console.error("[reschedule] request error:", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── GET /reschedule/:token?r=accept|decline ───────────────────────────────────
async function handleRescheduleRespond(req, res) {
  function htmlRes(status, html) {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  }

  try {
    const urlObj  = new URL(req.url, "http://localhost");
    const token   = urlObj.pathname.replace(/^\/reschedule\//, "").split("/")[0].trim();
    const response = String(urlObj.searchParams.get("r") || "").toLowerCase();

    if (!token) return htmlRes(400, responsePage({ title: "Invalid Link", message: "This link is not valid.", color: "#dc3545" }));
    if (response !== "accept" && response !== "decline") {
      return htmlRes(400, responsePage({ title: "Invalid Response", message: "Please use the accept or decline link from your text message.", color: "#dc3545" }));
    }

    const sheets = await getSheetsClient();
    const found  = await findBookingRow(sheets, "reschedule_token", token);
    if (!found) {
      return htmlRes(404, responsePage({ title: "Link Not Found", message: "This link has expired or is not valid.", color: "#dc3545" }));
    }

    const { headers, row, rowIdx } = found;
    const currentStatus = getField(headers, row, "reschedule_status");

    if (currentStatus === "accepted" || currentStatus === "declined") {
      const already = currentStatus === "accepted" ? "accepted" : "declined";
      return htmlRes(200, responsePage({
        title:   "Already Responded",
        message: `You already ${already} this reschedule request. No changes were made.`,
        color:   "#8e8e93",
      }));
    }

    const customerName  = getField(headers, row, "customer_name") || "";
    const phone         = getField(headers, row, "phone");
    const address       = getField(headers, row, "address") || "";
    const proposedDt    = getField(headers, row, "reschedule_proposed_dt");

    setField(headers, row, "reschedule_status", response === "accept" ? "accepted" : "declined");
    if (response === "accept" && proposedDt) {
      setField(headers, row, "scheduled_datetime", proposedDt);
    }
    await writeBookingRow(sheets, headers, row, rowIdx);
    console.log(`[reschedule] Token ${token} → ${response} by ${customerName}`);

    const formattedNew = fmtDt(proposedDt);

    // SMS customer confirmation
    if (phone) {
      const customerMsg = response === "accept"
        ? buildMessage(RESCHEDULE_TEMPLATES.RESCHEDULE_ACCEPTED, { new_date: formattedNew })
        : RESCHEDULE_TEMPLATES.RESCHEDULE_DECLINED;
      sendSms(phone, customerMsg).catch(err => console.error("[reschedule] customer SMS error:", err.message));
    }

    // SMS admin/owner notification
    const ownerPhone = process.env.OWNER_PHONE;
    if (ownerPhone) {
      const adminMsg = buildMessage(RESCHEDULE_TEMPLATES.RESCHEDULE_ADMIN_NOTIFY, {
        customer_name: customerName,
        address,
        response:      response === "accept" ? "ACCEPTED" : "DECLINED",
        new_date:      formattedNew,
      });
      sendSms(ownerPhone, adminMsg).catch(err => console.error("[reschedule] admin SMS error:", err.message));
    }

    if (response === "accept") {
      return htmlRes(200, responsePage({
        title:        "Appointment Confirmed!",
        message:      "Your new appointment has been scheduled for:",
        color:        "#28a745",
        customerName: customerName.split(" ")[0],
        newDate:      formattedNew,
      }));
    } else {
      return htmlRes(200, responsePage({
        title:        "No Problem",
        message:      "Your original appointment time stands. A team member will follow up with you shortly.",
        color:        "#dc3545",
        customerName: customerName.split(" ")[0],
      }));
    }
  } catch (err) {
    console.error("[reschedule] respond error:", err.message);
    htmlRes(500, responsePage({ title: "Error", message: "Something went wrong. Please call us at (409) 554-3392.", color: "#dc3545" }));
  }
}

module.exports = { handleRescheduleRequest, handleRescheduleRespond };
