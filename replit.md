# Vickery Electric CRM

## Overview
Internal CRM portal for Vickery Electric. Manages leads, scheduling, dashboard KPIs, and instant quotes. Backed by Google Sheets via API.

## Tech Stack
- **Backend**: Node.js (vanilla `http` module), Express-less
- **Frontend**: Static HTML pages with shared CSS branding
- **Data**: Google Sheets API via `googleapis`
- **Port**: 5000 (bound to 0.0.0.0)

## Brand Identity
Matches the Vickery Electric estimate calculator site:
- **Primary Color**: HSL(220, 100%, 25%) - Deep navy blue
- **Fonts**: Outfit (headings/display), Plus Jakarta Sans (body)
- **Style**: Clean, modern, premium - rounded corners, soft shadows, blue-tinted palette
- **CSS Variables**: All colors use HSL custom properties in `/pages/css/brand.css`

## Project Structure
```
index.js              # HTTP server (port 5000), routing, auth guard
api/                  # API route handlers (leads, quotes, techs, dashboard)
lib/                  # Shared libs (pricing, sheets client, auth, schedule, config)
  auth.js             # HMAC-signed cookie session (PIN login)
  config.js           # Config tab reader (labor rates, burden %)
pages/
  login.html          # PIN login page
  clients.html        # Client Book list (protected, default landing)
  client-detail.html  # Client detail page with tabs (protected)
  crm-dashboard.html  # Dashboard with KPIs (protected)
  crm-leads.html      # Lead management table (protected)
  crm-lead.html       # Single lead detail + financials + quote snapshot (protected)
  crm-new.html        # New lead form (protected)
  crm-schedule.html   # Daily schedule view (protected)
  crm-time.html       # Time tracking (protected)
  crm-expenses.html   # Expense tracking (protected)
  crm-audit.html      # Audit log viewer (protected)
  quote.html          # Instant quote calculator (public, old white-card UI)
  instant-estimate.html # Instant estimate wizard (dark-themed, full estimator flow)
  css/brand.css       # Shared brand stylesheet
  css/shell.css       # App shell layout (sidebar + main area)
  partials/sidebar.html # Sidebar HTML snippet (fetched client-side)
  img/logo.png        # Vickery Electric logo
  js/shell.js         # Sidebar loader, dropdown toggle, active link
  js/                 # Client-side JavaScript
```

## Layout
- **Authenticated pages**: Sidebar (left, 240px) + main content area. Sidebar fetched as HTML partial.
- **Mobile**: Sidebar collapses to compact top strip with hamburger toggle.
- **Public pages** (quote, login): Traditional header + nav layout.
- **Default landing**: `/clients` (authenticated) or `/login` (unauthenticated).

## Instant Estimator Engine

| Secret | Effect |
|---|---|
| `ESTIMATOR_V2_SHEET_ID` set | V2 engine active — reads Assemblies, AssemblyItems, Tasks_Labor, Materials, Scenario_Drivers, Driver_Multipliers, Rates_Rules, Config from new sheet |
| `ESTIMATOR_V2_SHEET_ID` absent | V1 engine (CRM_SHEET_ID JobTypes/Rates/etc.) — automatic fallback |

Startup log prints `Estimator Mode: v2` or `v1`.

### V2 Pricing Flow
Assembly → labor_hours × qty → apply driver multipliers → add drive_hours → crew rate → material cost (AssemblyItems) + waste + markup → overhead % → risk multiplier → base_fee → true cost → 30% margin → minimums → travel fee (ServiceAreas from CRM) → round to $5

### V2 Config Shape (lib/estimatorV2Config.js)
Returns identical shape to `getQuoteConfig()`:
- `jobTypes[]`, `questionsByType{}`, `optionsByQuestion{}`, `addonsByType{}`, `rates{}`, `serviceAreas{}`
- Also returns `_v2` (internal data stripped from public `/api/quote/config` response)

### Qty Bug Fix
Server now handles qty fully for both V1 and V2:
- Frontend passes `qty` to `/api/quote/calc` and `/api/quote/lock`
- Server returns `final_price` inclusive of qty; frontend uses it directly
- No client-side price multiplication

