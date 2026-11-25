# Project Instructions

## Project identity

`wh-location3d` is a mobile-first warehouse location and stock-control application.
It has two user-facing areas:

- Picker/frontline: authenticate, scan or enter a Lot number, view SKU locations,
  compare frontline quantity with ERP quantity, pick, add, relocate, record Lot
  numbers, and flag invalid locations for cleanup.
- Warehouse office: authenticate and create picking-order information for the
  warehouse team.

The application also provides a 3D warehouse view for active stock locations.
Thai is the primary worker-facing language. Always communicate with the project
owner in English. Thai is reserved for worker-facing application UI, validation,
and status content unless the project owner explicitly requests otherwise.

## Scope boundary

This file is specific to `wh-location3d`. Do not import business rules, table
names, identifiers, workflows, credentials, or assumptions from another project.
When adapting a template, keep only reusable engineering rules and replace all
project-specific content with facts verified in this repository or supplied by
the project owner.

Never place passwords, private keys, OAuth client secrets, access tokens, Sheet
URLs, deployment URLs, or other credentials in Markdown documentation.

## Repository and deployment structure

```text
wh-location3d/
├─ index.html                 # Authentication-first landing page
├─ pages/                     # Picker and office HTML pages
├─ js/                        # Frontend modules
├─ css/style.css              # Shared styling
├─ backend/                   # Apps Script source and manifest
├─ archive/                   # Local snapshots; never deploy as source
├─ .clasp.json                # Local clasp configuration; ignored by Git
└─ .claspignore               # Apps Script deployment boundary
```

Keep frontend HTML, CSS, and JavaScript separate. Keep Apps Script modules in
`backend/`. The current `.clasp.json` uses `rootDir: backend`; do not change
that boundary unless the complete clasp design is intentionally reviewed.

Backend responsibilities are split as follows:

- `backend/Code.js`: configuration, authentication, HTTP entry points, and routing.
- `backend/warehouse-data.js`: warehouse and reconciliation data reads.
- `backend/warehouse-lookups.js`: Lot and SKU lookups.
- `backend/warehouse-operations.js`: pick, add, relocate, close, and Lot updates.

## Current workflow

1. The user signs in with Google once on `index.html`.
2. The application keeps that authenticated session while the user moves between
   the picker and office areas.
3. Apps Script silently validates the session token and authorization for API
   requests; this is a backend security check, not a new user-facing login step.
4. The user chooses the picker or office team.
5. Picker users scan a seven-digit Lot barcode or enter a numeric Lot manually.
   Camera scanning requires exactly seven digits and five matching detections.
   Manual numeric entry supports exceptional numeric Lot values up to 20 digits.
6. The backend resolves the Lot to a product code using `DATA : Stock By Lot`.
7. The picker sees active locations for that product/Lot and SKU-level
   frontline-versus-ERP quantity reconciliation.
8. The picker can pick, add, relocate partially or fully, record a Lot, or use
   the safe location-close and cleanup workflow.
9. Active stock is available to the 3D view and normal operations list.

## Data model and invariants

The location sheet is `MAIN : ตำแหน่งสินค้าทั้งหมด` with these columns:

```text
LOCATION_ID SKU_ID NAME LOT_NO CATEGORY BRAND QTY COL_NAME_START COL_NAME_END
COL_START COL_END ROW_START ROW_END MIN_LEVEL MAX_LEVEL DISPLAY_LOC
LOCATION_STATUS CLOSED_AT CLOSED_BY CLOSED_REASON LATEST_SALES DIFF_DAYS CRITERIA STATUS
```

`LATEST_SALES`, `DIFF_DAYS`, `CRITERIA`, and `STATUS` are lookup/formula fields.
They remain after the operational location/lifecycle fields. Backend code must
resolve movable fields by header name instead of assuming fixed indexes.

Blank `LOCATION_STATUS` is treated as `ACTIVE` for backward compatibility. New
or reactivated rows should explicitly contain `ACTIVE`.

Valid lifecycle statuses:

- `ACTIVE`: included in normal scanner, operations, reconciliation, and 3D views.
- `INACTIVE_EMPTY`: intentionally closed after quantity reaches zero.
- `CLEANUP_REQUIRED`: questionable location whose quantity is preserved for
  investigation and excluded from the normal active total.

Do not physically delete location rows during normal worker operations. Preserve
the row and audit information. Any purge must be a separately reviewed action.

ERP sources:

- `DATA : Current Stock` is the authoritative ERP quantity source.
- `DATA : Stock By Lot` resolves Lot numbers to product codes and product data.
- Both data sheets use physical row 6 as the header row; data starts at row 7.

Reconciliation is SKU-wide: sum active frontline quantities across all active
locations for the product code and compare them with the ERP total. Cleanup
quantities are reported separately.

Multiple SKUs and Lots may occupy the same physical coordinate. A relocation may
merge only when SKU, Lot, coordinate, and level match exactly; otherwise keep a
separate location row.

## Authentication and authorization

- Google Identity Services is used on the frontend.
- This is an internal web app: require one sign-in at the landing page, then
  maintain a seamless session across the picker, 3D, operations, audit, and
  office views.
