const http = require("http");
const fs = require("fs");
const path = require("path");

const { handleQuoteApi } = require("./api/quote");
const { handleQuoteConfig } = require("./api/quote-config");
const { handleQuoteStart, handleQuoteCalc, handleQuoteLock } = require("./api/quote-engine");
const { handlePhotoUpload } = require("./api/photo-upload");
const { handleGetSlots }    = require("./api/schedule-slots");
const { handleGetBlocks }   = require("./api/schedule-blocks");
const { handleBook }        = require("./api/schedule-book");
const { handleGetBookings } = require("./api/schedule-admin");
const { handleGetCalendar } = require("./api/schedule-calendar");
const { handlePatchBooking } = require("./api/schedule-booking-patch");
const { handleSeedQuote }   = require("./api/seed-quote");
const { handleCreateLead, handleGetLeads, handleGetLeadSnapshot } = require("./api/leads");
const { handleUpdateLeadStatus } = require("./api/leads-status");
const { handleUpdateLead } = require("./api/leads-update");
const { handleGetTechs } = require("./api/techs");
const { handleDashboard, handleDashboardFinancials } = require("./api/dashboard");
const { handleBonusEligibility } = require("./api/bonus-eligibility");
const { handleAppsLeadCreate } = require("./api/apps-lead-create");
const { handleScheduleLead } = require("./api/leads-schedule");
const { handleGetTime, handleCreateTime, handleUpdateTime } = require("./api/time");
const { handleGetExpenses, handleCreateExpense } = require("./api/expenses");
const { handleCreateQuote } = require("./api/quotes");
const { handleScheduleSuggest } = require("./api/schedule-suggest");
const { handleGetAudit } = require("./api/audit");
const { handleActualsRollup, handleSaveActuals, saveActualsToConfig } = require("./api/actuals-rollup");
const { handleGetCrewMembers, handleGetTodayJobs, handleGenerateInvoice, handleGetInvoiceForBooking } = require("./api/crew");
const {
  handleSignup, handleLogin, handleLogout, handleMe,
  handleListStaff, handlePendingCount, handleUpdateStaff,
  handleCrewReviewAsk, handleCrewNotify,
} = require("./api/crew-auth");
const { getCrewSession, ensureStaffSheet } = require("./lib/staff");
const { handleReferralSubmit } = require("./api/referral");
const { handleGetReviews, handleSendAsk, handleSendReminder, handleUpdateReview } = require("./api/reviews");
const { handleGetOverview, handleGetSegments, handleGetFollowupQueue, handleSendFollowup, handleGetSources, handleGetMarketingSettings, handleSaveMarketingSettings } = require("./api/marketing");
const { handleGetTemplates, handleCreateTemplate, handleUpdateTemplate } = require("./api/templates");
const {
  handleGetClients,
  handleGetClientById,
  handleGetClientRequests,
  handleGetClientQuotes,
  handleGetClientJobs,
  handleGetClientNotes,
  handleGetClientAttachments,
  handleGetClientTimeline,
} = require("./api/clients");
const { handleCreateNote } = require("./api/notes");
const { handleCreateAttachment } = require("./api/attachments");

// Ticket 21
const {
  handleGetInvoices,
  handleCreateInvoice,
  handleCreateInvoiceFromLead,
  handleSendInvoice,
  handleSyncInvoiceStatus,
  handleGetInvoiceById,
  handleUpdateInvoice,
  handlePublicInvoice,
  handleAddChangeOrder,
} = require("./api/invoices");
const { handleCreatePayment } = require("./api/payments");
const { handleEstimatorConfig, handleEstimatorHealth, handleEstimatorQuote, handleEstimatorClassification } = require("./api/estimator-config");
const { handleGeocode } = require("./api/schedule-geocode");
const { handleOptimize, handleOptimizeSave } = require("./api/schedule-optimize");
const { handleMapboxConfig } = require("./api/config-mapbox");
const { handleGetPositions, startPolling: startTraccarPolling } = require("./api/traccar");
const { resolveZone, shouldReject, ZONE_RULES } = require("./lib/serviceArea");
const { runMaterialPriceUpdate, scheduleMonthlyPriceUpdate } = require("./lib/materialPriceUpdater");
const { getSheetsClient } = require("./lib/sheets");

