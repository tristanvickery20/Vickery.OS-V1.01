# VE OS Current Audit

Audit date: 2026-05-06

QA reviewed: 2026-05-06

This audit documents what was found in the current repo. If something was not verified in the inspected files, it is marked as not found or not clearly implemented yet.

## Repository inspected

- Repository: `tristanvickery20/Vickery.OS-V1.01`
- Branch: `main`

## Current framework

- The app is a plain Node.js HTTP server using Node core modules: `http`, `fs`, and `path`.
- Main entry file: `index.js`.
- It does not appear to be an Express app.
- It does not appear to be a React/Vite/Next app.
- Static HTML/CSS/JS pages are served from the `pages/` folder.
- API handlers are organized under `api/` and imported directly into `index.js`.
- Shared helper/data/integration logic is organized under `lib/`.

## Package scripts

Found in `package.json`:

```json
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

There is no `start`, `build`, `check`, or real `test` script in `package.json`.

Current dependencies found:

- `@replit/connectors-sdk`
- `@types/node`
- `googleapis`

## Current folder structure summary

The repo structure was inferred from inspected imports and fetched files.

Confirmed top-level files/folders:

- `index.js`
- `package.json`
- `api/`
- `lib/`
- `pages/`
- `pages/js/`
- `pages/css/`
- `pages/partials/`
- `pages/img/`
- `pages/pwa/`
- `uploads/` route support exists in `index.js`
- `docs/` created during this audit

Not found in current repo:

- `README.md` before this audit
- `render.yaml`
- `Procfile`
- `.github/workflows/ci.yml`
- `server.js`

## Current routing/pages

### Public website routes found in `index.js`

- `/` -> `pages/site-home.html`
- `/services` -> `pages/site-services.html`
- `/about` -> `pages/site-about.html`
- `/contact` -> `pages/site-contact.html`
- `/service-area` -> `pages/site-service-area.html`
- `/why-vickery` -> `pages/site-why.html`
- `/reviews` -> `pages/site-reviews.html`
- `/referral` -> `pages/site-referral.html`
- `/financing` -> `pages/site-financing.html`

### Public careers routes found in `index.js`

- `/careers` -> `pages/careers.html`
- `/offer/:token` -> `pages/offer-view.html`

### PWA/static routes found in `index.js`

- `/manifest.json` -> `pages/pwa/manifest.json`
- `/sw.js` -> `pages/pwa/sw.js`
- `/pages/js/*`
- `/pages/css/*`
- `/pages/partials/*`
- `/pages/img/*`
- `/uploads/*` with path traversal protection and auth protection for resume files

### CRM/admin routes confirmed by files or sidebar links

Confirmed file:

- `/crm/dashboard` appears to map to `pages/crm-dashboard.html`.
- `/crm/schedule` appears to map to `pages/crm-schedule.html`.
- `/clients` appears to map to `pages/clients.html`.

Confirmed sidebar links:

- `/crm/dashboard`
- `/crm/schedule`
- `/clients`
- `/crm/weekly`
- `/invoices`
- `/crm/calculator`
- `/crm/fleet`
- `/crm/time`
- `/crm/expenses`
- `/crm/marketing`
- `/people/employees`
- `/people/attendance`
- `/people/shifts`
- `/people/departments`
- `/people/designations`
- `/people/leave`
- `/people/leave/types`
- `/people/leave/policies`
- `/people/job-openings`
- `/people/applicants`
- `/people/payroll/runs`
- `/people/expense-claims`
- `/people/payroll/structures`
- `/people/payroll/components`
- `/people/payroll/settings`
- `/crm/staff`
- `/crm/audit`
- `/crm/estimator-audit`
- `/crm/rulebook`
- `/crm/protocols`
- `/crew`
- `/crm/settings`

Not all sidebar-linked page files were individually fetched during this pass. Treat linked routes as visible navigation intent, not proof that every page is complete.

### Crew routes found in `index.js`

- `/crew/login` redirects to `/login`.
- `/crew` and `/crew/` require crew session and serve `pages/crew.html`.

## Current admin/owner dashboard

Dashboard UI exists at `pages/crm-dashboard.html`.

Observed dashboard UI sections include:

- Today header and refresh
- Filter chips for All, Jobs, Estimates, Tasks
- Overdue section
- Today's Schedule
- Open Tasks
- This Week strip
- KPI cards for Pipeline, Money, Operations, Closeout, Bonus Tracker, Financials, Profit Share, and Recent Activity

Dashboard API exists at `api/dashboard.js`.

Observed dashboard API behavior includes:

- Reads Google Sheets tabs: `Leads`, `Time`, `Expenses`, `Quotes`, `QuoteSnapshots`, `Config`, `Attachments`, `Clients`, and `Invoices`.
- Calculates pipeline, money, operations, closeout, KPI, bonus, profit-share, job costing, receivables, deposit risk, and recent activity data.
- Uses `lib/accounting` for dashboard financials.

Risk/limitation:

- Dashboard exists and is substantial, but it is not clearly a complete six-system owner command center yet.

## Current CRM modules

Based on `index.js` imports, sidebar links, and sampled files, the current app has module coverage for:

- Dashboard
- Leads/clients
- Quotes/quote snapshots/estimator
- Scheduling/bookings/calendar/map/reschedule
- Time
- Expenses
- Invoices/payments
- Reviews/referrals
- Marketing/templates/follow-up
- Tasks
- Audit
- Crew portal
- Staff/crew auth
- HR people/departments/designations
- HR attendance/shifts/corrections
- HR leave/holidays/policies/applications
- HR recruiting/applicants/interviews/offers
- HR payroll/expense claims/salary structures/components/payroll runs/slips
- Fleet tracking through Traccar
- Google Calendar settings/sync
- QuickBooks settings/OAuth/accounting data
- Protocols/rulebook style admin pages by sidebar link

## Current data/storage approach

Primary storage appears to be Google Sheets.

Confirmed:

- `lib/sheets.js` requires `GOOGLE_SERVICE_ACCOUNT_JSON` and uses Google Sheets API via `googleapis`.
- `lib/sheets.js` creates and returns the authenticated Google Sheets client; it does not itself require `CRM_SHEET_ID`.
- Most API/data modules that read or write Sheets use `process.env.CRM_SHEET_ID` as the spreadsheet ID.
- `lib/staff.js`, `lib/hr.js`, `lib/hr-payroll.js`, `api/dashboard.js`, `api/leads.js`, `api/invoices.js`, `api/quote-engine.js`, and `api/traccar.js` all use Google Sheets or depend on helper functions that do.

Confirmed or referenced tabs include:

- `Leads`
- `Clients`
- `Properties`
- `Requests`
- `Quotes`
- `QuoteSnapshots`
- `Bookings`
- `Time`
- `Expenses`
- `Invoices`
- `Payments` or payment-related sheets through payment APIs, not fully audited in this pass
- `Config`
- `Attachments`
- `Tasks`
- `Events`
- `Staff`
- `HR_Departments`
- `HR_Designations`
- `HR_ExpenseClaims`
- `HR_ExpenseClaimItems`
- `HR_SalaryComponents`
- `HR_SalaryStructures`
- `HR_SalaryStructureItems`
- `HR_SalaryAssignments`
- `HR_PayrollSettings`
- `HR_PayrollRuns`
- `HR_PayrollRunAdditions`
- `HR_SalarySlips`

Other storage:

- Some uploaded files are served from `uploads/`.
- Traccar position/trip data is cached in memory.
- Accounting provider selection is cached in memory for two minutes.

## Current APIs found

`index.js` imports many API handlers. Confirmed API areas include:

- Quote/config/quote engine
- Site visit booking
- Photo upload
- Schedule slots, blocks, booking, admin bookings, calendar, patch booking, suggest, geocode, optimize, reschedule
- Seed quote
- Leads create/get/snapshot/status/update/schedule
- Techs
- Events
- Dashboard and dashboard financials
- Today/week day
- Bonus eligibility
- App lead create
- Time
- Expenses
- Quotes
- Audit
- Actuals rollup
- Crew
- Crew auth/staff approval/review ask/notifications
- Referral
- Reviews
- Marketing
- Templates
- Clients
- Notes
- Attachments
- Invoices
- Public pay
- Payments
- Estimator config/matrix/classification
- Mapbox config
- Traccar positions/trips
- Protocols to Drive
- Weekly pulse
- Tasks
- Google Calendar settings/sync/bootstrap/backfill/verify/share/watch channels
- Settings notifications/QuickBooks/staff settings
- QuickBooks OAuth
- Accounting transactions/profit/loss/accounts
- HR people
- HR attendance
- HR leave
- HR recruiting
- HR payroll

## Current website/estimator flow

What exists:

- Public website pages exist as static HTML routes.
- Quote engine supports start, calc, lock, and consult request.
- Quote snapshots are preserved in `QuoteSnapshots`.
- Quote engine supports V1/V2 selection based on `ESTIMATOR_V2_SHEET_ID`.
- Quote engine has manual review blocking, photo gate enforcement, review flags, and material disclosures.
- Quote lock can create/update a `Leads` row.

Not clearly implemented yet:

- Exact customer quote page route/file was not fully confirmed in this pass.
- Full UI QA from public estimator page through CRM lead and schedule booking was not completed in this doc pass.

## Current job pipeline/status logic

What exists:

- Leads and clients have status fields such as `status`, `status_code`, scheduled fields, assigned fields, invoice/payment fields, quote IDs, and job numbers.
- Dashboard groups some statuses into awaiting approval, active, complete/closed/paid, overdue, scheduled, in progress, and similar operational buckets.
- Invoices enforce at least one gate in `api/invoices.js`: request-based invoice creation requires request status `complete`.
- Schedule, time, expenses, crew, invoice, review, and actuals APIs exist.

Not clearly implemented yet:

- A complete formal lifecycle engine covering New Lead → Qualified → Quoted → Needs Review → Accepted → Scheduled → Prepped → In Progress → Complete → Invoiced → Paid → Closed → Review Requested → Retention → Retouched → Reactivated.
- A single visible per-job checklist enforcing every stage requirement.
- A complete retention/year-5 retouch workflow.

## Current auth/user/permissions

What exists:

- CRM session auth exists in `lib/auth.js` using signed `crm_session` cookie and `SESSION_SECRET`.
- `lib/auth.js` fails closed if `SESSION_SECRET` is missing.
- Crew session auth exists in `lib/staff.js` using signed `crew_session` cookie and `SESSION_SECRET`.
- `lib/staff.js` stores staff account fields in the `Staff` sheet, including status, permissions, username, and role.
- Crew portal route requires a crew session.
- Some crew write endpoints require crew or CRM session.
- Resume uploads under `uploads/resumes` require CRM auth.

Not clearly implemented yet:

- Complete role-based admin permissions across every CRM module.
- Full separation between owner/admin/manager/crew permissions across all API routes.

Risk:

- Some crew endpoints are described as public employee-facing in `index.js` comments. Future security pass should audit which endpoints are intentionally public, crew-session-gated, or CRM-auth-gated.

## Fleet/tools/inventory notes

What exists:

- Traccar fleet tracking integration exists in `api/traccar.js`.
- Live Fleet sidebar route exists as `/crm/fleet`.
- Material price updater exists in `lib/materialPriceUpdater.js` and adjusts estimator `Materials` pricing from BLS PPI data.
- Expenses can capture gas/material/parts style costs depending on sheet/UI values.

Not found in current repo during QA spot-check:

- `api/inventory.js`
- `api/tools.js`
- `api/assets.js`

Not clearly implemented yet:

- Dedicated tools inventory module.
- Vehicle maintenance schedule/history module.
- Tool/asset assignment workflow.
- Truck stock/min-max inventory workflow.

## Current Render/build notes

Found:

- `package.json` has `main: index.js`.
- No `start` script is defined.
- No `build` script is defined.
- No `check` script is defined.
- No `render.yaml` found.
- No `Procfile` found.

Not clearly implemented yet:

- Render deploy instructions in repo.
- Confirmed Render start command.

Likely Render setup depends on dashboard configuration outside the repo, probably a manual start command like `node index.js`, but this was not verified from repo files.

## Environment variables observed from code

Required or referenced:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — required by `lib/sheets.js`.
- `CRM_SHEET_ID` — used by most Google Sheets-backed modules as the spreadsheet ID.
- `SESSION_SECRET` — required by CRM and crew session signing/password legacy verification.
- `ESTIMATOR_V2_SHEET_ID` — optional switch for estimator V2 mode.
- `TRACCAR_URL` — optional/enables Traccar fleet tracking.
- `TRACCAR_TOKEN` — optional/enables Traccar fleet tracking.
- `TRACCAR_MODE` — optional informational mode for Traccar.
- `REPLIT_DEV_DOMAIN` and `REPLIT_DOMAINS` — used to build public invoice URL fallback in `api/invoices.js`.

Other env vars may exist in files not fully audited during this pass.

## Current broken or risky areas

- `package.json` has no real build/check/test script.
- `npm test` is a placeholder that intentionally exits 1.
- No `README.md` existed before this audit.
- No `render.yaml` or `Procfile` found, so Render setup is not documented in repo.
- The app is large and centralized in `index.js`; route logic may be hard to review safely.
- Google Sheets is the primary data store, but many tabs are assumed by code. Missing headers/tabs could cause runtime errors unless ensure/migration functions are called before use.
- Some modules have old/new model overlap, especially `Leads`, `Clients`, `Requests`, and quote snapshots.
- Full role/permission enforcement is not clearly implemented yet.
- Full job pipeline/stage enforcement is not clearly implemented yet.
- Fleet/tool/inventory scope is only partially covered by Traccar, expenses, and material updater; dedicated tool/inventory records are not clearly implemented yet.

## Current duplicate/unclear areas

- Lead/client model overlap: `api/leads.js` says it is unified and reads/writes `Clients`, while also reading legacy `Leads` tab records.
- Invoice creation supports request-based and lead/client-based paths.
- Quote data exists across `Quotes`, `QuoteSnapshots`, and lead/client fields.
- Status naming appears mixed across older and newer systems: examples include `status`, `status_code`, `Estimate Sent`, `awaiting_response`, `scheduled`, `complete`, `closed`, and `paid`.
- Accounting provider is dynamic and can be mock or QuickBooks, which is useful but should be documented clearly in UI/settings.

## Recommended next step

Step 2 should focus on the Admin / Owner Command Dashboard.

Recommended Step 2 scope:

- Do not redesign the app.
- Inspect `pages/crm-dashboard.html`, `pages/js/crm-dashboard.js`, `api/dashboard.js`, `pages/partials/sidebar.html`, and `api/today.js`.
- Add or repair an owner action queue that surfaces the most important blocked/stuck items across the six systems.
- Keep changes visible on `/crm/dashboard`.
- Do not build new backend-only systems without UI proof.

## Build/check result during this audit

The repo has no safe real build/check script in `package.json`.

The only script is `npm test`, which is intentionally a failing placeholder:

```text
Error: no test specified
```

No app logic was changed in this pass. Only docs and README source-material references were added.