- Do not add a separate login screen, repeated sign-in prompt, or customer-style
  authentication confirmation before each page, scan, lookup, or stock action.
- The team chooser is navigation, not a second authentication step.
- Apps Script is the authorization authority; hiding browser UI is not security.
- Every protected backend request must include the current session's ID token.
- The backend must silently verify issuer, audience, expiry, and verified email
  on each request without creating additional user-facing friction.
- Allowed users are the configured company domain plus the explicitly configured
  test exception in `backend/Code.js`.
- Never authorize from a browser-supplied email alone.
- Never log ID tokens or credentials.
- If the token expires or becomes invalid, return the user to the landing page
  and ask them to sign in again. Do not interrupt a valid session unnecessarily.
- Do not introduce step-up authentication for normal internal warehouse actions
  unless the project owner explicitly requests it for a specific high-risk role.

## Coding standards

- Write readable, production-grade code with normal spacing and indentation.
- Prefer small focused functions with one clear responsibility.
- Add a nearby, readable comment for every meaningful code change made for the
  project owner. The comment must explain the intent and impact of the change,
  including changed validation, data mapping, security, state transitions, API
  actions, or UI behavior. Do not add meaningless comments to obvious syntax.
- If a code area is generated, minified, vendor-owned, or cannot safely accept
  an accurate maintainable comment, do not modify it; report the blocker and
  wait for an approved source or approach.
- Preserve existing behavior unless the requested change requires otherwise.
- Avoid unnecessary dependencies.
- Escape user-provided values before inserting them into the DOM.
- Validate all input in both frontend and backend.
- Keep technical identifiers, action names, status codes, and column names in
  English in source code.
- Use Thai first for worker-facing labels, buttons, validation, and status text.
- Keep styling in `css/style.css`; avoid new inline styling or inline handlers
  when an external handler is practical.

## Operational safety rules

- Use `LockService` around quantity-changing Apps Script operations.
- Reject non-positive, non-numeric, and over-quantity pick requests.
- A full move preserves the source as an inactive-empty row.
- A partial move subtracts only the requested quantity.
- Never allow a destination to silently equal the source.
- Existing-location choices must be filtered to the current product code.
- Manual destination entry remains available when no existing destination is valid.
- Camera and manual Lot validation are different: camera is seven digits, manual
  numeric Lots may be longer.
- Cleanup actions preserve nonzero quantities and record user, time, and reason.

## Documentation source of truth

Before changing business logic, data columns, UI behavior, deployment, or tests,
read the relevant project documents when present:

- `README.md`: scope, setup, deployment boundary, and postponed work.
- `docs/DATA_MODEL.md`: sheets, columns, identifiers, and relationships.
- `docs/BUSINESS_RULES.md`: permissions, validations, and state transitions.
- `docs/UI_DESIGN.md`: screens, navigation, device behavior, and language.
- `docs/TEST_PLAN.md`: release scenarios and acceptance criteria.
- `docs/DECISIONS.md`: important architecture decisions and reasons.

Keep those documents synchronized with implementation changes. A daily log is
project history, not a replacement for active instructions.

## Verification

After JavaScript changes, run from the repository root:

```powershell
Get-ChildItem js,backend -Filter *.js -Recurse | ForEach-Object { node --check $_.FullName }
git diff --check
```

Before release, verify authorized and unauthorized login, seven-digit camera
scanning, manual numeric Lot lookup, SKU reconciliation, pick, add, partial and
full moves, existing and manual destinations, cleanup preservation, inactive-row
filtering, and mobile/desktop layouts.

## Change handoff

The project owner reviews code before pushing or deploying. Do not commit, push,
or deploy unless explicitly requested.

After changing any file, always provide two separate synchronization command
blocks in the final response. Always provide the Git block first:

```powershell
git add .
git commit -m "Describe the change"
git push
```

Then always provide the Apps Script block separately, even when the change was
frontend-only:

```powershell
clasp.cmd push
```

Before giving the handoff, inspect the changed-file list and explicitly report:

```text
Frontend files changed: YES or NO
Backend files changed: YES or NO
```

Frontend files include `index.html`, `pages/`, `js/`, and `css/`. Backend files
include files under `backend/`. If no frontend files changed, say that there is
no new frontend change to synchronize to GitHub. If no backend files changed,
say that there is no Apps Script change and that `clasp.cmd push` is not needed,
even though the standard clasp command block must still be shown.

`clasp.cmd push` synchronizes files under `backend/` according to `.clasp.json`
and `.claspignore`. The owner must update the Apps Script web-app deployment to
a new version when required.

## Daily summaries

If the project owner types `SUMMARIZE`, create or update:

```text
docs/project-log/wh-location3d_YYYY_MM_DD.md
```

Include date, completed work, decisions, changed files, verification, blockers,
known risks, and next steps.

## Ground-up implementation order

1. Confirm repository, branch, hosting, Apps Script project, and clasp root.
2. Keep project documents synchronized with the verified data model and rules.
3. Define identifiers, columns, lifecycle statuses, roles, and transitions.
4. Confirm the frontend/backend deployment boundary.
5. Verify authentication and backend authorization before stock transactions.
6. Build and test one end-to-end warehouse workflow at a time.
7. Run the release test plan, update the README, and only then deploy.
