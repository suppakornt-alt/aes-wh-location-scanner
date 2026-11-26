# wh-location3d

## Status

This is an active internal warehouse application already used in the workplace.
These documents describe the current system as built. They are not a proposal
for a new version and must not import assumptions from the consignment project.

## What the application does

`wh-location3d` helps warehouse workers find, reconcile, and update product
stock locations. It also contains an office ORD location-allocation page and a
3D view of active warehouse stock.

Current capabilities:

- One Google sign-in at the landing page, followed by team selection.
- Picker Lot lookup by camera scan or numeric manual entry.
- Product-code resolution through `DATA : Stock By Lot`.
- Location list with quantities, Lot editing, pick, add, and relocation actions.
- Partial relocation, full relocation, existing same-SKU destination, different
  level at the same coordinate, and manual new destination.
- Frontline quantity versus ERP quantity reconciliation by SKU.
- Safe empty-location closing and non-empty `CLEANUP_REQUIRED` marking.
- 3D warehouse visualization with category and stock-velocity filters.
- ERP reconciliation/audit view.
- `ออฟฟิศโกดัง` ORD location allocation: administrators choose locations for
  every SKU of an ORD from `DATA : Current ORD`. After a four-hour cancellation
  hold, a timed Apps Script trigger deducts the stock. Blank-location Lots are
  chosen from positive `Remaining` values in `DATA : Stock By Lot`, saved with
  the pending allocation, and assigned only at final deduction. See
  `docs/OFFICE_WAREHOUSE.md`.
- Required multi-worker assignment for each ORD from every valid row in
  `DATA : AES Team`, stored with stable `actor_id` snapshots.
- Lot reconciliation by active `SKU_ID + LOT_NO`, with the latest result in
  State and append-only snapshots in
  `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ`.
- Matching `CLEANUP_REQUIRED` rows appear below active scanner results in red,
  without being counted as active stock.

The original office workflow was deployed on 2026-11-26. The owner later
pushed the controlled Lot and Lot-reconciliation enhancement; its live web-app
deployment and release-test results are not yet recorded. The required AES Team
preparer selector and status-sheet rename are the current local changes.

The planned third area is `ระบบฝากขาย`, a frontline consignment tire registry
used before products are sent to a customer warehouse. Its authentication must
use the same internal sign-in session. It is planned work and is not described
as currently implemented.

## Users

The application is for internal warehouse and office staff. The current user
experience uses one authentication step at the landing page; it does not ask
workers to sign in again before each page or action. Backend requests still
validate the current Google ID token silently.

The current authorization allows the configured company domain and the
configured test exception. Exact account values are intentionally not repeated
in this documentation.

## Repository layout

```text
index.html                 Authentication and team chooser
pages/picker.html          Picker scanner, 3D, operations, and audit views
pages/office.html          Office ORD location-allocation page
js/                        Frontend modules
css/style.css              Shared frontend styling
backend/                   Apps Script source and manifest
archive/                   Local historical snapshots, not deployment source
AGENTS.md                  Active project instructions
docs/                      Project documentation
```

The Apps Script project uses `backend/` as its clasp `rootDir`. The frontend is
published from the GitHub repository. Backend synchronization uses clasp and
Apps Script web-app deployment.

## Local checks

From the repository root:

Windows (PowerShell):

```powershell
Get-ChildItem js,backend -Filter *.js -Recurse | ForEach-Object { node --check $_.FullName }
git diff --check
```

Ubuntu (bash):

```bash
find js backend -name '*.js' -exec node --check {} \;
git diff --check
```

## Synchronization and deployment

The project owner reviews changes before pushing or deploying.

Frontend/Git synchronization:

```powershell
git add .
git commit -m "Describe the change"
git push
```

Backend synchronization:

```powershell
clasp.cmd push
```

On Ubuntu the command is `clasp push`. Ubuntu setup notes:

- Install Node.js with nvm, then `npm install -g @google/clasp`. Do not use
  `sudo apt install clasp`; that package is an unrelated program.
- Run `clasp login` with the account that owns the Apps Script project.
- `.clasp.json` is ignored by Git, so each machine needs its own copy in the
  repository root with the project's `scriptId` and `"rootDir": "backend"`.

When updating the web app, use Deploy → Manage deployments → Edit → New
version. A new deployment would change the web-app URL used by `js/api.js`.

After a backend push, update the Apps Script web-app deployment to a new
version when required. Do not place credentials or deployment URLs in Git or
documentation.

One-time setup for the office ORD workflow (after its first backend push):

1. In the Apps Script editor, run `installOrderDeductionTrigger` once and accept
   the new permission (`script.scriptapp`, needed to create the trigger).
2. Check the Triggers page: `processDueOrderAllocations` runs every 15 minutes.
3. Deploy a new web-app version so the new API actions are live.

The sheets `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว` and `MAIN : Log พิกัดจาก ORD`
are created automatically with their header row on first use. Existing copies
gain the new `message`, `pickers`, and `lot_no` columns automatically. The old
all-caps `MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว` tab is renamed in place when the
new name is absent, preserving its rows. The reconciliation
sheet `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ` is also created when needed.

After deploying the Lot-reconciliation enhancement, run
`rebuildLotReconciliation` once from the Apps Script editor. It initializes
`LOT_CHECK_STATUS` for existing State rows and writes baseline snapshots.

## Known current limitations

- `DATA : Current Stock`, `DATA : Stock By Lot`, and `DATA : Current ORD`
  currently use row 6 as their header row. This is known and will be corrected
  later.
- The office ORD workflow has no undo after stock is deducted; staff restore
  stock with the normal add action.
- An ORD becomes `EXCEPTION` without deduction when a selected location becomes
  inactive or its Lot conflicts during the four-hour hold. Cancel and redo it.
- `CLEANUP_REQUIRED` can later return to `ACTIVE`, but that recovery flow has
  not been defined or implemented yet.
- Fine-grained supervisor permissions for cleanup actions have not yet been
  defined.
- Primary device testing is focused on Android Chrome; broader browser coverage
  remains part of the test plan.

## Documentation map

- `AGENTS.md`: active working rules for AI agents and developers.
- `docs/AGENT_BLUEPRINT.md`: interview and documentation maintenance template.
- `docs/DATA_MODEL.md`: Sheets, headers, relationships, and identifiers.
- `docs/OFFICE_WAREHOUSE.md`: ORD location allocation requirements and behavior.
- `docs/BUSINESS_RULES.md`: validation, lifecycle, quantity, and authorization rules.
- `docs/UI_DESIGN.md`: current screens, labels, devices, and interaction rules.
- `docs/TEST_PLAN.md`: release and regression scenarios.
- `docs/DECISIONS.md`: durable architecture decisions and reasons.
- `docs/NEXT_MIGRATION.md`: explicitly planned future work.
- `docs/project-log/`: daily project summaries created when requested.
