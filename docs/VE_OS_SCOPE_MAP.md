# VE OS Scope Map

Last updated: 2026-05-06

This document maps the current repo against the six VE OS operating systems. It is based on repo inspection, not assumptions.

## A. Admin / Owner Command System

### Purpose

Give the owner one command center for daily priorities, overdue work, pipeline, money, operational risk, staff approvals, reminders, tasks, audits, and strategic control.

### What exists now

- Primary dashboard route appears to be `/crm/dashboard`.
- Dashboard UI exists in `pages/crm-dashboard.html`.
- Dashboard API exists in `api/dashboard.js` and reads Google Sheets tabs such as `Leads`, `Time`, `Expenses`, `Quotes`, `QuoteSnapshots`, `Config`, `Attachments`, `Clients`, and `Invoices`.
- Sidebar exists in `pages/partials/sidebar.html` and links to Dashboard, Schedule, Clients, Weekly Pulse, Invoices, Calculator, Live Fleet, Time, Expenses, Marketing Hub, People, Payroll, Staff, Audit, Price Matrix, Rulebook, Protocols, Crew View, and Settings.
- Audit API exists through `api/audit.js` referenced by `index.js`.
- Tasks API exists through `api/tasks.js` referenced by `index.js`.
- Weekly Pulse API exists through `api/weekly-pulse.js` referenced by `index.js`.
- Login/session auth exists through `lib/auth.js` and uses a signed `crm_session` cookie.
- Crew/staff session auth exists through `lib/staff.js` and `api/crew-auth.js`.

### What is missing or not clearly implemented yet

- Not clearly implemented yet: a complete owner responsibility command center covering daily, weekly, monthly, quarterly, yearly obligations.
- Not clearly implemented yet: a single owner task/responsibility calendar that ties together payroll, compliance, fleet, marketing, finance, closeout, reviews, and strategy.
- Not clearly implemented yet: owner-level operating alerts across all six systems in one prioritized queue.
- Not clearly implemented yet: formal stage-gate enforcement visibility on the dashboard for every job stage.
- Not clearly implemented yet: complete role/permission model beyond session auth, crew session, staff status, and basic permissions fields.

### What should be built later

- Owner command queue grouped by urgency and operating system.
- Responsibility calendar for daily/weekly/monthly/yearly owner tasks.
- Dashboard alerts for stuck leads, overdue quotes, unscheduled accepted work, uninvoiced completed work, unpaid invoices, missing time/photos, payroll review needs, fleet maintenance, expiring insurance/license/compliance items, and review follow-ups.
- Dashboard drilldowns that link directly to the page/entity needing action.
- Owner role/responsibility documentation embedded into the CRM where useful.

### What should not be built yet

- Full enterprise operations platform rewrite.
- Complex custom permission system until current staff/crew flows are stabilized.
- Hidden backend alert engines with no visible UI.

### UI visibility notes

Admin/owner control should remain centered on `/crm/dashboard` and visible sidebar modules. Backend-only owner logic should have a visible dashboard card, badge, list, or detail view unless the task is explicitly backend-only.

### Owner control notes

The owner should be able to open `/crm/dashboard` and immediately know what needs attention today, what is stuck, what is risky, and which page or record to open next. Existing dashboard pieces are present, but the complete owner command queue is not clearly implemented yet.

## B. Sales / Estimator / Website Intake System

### Purpose

Capture demand, price work, preserve quote assumptions, route manual-review jobs, and convert customers with as little owner chaos as possible.

### What exists now

- Public website routes exist in `index.js`: `/`, `/services`, `/about`, `/contact`, `/service-area`, `/why-vickery`, `/reviews`, `/referral`, and `/financing`.
- Public careers route exists at `/careers`.
- Quote APIs exist through `api/quote.js`, `api/quote-config.js`, `api/quote-engine.js`, `api/estimator-config.js`, and `api/estimator-matrix.js` referenced by `index.js`.
- Quote engine supports `/api/quote/start`, `/api/quote/calc`, `/api/quote/lock`, and `/api/quote/consult-request` through `api/quote-engine.js`.
- Quote snapshots are written to the `QuoteSnapshots` Google Sheet tab by `api/quote-engine.js`.
- Quote lock can upsert a lead into the `Leads` tab.
- Estimator V2 mode is controlled by `ESTIMATOR_V2_SHEET_ID` if present, otherwise V1 is used.
- Service classification, manual-review blocking, photo-gate enforcement, review flags, material disclosure, and disqualify handling are present in quote engine logic.
- Leads API exists in `api/leads.js`; current comments state it is unified and reads/writes primarily from the `Clients` tab while also reading legacy `Leads` records.
- Marketing attribution normalization exists in lead/quote logic.

