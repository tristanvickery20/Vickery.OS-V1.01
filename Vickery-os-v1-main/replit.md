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
  quote.html          # Instant quote calculator + Save as Lead (public)
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

## Key Features
- **Quote Snapshots**: POST /api/quotes/create runs pricing, builds auditable JSON snapshot, upserts lead, appends to Quotes tab
- **Deposit Gate**: Prevents scheduling large jobs (deposit_required=true) without deposit received or explicit override
- **Auto Headers**: lib/sheetsSchema.js auto-creates tabs (Leads, Quotes, Time, Expenses, Audit, Config, Clients, Properties, Requests, Jobs, Visits, Notes, Attachments, Availability) and adds missing columns on server startup
- **Two Update Paths**: /api/leads/update (general) and /api/leads/schedule (with deposit gate enforcement)
- **Apps Script Integration**: POST /api/apps/lead for secure lead creation via Apps Script
- **Time Tracking**: Log work/drive/admin minutes per tech per lead. GET/POST /api/time
- **Expense Tracking**: Log gas/material/parts/other expenses. GET/POST /api/expenses
- **Dashboard KPIs**: hours_this_week, expenses_this_week, gas_this_week (Mon-Sun UTC week)

## Authentication
- PIN-based login using CRM_PIN secret
- HMAC-signed HttpOnly cookie (SESSION_SECRET), 24h TTL
- Public routes: /, /quote, /login, /logout, /health, /api/quote*, /api/quotes/create, /api/apps/lead
- Protected: all /crm/* pages (302 redirect to /login) and /api/* endpoints (401 JSON)
- Logout link in nav of all CRM pages

## Recent Changes
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