## Key Features
- **Quote Snapshots**: POST /api/quotes/create runs pricing, builds auditable JSON snapshot, upserts lead, appends to Quotes tab
- **Deposit Gate**: Prevents scheduling large jobs (deposit_required=true) without deposit received or explicit override
- **Auto Headers**: lib/sheetsSchema.js auto-creates tabs and adds missing columns on server startup; tabs include Leads, Quotes, Time, Expenses, Audit, Config, Clients, Properties, Requests, Jobs, Visits, Notes, Attachments, Availability, JobTypes, Questions, AnswerOptions, AddOns, Rates, ServiceAreas, QuoteSnapshots, Bookings, SchedulerRules
- **Two Update Paths**: /api/leads/update (general) and /api/leads/schedule (with deposit gate enforcement)
- **Apps Script Integration**: POST /api/apps/lead for secure lead creation via Apps Script
- **Time Tracking**: Log work/drive/admin minutes per tech per lead. GET/POST /api/time
- **Expense Tracking**: Log gas/material/parts/other expenses. GET/POST /api/expenses
- **Dashboard KPIs**: hours_this_week, expenses_this_week, gas_this_week (Mon-Sun UTC week)
- **V3 Public Quote Flow** (Block 3-4): /quote — multi-step funnel (old white-card UI preserved): Type → Categories → Service+Qty → Details (dynamic questions from 51-module estimator library, matched by service name fuzzy lookup) → Review (price + calendar slot picker) → Confirm (lead form + ZIP reprice) → [Photo gate] → Booked. Disqualifying module options navigate to a site-visit screen. Inline photo upload in questions step. GET /api/schedule/slots now accepts ?minutes=N for pre-lock browsing.
- **Module Enrichment**: pages/js/quote.js boot() fetches /api/estimator/config alongside /api/quote/config and uses fuzzy name-matching (word overlap + partial-word credit, ≥52% threshold) to replace static questionsByType with per-service module questions from the estimator sheet. 25/54 job types matched and enriched.
- **Quote Engine** (Block 1-2): /api/quote/config, /api/quote/start, /api/quote/calc, /api/quote/lock — reads JobTypes/Questions/AnswerOptions/AddOns/Rates/ServiceAreas; writes QuoteSnapshots; photo_required flag support
- **Photo Upload**: POST /api/quote/photo — accepts base64 JSON, saves to /uploads/, logs QuoteSnapshots event
- **Crew-Hours Scheduler** (Block 4): GET /api/schedule/blocks — returns Morning/Afternoon blocks with crew-hours capacity (hours_capacity, hours_used, hours_remaining) plus legacy headcount fields. POST /api/schedule/book — hours-aware booking engine: reads job duration from locked QuoteSnapshot (total_hours), calls planMultiBlockBooking() to span consecutive blocks if job exceeds one block's capacity (Morning→Afternoon→next-Mon-Fri bridging). Writes one Bookings row per segment with block_allocated_minutes + booking_group_id + is_continuation. GET /api/schedule/bookings — CRM admin read (all columns A:P).
- **lib/schedulerCapacity.js**: Core capacity engine — getBlockCapacityMins (crew_size×240, default 480 min/block), getBlockUsedMins (sums block_allocated_minutes with duration_minutes fallback), getNextWorkingBlock (Morning→same-day Afternoon; Afternoon→next Mon-Fri Morning, skips weekends), planMultiBlockBooking (chains segments until jobMins exhausted), getJobMinsFromSnapshot.
- **SchedulerRules sheet**: timezone, lead_time_hours, morning/afternoon_capacity (headcount), crew_size (default 2). Auto-created with defaults on first startup.
- **Bookings sheet** new columns: block_allocated_minutes, booking_group_id, is_continuation (all auto-added via ensureTabHeaders on startup).
- **CRM Schedule view** (crm-schedule.html): shows per-block crew-hours load bar (color-coded green/amber/red) and ⛓ continuation badge on multi-block job rows.
- **Quote /booked screen**: shows all blocks_reserved when job spans >1 block ("Your job spans: Morning (X hrs) + Afternoon (Y hrs)").

