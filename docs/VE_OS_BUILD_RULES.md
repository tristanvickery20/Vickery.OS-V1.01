# VE OS Build Rules

Last updated: 2026-05-06

These rules apply to future VE OS build prompts.

## Source material preservation

Before changing code, read and preserve:

- `docs/VE_OS_ALIGNMENT_SOURCE.md`
- `docs/VE_OS_SCOPE_MAP.md`
- `docs/VE_OS_CURRENT_AUDIT.md`
- `docs/VE_OS_BUILD_RULES.md`

Do not delete these docs. Do not contradict them silently. If a task intentionally changes direction, update the relevant doc in the same task and explain why.

## Do-not-break rules

Do not break:

- Render deployment.
- `index.js` route registration.
- Existing public website pages.
- Existing CRM pages.
- Existing crew portal pages.
- Existing API response shapes unless the task explicitly requires it.
- Google Sheets tab/header assumptions unless the task explicitly includes a schema migration.
- Existing auth cookie names or payloads unless the task is specifically an auth migration.
- Existing quote snapshot behavior.
- Existing invoice/payment behavior.
- Existing staff/crew login behavior.

## File/change discipline

- Keep changes small enough to review.
- Prefer targeted edits over large rewrites.
- Do not reorganize folders unless the task explicitly requires it.
- Do not rename routes, pages, APIs, sheet tabs, or fields without explicit acceptance criteria.
- Do not silently remove working features.
- Do not replace simple durable code with clever abstractions.
- Avoid adding new dependencies unless the task explicitly requires them.
- Avoid paid services or external APIs unless explicitly approved.

## Render deployment caution

- Preserve the app's ability to run as a Node HTTP server.
- Check `package.json` scripts before running commands.
- If no build script exists, do not invent one just to claim success.
- If adding a start script later, confirm it matches the real entrypoint.
- Do not add environment variable requirements without reporting them.
- Do not commit secrets.

## UI verification rule

The owner is not a coder. UI-facing tasks must produce visible browser-verifiable changes.

For UI tasks, report:

- Page/route to open.
- What should be visible.
- What button/form/list/card should be tested.
- What success/failure state should look like.

Backend-only changes are allowed only when the task is explicitly backend-only, and they still need clear API/manual testing steps.

## Acceptance criteria rule

Every future task must include acceptance criteria before code changes are made.

Every completed task must report:

1. Plain-English summary.
2. Exact files created.
3. Exact files modified.
4. Database/schema/storage changes.
5. Environment variables needed.
6. Known limitations.
7. Manual browser testing steps.
8. Build/check command used and result.
9. Confirmation that unrelated features were not rewritten.
10. Recommended next step.

## Scope-control rule

Each task should improve one clear part of VE OS.

Do not mix unrelated systems in the same pass unless the task is specifically an audit/documentation pass.

Examples:

- Good: Add dashboard card showing overdue closeout jobs.
- Good: Add missing manual-review reason to quote snapshot display.
- Bad: Redesign dashboard, rewrite scheduling, change invoice schema, and add fleet inventory in one prompt.

## Six-system alignment rule

Future work should identify which operating system is being changed:

A. Admin / Owner Command System  
B. Sales / Estimator / Website Intake System  
C. Job Operations / Scheduling / Closeout System  
D. HR / Payroll / People System  
E. Fleet / Tools / Inventory / Asset System  
F. Finance / Compliance / Strategy System

If a task touches more than one system, explain the boundary clearly.

## Storage/schema rule

Because the app uses Google Sheets as the main data layer:

- Do not assume a tab exists unless code ensures it or the task verifies it.
- Do not add new sheet columns without documenting the exact tab and headers.
- Do not change existing column meaning without a migration plan.
- If a task adds or changes tabs/headers, update docs or a schema note.
- Report whether the change is backward-compatible with existing sheet data.

## API discipline

- Preserve existing response shapes unless the task explicitly says to change them.
- Prefer adding fields to JSON over renaming/removing fields.
- Return clear errors.
- Do not expose secrets in responses or logs.
- Keep auth requirements clear and intentional.

## Auth/security rules

- `SESSION_SECRET` must not be exposed.
- `GOOGLE_SERVICE_ACCOUNT_JSON` must not be exposed.
- Uploaded resumes and other PII must remain protected.
- Crew routes and CRM routes should be audited before loosening access.
- Public endpoints must be intentionally public and documented by behavior.

## Documentation rule

Docs should be truthful.

If a feature is not found, write:

- `Not found in current repo`

If a feature may exist but was not fully verified, write:

- `Not clearly implemented yet`

Do not write fake completion language.

## Preferred future prompt preface

Future prompts should begin with the VE OS alignment source and then specify:

- Current task.
- Exact files to inspect first.
- Hard restrictions.
- Acceptance criteria.
- Output requirements.

## Manual testing expectation

When a task changes the browser UI, include steps like:

1. Start the app using the repo's real run command.
2. Log in if required.
3. Open the exact route.
4. Verify exact UI element(s).
5. Click or submit the relevant action.
6. Confirm success/error state.

## Build/check expectation

Use the safest available command from `package.json`.

Current audit note as of 2026-05-06:

- `package.json` only defines a placeholder `npm test` that exits with an error.
- There is no real build/check script yet.

A later task should add a safe syntax/start check script if appropriate.