### What is missing or not clearly implemented yet

- Not clearly implemented yet: a fully audited customer-facing quote page route in this pass. `index.js` references quote APIs and public pages, but the exact quote page file/route needs deeper route inspection.
- Not clearly implemented yet: complete proof that every estimator answer maps to one of the required pricing effects across the whole pricing data set.
- Not clearly implemented yet: complete owner review queue for `Needs Review` quote/job conditions.
- Not clearly implemented yet: complete lead response timer and duplicate-client prevention surfaced clearly in UI.
- Not clearly implemented yet: quote expiration enforcement surfaced in UI.

### What should be built later

- Sales/intake QA pass from customer quote page through CRM lead creation.
- Needs Review queue that requires photos/notes, blocks auto-booking, assigns reviewer, and tracks review reason.
- Clear quote snapshot display on lead/client detail.
- Lead source tracking and conversion reporting tied to dashboard and marketing hub.
- Duplicate client detection and merge/review workflow.
- Quote expiration and reprice rules.

### What should not be built yet

- Paid estimator integrations.
- AI price guessing outside the deterministic sheet-driven model.
- Good/Better/Best quote packages unless business doctrine changes.
- Broad commercial estimating suite before residential launch flow is stable.

### UI visibility notes

Sales and estimator workflows must show the owner where each lead came from, what price was shown, what assumptions were used, whether manual review is required, and what action is next.

### Owner control notes

The owner should not have to remember which leads need response, review, follow-up, or scheduling. Current quote and lead data exists, but a complete visible owner review/follow-up queue is not clearly implemented yet.

## C. Job Operations / Scheduling / Closeout System

### Purpose

Move approved work through scheduling, prep, dispatch, field work, completion, invoicing, payment, closeout, review request, retention, and reactivation without missing steps.

### What exists now

- Schedule page exists at `pages/crm-schedule.html` with month/week/day/dispatch/map-style UI elements and an unscheduled drawer.
- Schedule APIs referenced by `index.js` include schedule slots, blocks, booking, admin bookings, calendar, booking patch, lead schedule, suggest, geocode, optimize, and reschedule.
- Time tracking API exists through `api/time.js` referenced by `index.js`.
- Expenses API exists through `api/expenses.js` referenced by `index.js`.
- Crew portal route exists at `/crew` and serves `pages/crew.html` when a crew session exists.
- Crew APIs include crew members, today jobs, generate invoice, invoice for booking, crew time today, expenses today, crew tasks, and crew events.
- Dashboard calculates job costing style metrics from time, expenses, revenue, invoice, and payment fields.
- Actuals rollup API exists through `api/actuals-rollup.js` referenced by `index.js`.
- Reviews/referral APIs exist through `api/reviews.js` and `api/referral.js` referenced by `index.js`.

### What is missing or not clearly implemented yet

- Not clearly implemented yet: full stage pipeline enforcement for New Lead, Qualified, Quoted, Needs Review, Accepted, Scheduled, Prepped, In Progress, Complete, Invoiced, Paid, Closed, Review Requested, Retention, Retouched, and Reactivated.
- Not clearly implemented yet: visible stage-gate checklist per job requiring completion notes, final photos, actual time, invoice trigger, review request, and closeout fields.
- Not clearly implemented yet: materials prep checklist tied to each scheduled job.
- Not clearly implemented yet: complete callback/warranty/retention system through year 5 retouch.
- Not clearly implemented yet: field scope-change approval flow.

### What should be built later