## Authentication
- PIN-based login using CRM_PIN secret
- HMAC-signed HttpOnly cookie (SESSION_SECRET), 24h TTL
- Public routes: /, /quote, /login, /logout, /health, /api/quote*, /api/quotes/create, /api/apps/lead
- Protected: all /crm/* pages (302 redirect to /login) and /api/* endpoints (401 JSON)
- Logout link in nav of all CRM pages

## Architecture Note
- **Pipeline view**: `/clients` is the single pipeline entry point, powered directly by the Leads tab. `handleGetClients` reads from `readTab("Leads")` and returns lead rows shaped as pipeline items. Each row links to `/crm/lead?id=<lead.id>`. The Clients/Properties tabs are still intact for `handleGetClientById` and sub-resource endpoints.

## Recent Changes
- 2026-03-09: Estimator Accuracy Fix Round 1 — CRIT-1: enriched /quote module answers now wire into V2 pricing engine (effect_type/effect_value); CRIT-2: instant-estimate now passes answersByModule to getBasePrice() and resolves module multipliers into selectedDriverOptions; CRIT-3: Driver_Multipliers sheet patched with 11 missing rows (CEILING_HT Under/Mid/High, ATTIC_ACCESS Yes/Limited/Not sure, WALL_TYPE Drywall/Tile/Wood, HOME_OCC Yes/No); CRIT-7: server-side disqualify guard in handleQuoteCalc + handleQuoteLock catches commercial/brick/etc. via resolveModuleAnswers(); HIGH-1: material_path_report.md documents 40 zero-cost placeholder rows needing pricing data. New deliverables: scripts/patch-driver-multipliers.js (idempotent), estimator_fix_round_1_report.md, estimator_driver_mapping.json, material_path_report.md.
- 2026-03-02: Redesigned /quote UI — multi-select categories (checkmark badge), qty +/- per service, price+slots on same review screen (before lead info), lead form moved to confirm step, ZIP triggers live reprice with qty-adjusted total; GET /api/schedule/slots now accepts ?minutes=N for pre-lock slot browsing; profit calculator and CRM untouched
- 2026-02-23: Notes + Photos MVP (Ticket 13) - POST /api/notes with validation/audit/touchClient, POST /api/attachments with file_type inference/audit/touchClient, lib/touchClient.js updates last_activity_at cell, Add Note form on Notes tab, Add Photo (URL) form on Photos tab with category badge, lightbox modal (X/backdrop/Escape close), fire-and-forget audit logging
- 2026-02-23: Client Detail Page + Client-Scoped APIs (Ticket 12) - GET /api/clients/:id with primary property, GET /api/clients/:id/requests|quotes|jobs|notes|attachments, client-detail.html with header/cards/7 tabs (Overview/Requests/Quotes/Jobs/Invoices/Notes/Photos), quick action buttons (Call/Text/Email), property directions link, status badges, all data fetched in parallel, mobile-responsive
- 2026-02-23: Client Book + /api/clients (Ticket 11) - lib/readTab.js generic sheet reader, GET /api/clients with search/status/sort/limit, pages/clients.html Jobber-like list UI with avatar/status pills/property preview, pages/js/clients.js with debounced search and scroll restore, /clients/:id placeholder detail page, all auth-protected
- 2026-02-23: Google Sheets Tab Expansion (Ticket 10) - Added 8 new tabs (Clients, Properties, Requests, Jobs, Visits, Notes, Attachments, Availability) to sheetsSchema.js, auto-created on startup with idempotent header management, schema-only (no data migration)
- 2026-02-23: Jobber-Inspired App Shell Swap (Ticket 9b) - Replaced header+horizontal nav with persistent left sidebar on all authenticated pages, new /clients placeholder page as default landing, Create dropdown with quick-create links, sidebar with Work/Financial/Tracking/Admin sections, mobile-responsive collapse, removed Home concept, updated root/login redirects to /clients
- 2026-02-23: Added Job Costing + Margin Visibility (Ticket 9a) - Config tab with labor_rate_tech/admin/burden_pct defaults, lib/config.js reader, GET /api/leads now returns labor_cost/expense_cost/total_cost/gross_profit/gross_margin_pct computed dynamically, dashboard KPIs for labor cost this week / gross profit / gross margin, lead detail Financial Summary section
- 2026-02-23: Added Audit Log + Change History (Ticket 8) - Audit tab auto-setup, lib/audit.js logAudit helper, audit wired into all create/update/schedule/block flows, GET /api/audit with filters, crm-audit.html page, Audit nav link on all CRM pages
- 2026-02-23: Added CRM PIN Login + Protected Routes (Ticket 7) - lib/auth.js, pages/login.html, auth guard in index.js, Logout link on all CRM pages
- 2026-02-23: Added Simple Scheduling Assistant (Ticket 6) - POST /api/schedule/suggest, lib/schedule.js preference parsing + slot finder, Suggest button on leads table and new lead form
- 2026-02-23: Added Quote Snapshot + Create/Upsert Lead from Quote (Ticket 5) - Quotes tab, POST /api/quotes/create, quote.html Save as Lead, crm-lead.html detail page with snapshot view, View link in leads table
- 2026-02-23: Added Stage Gates + Invoice/Payment flow (Ticket 4) - stage enforcement in leads-update, auto invoice_date/paid_date, new dashboard KPIs (invoiced, paid, receivables, completed_not_invoiced)
- 2026-02-23: Added Time & Expense tracking (Ticket 3) - new sheets tabs, API endpoints, CRM pages, dashboard KPIs
- 2026-02-23: Fixed deposit gate - aligned override_deposit to deposit_override in leads-update.js, added schedule_window/preference to frontend payload, added ensureSheetHeaders for auto column creation
- 2026-02-23: Added deposit gate system with PATCH /api/leads/schedule endpoint
- 2026-02-23: Rebranded all pages to match Vickery Electric brand identity (fonts, colors, layout, components)
