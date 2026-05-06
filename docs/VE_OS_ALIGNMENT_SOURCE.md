# VE OS Alignment Source

Last updated: 2026-05-06

## What VE OS is

VE OS is the CRM and operating system for Vickery Electric, a launch-stage residential electrical service business.

VE OS is not meant to be a generic CRM. It is meant to be the operating command center for the owner so leads, quotes, jobs, invoices, payroll issues, fleet issues, compliance issues, customer follow-ups, and owner responsibilities do not get forgotten.

The system should reduce chaos, protect profit, enforce process, preserve records, and make the business easier to scale.

## Business doctrine

VE OS should support a business that is:

- Predictable
- Profitable
- Replicable
- Low-chaos

## The six operating systems VE OS must control

A. Admin / Owner Command System  
B. Sales / Estimator / Website Intake System  
C. Job Operations / Scheduling / Closeout System  
D. HR / Payroll / People System  
E. Fleet / Tools / Inventory / Asset System  
F. Finance / Compliance / Strategy System

## Primary landing page rule

The admin/owner dashboard is the primary CRM landing page.

Current repo evidence points to `/crm/dashboard` as the primary admin dashboard route. The sidebar home link points to `/crm/dashboard`, and the dashboard UI is implemented in `pages/crm-dashboard.html` with supporting dashboard API logic in `api/dashboard.js`.

Future work should strengthen `/crm/dashboard` as the owner command center instead of scattering critical owner responsibilities across disconnected pages.

## What the CRM should do

VE OS should help the owner:

- See what needs attention today.
- Capture and respond to leads.
- Preserve quote snapshots and pricing assumptions.
- Move jobs through a clear lifecycle.
- Schedule jobs, visits, tasks, and crew work.
- Track time, expenses, job costing, and closeout requirements.
- Create and track invoices and payments.
- Monitor accounts receivable, cash, and margin risks.
- Track staff, attendance, leave, recruiting, payroll runs, and expense claims.
- Track fleet location, drive activity, vehicle issues, tools, inventory, and assets.
- Preserve audit history and operational records.
- Surface owner responsibilities instead of relying on memory.

## What the CRM should not overbuild yet

VE OS should not become a bloated enterprise ERP before the launch-stage business needs it.

Do not overbuild:

- Full enterprise HR suites.
- Full accounting replacement for QuickBooks or another accounting system.
- Complex external integrations unless already approved.
- Hidden backend-only systems that the owner cannot verify.
- Complicated abstractions that make simple business tasks harder.
- Large rewrites that risk breaking current working pages.

## Owner/non-coder constraint

The owner is not a coder.

Future tasks should produce practical, visible, working changes with clear manual testing steps. When a task affects the UI, the result should be verifiable in the browser.

## Source material rule

Future prompts should read and preserve these docs before changing code:

- `docs/VE_OS_ALIGNMENT_SOURCE.md`
- `docs/VE_OS_SCOPE_MAP.md`
- `docs/VE_OS_CURRENT_AUDIT.md`
- `docs/VE_OS_BUILD_RULES.md`

Do not delete, ignore, or contradict these documents unless a task explicitly updates the source of truth.

## Build discipline rule

Future build tasks must:

- Stay small enough to review.
- Include acceptance criteria.
- Report exact files changed.
- Report any storage/schema changes.
- Report any environment variable changes.
- Preserve Render deployability.
- Avoid unrelated rewrites.
- Avoid silent feature deletion.