- Formal job stage engine and UI badges/checklists.
- Prepped state requiring materials, photos, scope notes, crew notes, and missing-info alerts.
- In-progress job control with start/stop time, notes, photos, scope-change flags, and completion requirements.
- Closeout flow requiring final photos, actual time, invoice generation, payment tracking, review request, and retention schedule.
- Retention/reactivation timeline for past customers.

### What should not be built yet

- Complex enterprise dispatch optimization beyond current map/schedule foundation until core lifecycle gates are reliable.
- Full inventory procurement automation before materials prep and job costing are stable.

### UI visibility notes

Job operations should be visible from Schedule, Clients, Crew View, Dashboard, and job/client detail pages. The owner should see what is blocked and why.

### Owner control notes

The owner should be able to see every job that is unscheduled, unprepped, in progress too long, complete but not invoiced, invoiced but unpaid, or closed without review/retention follow-up. Current scheduling, time, expense, crew, invoice, and review pieces exist, but complete stage enforcement is not clearly implemented yet.

## D. HR / Payroll / People System

### Purpose

Control employees, crew access, staff approvals, attendance, shifts, leave, recruiting, expense claims, payroll structures, payroll runs, salary slips, and people-related owner responsibilities.

### What exists now

- Sidebar People section links to Employees, Attendance, Shift Types, Departments, Designations, Leave, Leave Setup, Leave Policies, Job Openings, Applicants, Payroll Runs, Expense Claims, Salary Structures, Pay Components, and Payroll Settings.
- HR people APIs exist through `api/hr-people.js` referenced by `index.js`.
- HR attendance APIs exist through `api/hr-attendance.js` referenced by `index.js`.
- HR leave APIs exist through `api/hr-leave.js` referenced by `index.js`.
- HR recruiting APIs exist through `api/hr-recruiting.js` referenced by `index.js`.
- HR payroll APIs exist through `api/hr-payroll.js` and data layer `lib/hr-payroll.js`.
- HR data layer `lib/hr.js` creates/uses `HR_Departments`, `HR_Designations`, and HR columns on `Staff`.
- Staff sheet management exists in `lib/staff.js` with staff status, permissions, username, role, password hash, and crew session cookie.
- Payroll data layer defines tabs for expense claims, claim items, salary components, salary structures, structure items, salary assignments, payroll settings, payroll runs, run additions, and salary slips.

### What is missing or not clearly implemented yet

- Not clearly implemented yet: full payroll approval process tied to actual weekly owner responsibility.
- Not clearly implemented yet: complete payroll tax/compliance workflow.
- Not clearly implemented yet: complete onboarding/offboarding checklist.
- Not clearly implemented yet: employee performance, training, license tracking, disciplinary records, or compliance document tracking.
- Not clearly implemented yet: complete permissions by role across all admin pages.

### What should be built later

- Owner payroll review dashboard with time corrections, expense claims, bonus eligibility, payroll run readiness, and final approval.
- Employee onboarding/offboarding checklist.
- License/certification/compliance tracking.
- Training and safety acknowledgement tracking.
- Role-based access rules after current modules are stabilized.

### What should not be built yet

- Full HRIS replacement.
- Direct payroll provider integration unless explicitly approved.
- Complex benefits administration.

### UI visibility notes

People systems should surface pending approvals and payroll blockers to the owner dashboard, not only inside subpages.

### Owner control notes

The owner should be able to see pending staff approvals, attendance corrections, leave requests, expense claims, payroll run readiness, and payroll exceptions before money goes out. Current HR/payroll data layers and routes exist, but complete owner payroll/compliance control is not clearly implemented yet.

## E. Fleet / Tools / Inventory / Asset System

### Purpose

Control trucks, drive activity, vehicle maintenance, tools, inventory, materials, job assets, and owner responsibilities tied to fleet readiness.

### What exists now

- Sidebar links to `/crm/fleet` as Live Fleet.
- Traccar integration exists in `api/traccar.js`.
- Traccar polling supports positions, devices, trip reporting, arrival detection, departure detection, customer arrival SMS, and online/offline status.
- Traccar environment variables are documented in code comments: `TRACCAR_URL`, `TRACCAR_TOKEN`, and `TRACCAR_MODE`.
- Schedule/map logic appears to consume positions through `/api/traccar/positions` and trips through `/api/traccar/trips`.
- Material price updater exists through `lib/materialPriceUpdater.js` referenced by `index.js`.
- Expenses tracking can capture gas/material/parts style costs depending on sheet values and UI.