const { isAuthed, requireAuth, setAuthCookie, clearAuthCookie } = require("./lib/auth");

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function serveFile(res, filePath, contentType, extraHeaders = {}) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("File not found");
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache", ...extraHeaders });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  // STATIC FILES
  if (req.url.startsWith("/pages/js/")) {
    const filePath = path.join(__dirname, req.url.split("?")[0]);
    const extraHeaders = req.url.includes("instant-estimate")
      ? { "Cache-Control": "no-store, max-age=0" }
      : {};
    return serveFile(res, filePath, "application/javascript", extraHeaders);
  }

  if (req.url.startsWith("/pages/css/")) {
    const filePath = path.join(__dirname, req.url);
    return serveFile(res, filePath, "text/css");
  }

  if (req.url.startsWith("/pages/partials/")) {
    const filePath = path.join(__dirname, req.url);
    return serveFile(res, filePath, "text/html");
  }

  if (req.url.startsWith("/pages/img/")) {
    const filePath = path.join(__dirname, req.url);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    return serveFile(res, filePath, mimeTypes[ext] || "application/octet-stream");
  }

  if (req.url.startsWith("/uploads/")) {
    const filePath = path.join(__dirname, req.url.split("?")[0]);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic" };
    return serveFile(res, filePath, mimeTypes[ext] || "application/octet-stream");
  }

  // PUBLIC PAGES
  if (req.url === "/") {
    return serveFile(res, path.join(__dirname, "pages/site-home.html"), "text/html");
  }

  if (req.url === "/services") {
    return serveFile(res, path.join(__dirname, "pages/site-services.html"), "text/html");
  }

  if (req.url === "/about") {
    return serveFile(res, path.join(__dirname, "pages/site-about.html"), "text/html");
  }

  if (req.url === "/contact") {
    return serveFile(res, path.join(__dirname, "pages/site-contact.html"), "text/html");
  }

  if (req.url === "/service-area") {
    return serveFile(res, path.join(__dirname, "pages/site-service-area.html"), "text/html");
  }

  if (req.url === "/why-vickery") {
    return serveFile(res, path.join(__dirname, "pages/site-why.html"), "text/html");
  }

  if (req.url === "/reviews") {
    return serveFile(res, path.join(__dirname, "pages/site-reviews.html"), "text/html");
  }

  if (req.url === "/referral") {
    return serveFile(res, path.join(__dirname, "pages/site-referral.html"), "text/html");
  }

  if (req.url === "/financing") {
    return serveFile(res, path.join(__dirname, "pages/site-financing.html"), "text/html");
  }

  // PWA files — public, no auth
  if (req.url === "/manifest.json") {
    return serveFile(res, path.join(__dirname, "pages/pwa/manifest.json"), "application/manifest+json");
  }
  if (req.url === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" });
    fs.createReadStream(path.join(__dirname, "pages/pwa/sw.js")).pipe(res);
    return;
  }

  // Crew portal pages and auth endpoints (public — no CRM auth required)
  if (req.url === "/crew/login") {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }
  if (req.url === "/crew" || req.url === "/crew/") {
    if (!getCrewSession(req)) {
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    return serveFile(res, path.join(__dirname, "pages/crew.html"), "text/html");
  }

  // Crew auth API (public — these are the auth endpoints themselves)
  if (req.url === "/api/crew/signup" && req.method === "POST") return handleSignup(req, res);
  if (req.url === "/api/crew/login"  && req.method === "POST") return handleLogin(req, res);
  if (req.url === "/api/crew/logout" && req.method === "POST") return handleLogout(req, res);
  if (req.url === "/api/crew/me"     && req.method === "GET")  return handleMe(req, res);
  if (req.url === "/api/crew/review-ask" && req.method === "POST") return handleCrewReviewAsk(req, res);
  if (req.url === "/api/crew/notify"     && req.method === "POST") return handleCrewNotify(req, res);

  // Crew portal public API endpoints (no auth required — employee-facing)
  if (req.url.startsWith("/api/crew/members") && req.method === "GET") {
    return handleGetCrewMembers(req, res);
  }
  if (req.url.startsWith("/api/crew/today") && req.method === "GET") {
    return handleGetTodayJobs(req, res);
  }
  if (req.url.split("?")[0] === "/api/crew/generate-invoice" && req.method === "POST") {
    return handleGenerateInvoice(req, res);
  }
  if (req.url.split("?")[0] === "/api/crew/invoice-for-booking" && req.method === "GET") {
    return handleGetInvoiceForBooking(req, res);
  }
  // Time and expense POSTs — require crew OR CRM session (not fully public)
  if (req.url === "/api/time" && req.method === "POST") {
    if (!getCrewSession(req) && !isAuthed(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    return handleCreateTime(req, res);
  }
  if (req.url === "/api/expenses" && req.method === "POST") {
    if (!getCrewSession(req) && !isAuthed(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    return handleCreateExpense(req, res);
  }
  // PATCH /api/time/:id — crew clock-out update (crew session + same-user ownership enforced)
  if (req.url.startsWith("/api/time/") && req.method === "PATCH") {
    const crewSess = getCrewSession(req);
    if (!crewSess && !isAuthed(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    const timeId = req.url.slice("/api/time/".length).split("?")[0];
    if (timeId) {
      return handleUpdateTime(req, res, timeId, crewSess);
    }
  }
  // Crew-session-gated GETs for today's own time + expenses (sanitized, user-scoped)
  // Returns only minimal fields needed by job-card UI; strips lat/lng, notes, IDs.
  if (req.url === "/api/crew/time-today" && req.method === "GET") {
    const crewSess = getCrewSession(req);
    if (!crewSess) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    try {
      const { getSheetsClient } = require("./lib/sheets");
      const sheets = await getSheetsClient();
      const resp   = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.CRM_SHEET_ID,
        range: "Time!A1:L2000",
      });
      const today    = new Date().toISOString().slice(0, 10);
      const techId   = `${crewSess.firstName} ${crewSess.lastName}`;
      const values   = resp.data.values || [];
      const entries  = values.slice(1)
        .filter(r => r && r.length && String(r[0]||"").trim() !== "" &&
                     String(r[2]||"").trim() === today &&
                     String(r[3]||"").trim() === techId)
        .map(r => ({ lead_id: r[4]||"", minutes: Number(r[5]||0) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, entries }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
  if (req.url === "/api/crew/expenses-today" && req.method === "GET") {
    const crewSess = getCrewSession(req);
    if (!crewSess) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    try {
      const { getSheetsClient } = require("./lib/sheets");
      const sheets = await getSheetsClient();
      const resp   = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.CRM_SHEET_ID,
        range: "Expenses!A1:J2000",
      });
      const today   = new Date().toISOString().slice(0, 10);
      const techId  = `${crewSess.firstName} ${crewSess.lastName}`;
      const values  = resp.data.values || [];
      const entries = values.slice(1)
        .filter(r => r && r.length && String(r[0]||"").trim() !== "" &&
                     String(r[2]||"").trim() === today &&
                     String(r[3]||"").trim() === techId)
        .map(r => ({ lead_id: r[4]||"", type: r[5]||"", vendor: r[6]||"", amount: Number(r[7]||0) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, entries }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.url === "/crm") {
    const target = isAuthed(req) ? "/clients" : "/login";
    res.writeHead(302, { Location: target });
    return res.end();
  }

  if (req.url === "/quote") {
    return serveFile(res, path.join(__dirname, "pages/quote.html"), "text/html");
  }

  if (req.url === "/instant-estimate") {
    return serveFile(res, path.join(__dirname, "pages/instant-estimate.html"), "text/html",
      { "Cache-Control": "no-store, max-age=0" });
  }

  if (req.url === "/login" && req.method === "GET") {
    return serveFile(res, path.join(__dirname, "pages/login.html"), "text/html");
  }

  if (req.url === "/logout") {
    clearAuthCookie(res);
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  // HEALTH (public)
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  // PUBLIC API ROUTES (no auth)
  if (req.url.startsWith("/api/apps/lead") && req.method === "POST") {
    return handleAppsLeadCreate(req, res);
  }

  if (req.url === "/api/quotes/create" && req.method === "POST") {
    return handleCreateQuote(req, res);
  }

  if (req.url === "/api/quote/config" && req.method === "GET") {
    return handleQuoteConfig(req, res);
  }

  if (req.url === "/api/quote/start" && req.method === "POST") {
    return handleQuoteStart(req, res);
  }

  if (req.url === "/api/quote/calc" && req.method === "POST") {
    return handleQuoteCalc(req, res);
  }

  if (req.url === "/api/quote/lock" && req.method === "POST") {
    return handleQuoteLock(req, res);
  }

  if (req.url === "/api/quote/photo" && req.method === "POST") {
    return handlePhotoUpload(req, res);
  }

  if (req.url.startsWith("/api/schedule/slots") && req.method === "GET") {
    return handleGetSlots(req, res);
  }

  if (req.url.startsWith("/api/schedule/blocks") && req.method === "GET") {
    return handleGetBlocks(req, res);
  }

  if (req.url === "/api/schedule/book" && req.method === "POST") {
    return handleBook(req, res);
  }

  if (req.url.startsWith("/api/schedule/bookings") && req.method === "GET") {
    return handleGetBookings(req, res);
  }

  if (req.url.startsWith("/api/quote") && req.method === "GET") {
    return handleQuoteApi(req, res);
  }

  if (req.url.startsWith("/admin/seed-quote") && req.method === "GET") {
    return handleSeedQuote(req, res);
  }

  const _epath = req.url.split("?")[0];
  if (_epath === "/api/estimator/config" && req.method === "GET") {
    return handleEstimatorConfig(req, res);
  }

  if (_epath === "/api/estimator/health" && req.method === "GET") {
    return handleEstimatorHealth(req, res);
  }

  if (_epath === "/api/estimator/quote" && req.method === "POST") {
    return handleEstimatorQuote(req, res);
  }

  if (_epath === "/api/estimator/classification" && req.method === "GET") {
    return handleEstimatorClassification(req, res);
  }

  // ── Material price auto-update (manual trigger) ────────────────────────────
  if (_epath === "/api/admin/materials/price-update" && req.method === "POST") {
    if (!isAuthed(req)) { res.writeHead(401); res.end(JSON.stringify({ok:false,error:"Unauthorized"})); return; }
    (async () => {
      try {
        const sheets  = await getSheetsClient();
        const sheetId = process.env.ESTIMATOR_V2_SHEET_ID;
        if (!sheetId) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:"ESTIMATOR_V2_SHEET_ID not configured"})); return; }
        const result = await runMaterialPriceUpdate(sheets, sheetId);
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:true,...result}));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ok:false,error:e.message}));
      }
    })();
    return;
  }

  // ── Zone check — public, no auth required ─────────────────────────────────
  // GET /api/zone/check?zip=77630 or ?zip=77657&estimated_total=500&batched=false
  if (_epath === "/api/zone/check" && req.method === "GET") {
    const u = new URL(req.url, `http://localhost`);
    const zip            = u.searchParams.get("zip") || "";
    const city           = u.searchParams.get("city") || "";
    const estimated_total = u.searchParams.get("estimated_total") ? Number(u.searchParams.get("estimated_total")) : null;
    const batched        = u.searchParams.get("batched") === "true";

    const resolved = resolveZone(zip, city);
    if (!resolved) {
      const payload = {
        eligible:         false,
        reject:           true,
        reject_reason:    "Location is outside our current service area. Please call for a custom quote.",
        zone:             null,
        zone_label:       null,
        travel_fee:       null,
        custom_quote_only: true,
        instant_pricing:  false,
        approval_note:    null,
        drive_minutes:    null,
        city:             city || zip || null,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(payload));
    }

    const rejection = shouldReject({
      zone: resolved.zone,
      drive_minutes: resolved.drive_minutes,
      estimated_total,
      batched,
    });

    const rules = ZONE_RULES[resolved.zone] || {};
    const payload = {
      eligible:         !rejection.reject,
      reject:           rejection.reject,
      reject_reason:    rejection.reason || null,
      zone:             resolved.zone,
      zone_label:       rules.label || resolved.zone,
      travel_fee:       rules.travel_fee ?? 0,
      custom_quote_only: rules.custom_quote_only || false,
      instant_pricing:  rules.instant_pricing || false,
      approval_note:    rules.approval_note || null,
      drive_minutes:    resolved.drive_minutes,
      city:             resolved.city || city || null,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(payload));
  }

  // ── Referral submission — public, no auth ─────────────────────────────────
  if (_epath === "/api/referral/submit" && req.method === "POST") {
    return handleReferralSubmit(req, res);
  }

  // ── Public invoice page — no auth ─────────────────────────────────────────
  // GET /invoice/:token → serve the customer-facing invoice HTML page
  if (_epath.startsWith("/invoice/") && req.method === "GET" && !_epath.startsWith("/invoices")) {
    return serveFile(res, path.join(__dirname, "pages/invoice-public.html"), "text/html");
  }
  // GET /api/invoice/public/:token → JSON invoice data (no auth)
  if (_epath.startsWith("/api/invoice/public/") && req.method === "GET") {
    return handlePublicInvoice(req, res);
  }

  // Mapbox token — accessible by CRM or crew session (handler checks both)
  if (_epath === "/api/config/mapbox" && req.method === "GET") {
    return handleMapboxConfig(req, res);
  }

  // AUTH GUARD: protected pages + remaining /api/*
  if (
    req.url === "/clients" ||
    req.url.startsWith("/clients/") ||
    req.url.startsWith("/crm/") ||
    req.url === "/invoices" ||
    req.url.startsWith("/invoices/") ||
    req.url.startsWith("/api/")
  ) {
    if (!requireAuth(req, res)) return;
  }

  // Schedule calendar (protected — CRM only)
  if (req.url.startsWith("/api/schedule/calendar") && req.method === "GET") {
    return handleGetCalendar(req, res);
  }

  if (req.url.startsWith("/api/schedule/bookings/") && req.method === "PATCH") {
    return handlePatchBooking(req, res);
  }

  // Geocode bookings (CRM only)
  if (_epath === "/api/schedule/geocode" && req.method === "POST") {
    return handleGeocode(req, res);
  }

  // Route optimization (CRM only)
  if (_epath === "/api/schedule/optimize/save" && req.method === "POST") {
    return handleOptimizeSave(req, res);
  }
  if (_epath === "/api/schedule/optimize" && req.method === "POST") {
    return handleOptimize(req, res);
  }

  // CLIENTS PAGE
  if (req.url === "/clients") {
    return serveFile(res, path.join(__dirname, "pages/clients.html"), "text/html");
  }

  // CLIENT DETAIL PAGE
  if (req.url.startsWith("/clients/") && req.method === "GET" && !req.url.startsWith("/api/")) {
    return serveFile(res, path.join(__dirname, "pages/client-detail.html"), "text/html");
  }

  // TICKET 21: INVOICES PAGES (will 404 until pages exist)
  if (req.url === "/invoices" && req.method === "GET") {
    return serveFile(res, path.join(__dirname, "pages/invoices.html"), "text/html");
  }

  if (req.url.startsWith("/invoices/") && req.method === "GET") {
    return serveFile(res, path.join(__dirname, "pages/invoices-detail.html"), "text/html");
  }

  // PROTECTED CRM PAGES
  if (req.url === "/crm/new") {
    return serveFile(res, path.join(__dirname, "pages/crm-new.html"), "text/html");
  }

  if (req.url === "/crm/leads" || req.url.startsWith("/crm/leads?")) {
    return serveFile(res, path.join(__dirname, "pages/crm-leads.html"), "text/html");
  }

  if (req.url === "/crm/staff") {
    return serveFile(res, path.join(__dirname, "pages/crm-staff.html"), "text/html");
  }

  if (req.url === "/crm/marketing") {
    return serveFile(res, path.join(__dirname, "pages/crm-marketing.html"), "text/html");
  }

  if (req.url === "/crm/schedule") {
    return serveFile(res, path.join(__dirname, "pages/crm-schedule.html"), "text/html");
  }

  if (req.url === "/crm/fleet") {
    return serveFile(res, path.join(__dirname, "pages/fleet.html"), "text/html");
  }

  if (req.url.startsWith("/crm/dashboard")) {
    return serveFile(res, path.join(__dirname, "pages/crm-dashboard.html"), "text/html");
  }

  if (req.url === "/crm/time") {
    return serveFile(res, path.join(__dirname, "pages/crm-time.html"), "text/html");
  }

  if (req.url === "/crm/expenses") {
    return serveFile(res, path.join(__dirname, "pages/crm-expenses.html"), "text/html");
  }

  if (req.url === "/crm/audit") {
    return serveFile(res, path.join(__dirname, "pages/crm-audit.html"), "text/html");
  }

  if (req.url === "/crm/calculator") {
    return serveFile(res, path.join(__dirname, "pages/crm-calculator.html"), "text/html");
  }

  if (req.url.startsWith("/crm/lead")) {
    return serveFile(res, path.join(__dirname, "pages/crm-lead.html"), "text/html");
  }

  // PROTECTED API ROUTES
  if (req.url === "/api/schedule/suggest" && req.method === "POST") {
    return handleScheduleSuggest(req, res);
  }

  if (req.url === "/api/leads" && req.method === "POST") {
    return handleCreateLead(req, res);
  }

  if (req.url === "/api/leads" && req.method === "GET") {
    return handleGetLeads(req, res);
  }

  if (req.url.startsWith("/api/lead-snapshot") && req.method === "GET") {
    return handleGetLeadSnapshot(req, res);
  }

  if (req.url === "/api/leads/status" && req.method === "PATCH") {
    return handleUpdateLeadStatus(req, res);
  }

  if (req.url === "/api/leads/update" && req.method === "PATCH") {
    return handleUpdateLead(req, res);
  }

  if (req.url.startsWith("/api/leads/schedule") && req.method === "PATCH") {
    return handleScheduleLead(req, res);
  }

  if (req.url === "/api/techs" && req.method === "GET") {
    return handleGetTechs(req, res);
  }

  if (req.url === "/api/time" && req.method === "GET") {
    return handleGetTime(req, res);
  }

  if (req.url === "/api/time" && req.method === "POST") {
    return handleCreateTime(req, res);
  }

  if (req.url === "/api/expenses" && req.method === "GET") {
    return handleGetExpenses(req, res);
  }

  if (req.url === "/api/expenses" && req.method === "POST") {
    return handleCreateExpense(req, res);
  }

  if (req.url === "/api/notes" && req.method === "POST") {
    return handleCreateNote(req, res);
  }

  if (req.url === "/api/attachments" && req.method === "POST") {
    return handleCreateAttachment(req, res);
  }

  // Staff management API (CRM owner only — behind requireAuth gate)
  if (req.url === "/api/crew/staff" && req.method === "GET") {
    return handleListStaff(req, res);
  }
  if (req.url === "/api/crew/staff/pending-count" && req.method === "GET") {
    return handlePendingCount(req, res);
  }
  if (req.url.startsWith("/api/crew/staff/") && req.method === "PATCH") {
    const staffId = req.url.replace("/api/crew/staff/", "").split("?")[0];
    return handleUpdateStaff(req, res, staffId);
  }

  if (req.url.startsWith("/api/actuals-rollup/save") && req.method === "POST") {
    return handleSaveActuals(req, res);
  }

  if (req.url.startsWith("/api/actuals-rollup") && req.method === "GET") {
    return handleActualsRollup(req, res);
  }

  if (req.url.startsWith("/api/dashboard") && req.method === "GET") {
    if (_epath === "/api/dashboard/financials") return handleDashboardFinancials(req, res);
    return handleDashboard(req, res);
  }

  if (_epath === "/api/bonus-eligibility" && req.method === "GET") {
    return handleBonusEligibility(req, res);
  }

  if (req.url.startsWith("/api/audit") && req.method === "GET") {
    return handleGetAudit(req, res);
  }

  if (req.url.startsWith("/api/clients") && req.method === "GET") {
    const cpath = req.url.replace(/\?.*$/, "");
    if (cpath === "/api/clients") return handleGetClients(req, res);
    if (cpath.endsWith("/timeline")) return handleGetClientTimeline(req, res);
    if (cpath.endsWith("/requests")) return handleGetClientRequests(req, res);
    if (cpath.endsWith("/quotes")) return handleGetClientQuotes(req, res);
    if (cpath.endsWith("/jobs")) return handleGetClientJobs(req, res);
    if (cpath.endsWith("/notes")) return handleGetClientNotes(req, res);
    if (cpath.endsWith("/attachments")) return handleGetClientAttachments(req, res);
    return handleGetClientById(req, res);
  }

  // Ticket 21: invoices API
  // Use _epath (the path without query string) so ?client_id= and ?lead_id= filters work
  if (_epath === "/api/invoices" && req.method === "GET") {
    return handleGetInvoices(req, res);
  }

  if (_epath === "/api/invoices" && req.method === "POST") {
    return handleCreateInvoice(req, res);
  }

  // Specific /api/invoices/* routes — must be before the generic catch-all below
  if (_epath === "/api/invoices/from-lead" && req.method === "POST") {
    return handleCreateInvoiceFromLead(req, res);
  }

  if (_epath.startsWith("/api/invoices/") && _epath.endsWith("/send") && req.method === "POST") {
    return handleSendInvoice(req, res);
  }

  if (_epath.startsWith("/api/invoices/") && _epath.endsWith("/sync-status") && req.method === "POST") {
    return handleSyncInvoiceStatus(req, res);
  }

  if (_epath.startsWith("/api/invoices/") && _epath.endsWith("/change-order") && req.method === "POST") {
    return handleAddChangeOrder(req, res);
  }

  if (req.url.startsWith("/api/invoices/")) {
    if (req.method === "GET") return handleGetInvoiceById(req, res);
    if (req.method === "PATCH") return handleUpdateInvoice(req, res);
  }

  // Ticket 21: payments API
  if (req.url === "/api/payments" && req.method === "POST") {
    return handleCreatePayment(req, res);
  }

  // Marketing Hub API
  if (_epath === "/api/marketing/overview" && req.method === "GET") {
    return handleGetOverview(req, res);
  }
  if (_epath === "/api/marketing/segments" && req.method === "GET") {
    return handleGetSegments(req, res);
  }
  if (_epath === "/api/marketing/followup" && req.method === "GET") {
    return handleGetFollowupQueue(req, res);
  }
  if (_epath === "/api/marketing/followup/send" && req.method === "POST") {
    return handleSendFollowup(req, res);
  }
  if (_epath === "/api/marketing/sources" && req.method === "GET") {
    return handleGetSources(req, res);
  }
  if (_epath === "/api/marketing/settings" && req.method === "GET") {
    return handleGetMarketingSettings(req, res);
  }
  if (_epath === "/api/marketing/settings" && req.method === "POST") {
    return handleSaveMarketingSettings(req, res);
  }

  // Reviews API
  if (_epath === "/api/reviews" && req.method === "GET") {
    return handleGetReviews(req, res);
  }
  if (_epath === "/api/reviews/ask" && req.method === "POST") {
    return handleSendAsk(req, res);
  }
  if (_epath === "/api/reviews/remind" && req.method === "POST") {
    return handleSendReminder(req, res);
  }
  if (_epath.startsWith("/api/reviews/") && req.method === "PATCH") {
    const reviewId = _epath.replace("/api/reviews/", "");
    return handleUpdateReview(req, res, reviewId);
  }

  // Templates API
  if (_epath === "/api/templates" && req.method === "GET") {
    return handleGetTemplates(req, res);
  }
  if (_epath === "/api/templates" && req.method === "POST") {
    return handleCreateTemplate(req, res);
  }
  if (_epath.startsWith("/api/templates/") && req.method === "PATCH") {
    const templateId = _epath.replace("/api/templates/", "");
    return handleUpdateTemplate(req, res, templateId);
  }

  // Traccar fleet positions (CRM only — behind auth guard above)
  if (_epath === "/api/traccar/positions" && req.method === "GET") {
    return handleGetPositions(req, res);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const { ensureAllHeaders } = require("./lib/sheetsSchema");
const { ensureConfigDefaults, ensureCalculatorDefaults } = require("./lib/config");
const { seedQuoteSheetIfEmpty, backfillSegmentCategory, logQuoteHealth } = require("./lib/quoteSeedInit");
const { isV2Mode } = require("./lib/estimatorV2Config");

server.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
  console.log(`Estimator Mode: ${isV2Mode() ? "v2" : "v1"}`);
  ensureAllHeaders()
    .then(() => ensureConfigDefaults())
    .then(() => ensureCalculatorDefaults())
    .then(() => ensureStaffSheet())
    .then(() => seedQuoteSheetIfEmpty())
    .then(() => backfillSegmentCategory())
    .then(() => logQuoteHealth())
    .catch((err) => console.error("[Startup]", err.message));

  // Start Traccar fleet tracking polls (no-op if env vars absent)
  startTraccarPolling();

  // Nightly actuals → Config job (runs once per day at midnight server time)
  function scheduleNightlyActuals() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 5, 0); // next midnight + 5 seconds
    const msUntil = next - now;
    setTimeout(async () => {
      try {
        console.log("[Nightly] Running actuals rollup…");
        await saveActualsToConfig(30);
        console.log("[Nightly] Actuals saved to Config.");
      } catch (err) {
        console.error("[Nightly] Actuals rollup failed:", err.message);
      }
      scheduleNightlyActuals(); // reschedule for next night
    }, msUntil);
    console.log(`[Nightly] Actuals scheduled in ${Math.round(msUntil/3600000)}h`);
  }
  scheduleNightlyActuals();

  // Monthly material price update (BLS PPI, first of each month at 2am)
  if (process.env.ESTIMATOR_V2_SHEET_ID) {
    getSheetsClient().then(sheets => {
      scheduleMonthlyPriceUpdate(sheets, process.env.ESTIMATOR_V2_SHEET_ID);
    }).catch(err => {
      console.error("[MaterialPriceUpdater] Failed to init scheduler:", err.message);
    });
  }
});