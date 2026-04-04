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
const { handleSeedQuote }   = require("./api/seed-quote");
const { handleCreateLead, handleGetLeads, handleGetLeadSnapshot } = require("./api/leads");
const { handleUpdateLeadStatus } = require("./api/leads-status");
const { handleUpdateLead } = require("./api/leads-update");
const { handleGetTechs } = require("./api/techs");
const { handleDashboard } = require("./api/dashboard");
const { handleAppsLeadCreate } = require("./api/apps-lead-create");
const { handleScheduleLead } = require("./api/leads-schedule");
const { handleGetTime, handleCreateTime } = require("./api/time");
const { handleGetExpenses, handleCreateExpense } = require("./api/expenses");
const { handleCreateQuote } = require("./api/quotes");
const { handleScheduleSuggest } = require("./api/schedule-suggest");
const { handleGetAudit } = require("./api/audit");
const { handleActualsRollup } = require("./api/actuals-rollup");
const { handleReferralSubmit } = require("./api/referral");
const {
  handleGetClients,
  handleGetClientById,
  handleGetClientRequests,
  handleGetClientQuotes,
  handleGetClientJobs,
  handleGetClientNotes,
  handleGetClientAttachments,
} = require("./api/clients");
const { handleCreateNote } = require("./api/notes");
const { handleCreateAttachment } = require("./api/attachments");

// Ticket 21
const {
  handleGetInvoices,
  handleCreateInvoice,
  handleGetInvoiceById,
  handleUpdateInvoice,
} = require("./api/invoices");
const { handleCreatePayment } = require("./api/payments");
const { handleEstimatorConfig, handleEstimatorHealth, handleEstimatorQuote, handleEstimatorClassification } = require("./api/estimator-config");
const { resolveZone, shouldReject, ZONE_RULES } = require("./lib/serviceArea");

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

  if (req.url === "/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.pin && body.pin === process.env.CRM_PIN) {
      setAuthCookie(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, redirect: "/clients" }));
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Invalid PIN." }));
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
    return serveFile(res, path.join(__dirname, "pages/invoice-detail.html"), "text/html");
  }

  // PROTECTED CRM PAGES
  if (req.url === "/crm/new") {
    return serveFile(res, path.join(__dirname, "pages/crm-new.html"), "text/html");
  }

  if (req.url === "/crm/leads") {
    return serveFile(res, path.join(__dirname, "pages/crm-leads.html"), "text/html");
  }

  if (req.url === "/crm/schedule") {
    return serveFile(res, path.join(__dirname, "pages/crm-schedule.html"), "text/html");
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

  if (req.url.startsWith("/api/actuals-rollup") && req.method === "GET") {
    return handleActualsRollup(req, res);
  }

  if (req.url.startsWith("/api/dashboard") && req.method === "GET") {
    return handleDashboard(req, res);
  }

  if (req.url.startsWith("/api/audit") && req.method === "GET") {
    return handleGetAudit(req, res);
  }

  if (req.url.startsWith("/api/clients") && req.method === "GET") {
    const cpath = req.url.replace(/\?.*$/, "");
    if (cpath === "/api/clients") return handleGetClients(req, res);
    if (cpath.endsWith("/requests")) return handleGetClientRequests(req, res);
    if (cpath.endsWith("/quotes")) return handleGetClientQuotes(req, res);
    if (cpath.endsWith("/jobs")) return handleGetClientJobs(req, res);
    if (cpath.endsWith("/notes")) return handleGetClientNotes(req, res);
    if (cpath.endsWith("/attachments")) return handleGetClientAttachments(req, res);
    return handleGetClientById(req, res);
  }

  // Ticket 21: invoices API
  if (req.url === "/api/invoices" && req.method === "GET") {
    return handleGetInvoices(req, res);
  }

  if (req.url === "/api/invoices" && req.method === "POST") {
    return handleCreateInvoice(req, res);
  }

  if (req.url.startsWith("/api/invoices/")) {
    const clean = req.url.replace(/\?.*$/, "");
    if (req.method === "GET") return handleGetInvoiceById(req, res);
    if (req.method === "PATCH") return handleUpdateInvoice(req, res);
  }

  // Ticket 21: payments API
  if (req.url === "/api/payments" && req.method === "POST") {
    return handleCreatePayment(req, res);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

const { ensureAllHeaders } = require("./lib/sheetsSchema");
const { ensureConfigDefaults } = require("./lib/config");
const { seedQuoteSheetIfEmpty, backfillSegmentCategory, logQuoteHealth } = require("./lib/quoteSeedInit");
const { isV2Mode } = require("./lib/estimatorV2Config");

server.listen(5000, "0.0.0.0", () => {
  console.log("Server running on port 5000");
  console.log(`Estimator Mode: ${isV2Mode() ? "v2" : "v1"}`);
  ensureAllHeaders()
    .then(() => ensureConfigDefaults())
    .then(() => seedQuoteSheetIfEmpty())
    .then(() => backfillSegmentCategory())
    .then(() => logQuoteHealth())
    .catch((err) => console.error("[Startup]", err.message));
});