### What is missing or not clearly implemented yet

- Not found in current repo: dedicated `api/inventory.js`, `api/tools.js`, or `api/assets.js` files during the QA pass.
- Not clearly implemented yet: dedicated tools inventory module.
- Not clearly implemented yet: vehicle maintenance schedule, reminders, service history, insurance/registration tracking, or inspection tracking.
- Not clearly implemented yet: truck stock/min-max inventory.
- Not clearly implemented yet: asset assignment to employees or jobs.
- Not clearly implemented yet: loss/damage reporting for tools/assets.

### What should be built later

- Fleet maintenance reminders and service records.
- Vehicle document tracking for insurance, registration, inspection, and claims.
- Tool and asset registry with assigned-to, location, status, purchase date, and replacement cost.
- Truck stock checklist and replenishment queue.
- Material usage tied to job actuals.

### What should not be built yet

- Full warehouse management system.
- Paid fleet APIs beyond current Traccar setup unless explicitly approved.
- Complex barcode/RFID inventory before simple asset registry works.

### UI visibility notes

Fleet/tools/inventory alerts should appear on the owner dashboard when something needs action, not only on a fleet page.

### Owner control notes

The owner should know when a truck, tool, stocked material, or asset needs action before it causes a missed job or margin leak. Current fleet GPS and material price pieces exist, but dedicated maintenance, tools, inventory, and asset control are not clearly implemented yet.

## F. Finance / Compliance / Strategy System

### Purpose

Protect cash, margin, invoicing, payment collection, job costing, compliance, audit history, and strategic business decisions.

### What exists now

- Invoices APIs exist in `api/invoices.js` with invoice list, create, create from lead, send, sync status, detail, update, public invoice, change order, and delete logic.
- Payment API exists through `api/payments.js` referenced by `index.js`.
- Public invoice/payment routes exist through invoice public APIs and `api/invoices-pay.js` referenced by `index.js`.
- Dashboard financials API exists in `api/dashboard.js` and uses an accounting provider.
- Dynamic accounting provider exists in `lib/accounting/index.js`; it uses QuickBooks when connected and a mock provider when not connected.
- QuickBooks OAuth routes and settings APIs exist through `api/qb-oauth-routes.js` and `api/settings.js` referenced by `index.js`.
- Accounting transaction APIs exist through `api/accounting-transactions.js` referenced by `index.js`.
- Audit logging exists through `lib/audit.js` referenced by multiple APIs and `api/audit.js`.
- Job costing metrics are calculated from time, expense, invoice, payment, labor rate, burden, and quote values in dashboard and leads logic.

### What is missing or not clearly implemented yet

- Not clearly implemented yet: full compliance calendar for license, insurance, taxes, renewals, permits, EOR obligations, and document storage.
- Not clearly implemented yet: complete cash forecast and debt-service planning module.
- Not clearly implemented yet: formal monthly financial close checklist.
- Not clearly implemented yet: owner strategy dashboard for capacity, marketing ROI, hiring thresholds, and expansion triggers.
- Not clearly implemented yet: complete QuickBooks sync reliability audit.

### What should be built later

- Financial closeout checklist by job and by month.
- Compliance calendar and document tracker.
- Cash dashboard with receivables, payables/manual obligations, payroll liability, tax reserve, debt service, and runway.
- Marketing ROI and source profitability reporting.
- Strategic trigger dashboard for hiring, truck purchase, service area expansion, and pricing updates.

### What should not be built yet

- Full accounting replacement.
- Tax filing system.
- Complex forecasting engine before base cash/margin data is reliable.

### UI visibility notes

Finance/compliance risks should surface as owner alerts with exact next actions and links to the source record.

### Owner control notes

The owner should be able to see cash, receivables, unpaid invoices, margin risk, payroll liability, compliance deadlines, and strategic triggers before they become emergencies. Current invoice, payment, accounting-provider, dashboard financials, and audit pieces exist, but full compliance and strategy control are not clearly implemented yet.
