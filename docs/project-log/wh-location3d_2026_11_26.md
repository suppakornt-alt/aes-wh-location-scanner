# wh-location3d — 2026-11-26

## Summary

Defined, built, and deployed the `ออฟฟิศโกดัง` ORD location-allocation workflow.
It replaces the old office test-mode Lot form. Admins choose source locations
for every SKU of an ORD; stock is deducted automatically after a four-hour
cancellation hold.

## Completed work

1. Read `AGENTS.md` and all `docs/` files; listed doc inconsistencies.
2. Documented `DATA : Current ORD` (header row 6, 12 columns) in the data model.
3. Agreed all office workflow requirements with the owner (see Decisions).
4. Agreed the columns of the two new sheets.
5. Implemented the backend, the office page, and styles.
6. Synchronized all project docs with the implementation.
7. Set up clasp on Ubuntu (nvm, Node.js v26.13.1, clasp 3.4.1, `.clasp.json`).
8. Owner pushed the backend, installed the trigger, deployed a new web-app
   version, and pushed the frontend.

## Decisions

Recorded as DEC-016 to DEC-019 in `docs/DECISIONS.md`.

- The original version let the admin choose **locations** (`LOCATION_ID`); the
  follow-up below adds a controlled Lot choice only for blank State rows.
- Duplicate product lines in one ORD (paid + free) are **merged** into one SKU
  requirement by summing `quantity`. No free-goods label.
- The **whole ORD** is submitted at once; every SKU must be allocated exactly.
- A chosen amount cannot exceed the location's current `QTY`. The admin fixes
  the data first from the office page (`เติม` / `เพิ่มพิกัดใหม่`, same form as
  the picker).
- No stock reservation between PENDING ORDs (ERP is the stock authority).
- Submit saves the ORD as `PENDING` **without** cutting stock. A trigger every
  15 minutes cuts stock after **4 hours** and sets `COMPLETED`.
- Anyone signed in can cancel a PENDING ORD (`CANCELED`); no editing, cancel
  and redo. No undo after `COMPLETED`; restore with the normal add action.
- Shortfall at cut time: deduct to 0, set `INACTIVE_EMPTY`, log the shortfall.
- Stock cuts are logged in `MAIN : Log ข้อมูลตำแหน่ง` as
  `เบิกตาม ORD (ORD_PICK)`, user = submitter, reference = ORD + `AUTO`.
- No new roles.

New sheets (header on row 1):

```text
MAIN : Log ORD ที่ยืนยันพิกัดแล้ว   timestamp | ord_id | status | user | message | pickers
    one row per ord_id, overwritten on status change (no history)
MAIN : Log พิกัดจาก ORD            timestamp | ord_id | product_code | product_name | location_id | location | amount | lot_no
    one row per chosen location, append only
```

## Changed files

Frontend:

- `pages/office.html`: rewritten (ORD list, allocation screen, PENDING list,
  add-location modal).
- `js/office.js`: rewritten.
- `css/style.css`: old office form styles removed; new `of-*` styles added.

Backend:

- `backend/office-allocation.js`: new (load, location choices, submit, cancel,
  `processDueOrderAllocations`, `installOrderDeductionTrigger`).
- `backend/Code.js`: ORD config and 4 new API actions.
- `backend/warehouse-operations.js`: `add` reads columns by header name.
- `backend/appsscript.json`: added `script.scriptapp` scope for the trigger.

Docs:

- `README.md`, `AGENTS.md`, and in `docs/`: `OFFICE_WAREHOUSE.md`,
  `DATA_MODEL.md`, `BUSINESS_RULES.md`, `UI_DESIGN.md`, `TEST_PLAN.md`,
  `DECISIONS.md`, `NEXT_MIGRATION.md`.

Local only (ignored by Git): `.clasp.json`.

## Verification

- VS Code diagnostics showed no errors in the changed JavaScript files.
- Claude could not run `node --check` or `git diff --check` (no shell access);
  the owner was given the commands.
- The owner reported a successful backend push, trigger install, deployment,
  and frontend push.
- `OFF-*` release tests have **not** been recorded yet (all `NOT_RUN`).

## Blockers

None.

## Known risks

- The trigger marks an ORD `COMPLETED` before cutting stock. If a write fails
  midway, stock is under-deducted (visible as missing log rows) rather than
  deducted twice. The owner has not yet confirmed this choice.
- Status and allocation rows are linked by the submit timestamp (to the
  second). Manually editing either `timestamp` column breaks the link and the
  ORD will not be deducted.
- `pick` and `relocate` still read some columns by fixed index.
- No stock reservation: two PENDING ORDs can choose the same stock; the second
  cut then logs a shortfall.

## Next steps

1. Run the `OFF-001` to `OFF-020` tests and record PASS/FAIL in
   `docs/TEST_PLAN.md`. Start with OFF-001 (list loads) and OFF-010 (submit
   creates PENDING and does not cut stock).
2. After 4 hours, confirm the first automatic cut: QTY changes,
   `ORD_PICK` rows in `MAIN : Log ข้อมูลตำแหน่ง`, status `COMPLETED`.
3. Confirm the COMPLETED-before-cut order of the trigger.
4. Later: move `pick` and `relocate` to header-name column access.

## Follow-up: controlled Lot assignment and reconciliation

### Status

Implemented locally on 2026-11-26 and later pushed by the owner. Live web-app
deployment, reconciliation initialization, and release-test evidence remain
unconfirmed.

### Completed locally

- Added the State `LOT_CHECK_STATUS` contract after `CLOSED_REASON` without
  changing the owner-managed `STATUS` formula column.
- Added `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ` with append-only
  SKU/Lot reconciliation snapshots based on active State quantity versus
  Stock By Lot `Remaining`.
- Added a controlled office Lot dropdown for blank State rows. Existing Lots
  are read-only; arbitrary Lot text is rejected.
- Saved `lot_no` with each pending allocation. Finalization assigns that Lot to
  the whole still-blank row, then deducts only the ORD amount.
- Added `EXCEPTION` when a pending location is inactive or has a conflicting
  Lot, preventing partial ORD deduction.
- Kept office `เติม` immediate and independent from the four-hour hold.
- Displayed exact-Lot `CLEANUP_REQUIRED` rows below active picker rows in red
  and read-only.
- Made empty-location close reason optional while retaining the required reason
  for non-empty cleanup.
- Added one-time bulk initializer `rebuildLotReconciliation` and updated active
  project documents and release scenarios.

### Files changed in the follow-up

- Frontend: `pages/picker.html`, `js/app.js`, `js/office.js`, `css/style.css`.
- Backend: `backend/Code.js`, `backend/office-allocation.js`,
  `backend/warehouse-data.js`, `backend/warehouse-lookups.js`, and
  `backend/warehouse-operations.js`.
- Documentation: `README.md`, `AGENTS.md`, `docs/DATA_MODEL.md`,
  `docs/BUSINESS_RULES.md`, `docs/OFFICE_WAREHOUSE.md`, `docs/UI_DESIGN.md`,
  `docs/TEST_PLAN.md`, `docs/DECISIONS.md`, `docs/NEXT_MIGRATION.md`, and this
  log.

### Verification and next steps

- Local JavaScript syntax and `git diff --check` must be rerun after the final
  documentation pass.
- The owner must review before any commit, push, clasp synchronization, or
  deployment.
- After backend deployment, run `rebuildLotReconciliation` once and verify the
  live State/log outputs with approved test data.
- Run the new `REC-*`, `LIFE-*`, and `OFF-*` cases recorded in the test plan.

## Follow-up: required ORD preparers and status-sheet rename

Implemented locally after the owner pushed the preceding Lot work:

- Added a required top-right multi-worker selector to the opened ORD.
- Loaded every valid row from `DATA : AES Team` and displayed
  `full_name (nickname)` while submitting stable `actor_id` values.
- Added backend validation against the live team sheet and saved canonical
  worker snapshots in the new last status column, `pickers`.
- Changed the canonical sheet name to
  `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว` and added safe in-place migration from
  the legacy all-caps name.
- Added pending-card worker visibility, responsive styling, architecture
  decisions DEC-024/DEC-025, and tests OFF-029 to OFF-036.

This follow-up still requires local verification, owner review, Git/clasp
synchronization, web-app deployment, and live release testing.

## End-of-day closeout

### Current progress

The project now has the complete documented plan for the `ออฟฟิศโกดัง` page:

1. ORD source data comes from `DATA : Current ORD` after the existing ERP and
   cleaning-cycle process.
2. Admins choose active locations and quantities for every SKU in the ORD.
3. Blank State Lots are selected from positive `Remaining` Lots in
   `DATA : Stock By Lot`; existing Lots remain read-only.
4. Lot assignment waits until the four-hour ORD finalization, then applies to
   the whole still-blank State row under Option A.
5. Lot conflicts or inactive locations produce `EXCEPTION` with no deduction.
6. `เติม` remains an immediate quantity increase.
7. Exact-Lot cleanup rows appear below active picker results in red and remain
   read-only.
8. Active State Lots reconcile against Stock By Lot `Remaining`, with the
   latest result in `LOT_CHECK_STATUS` and append-only history in
   `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ`.
9. The opened ORD requires one or more workers from every valid row in
   `DATA : AES Team`; the status row stores canonical picker snapshots in
   `pickers`.
10. The canonical status sheet is
    `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว`; the backend preserves the legacy
    all-caps sheet by renaming it in place when necessary.

### Handoff state

- The owner has already pushed the preceding Lot/reconciliation work.
- The worker-selector and status-sheet-name work is documented in the current
  project state.
- The working tree was clean at closeout.
- JavaScript syntax checks and `git diff --check` passed during implementation.
- Live workbook migration, Apps Script deployment verification, and release
  scenarios remain unrecorded.
- No further work is required today.

### Next session start point

Read `AGENTS.md`, then review `docs/OFFICE_WAREHOUSE.md`,
`docs/DATA_MODEL.md`, `docs/DECISIONS.md`, and the `OFF-029` to `OFF-036`
tests before changing code. Verify the live status-sheet rename and `pickers`
column first, then run the approved release tests.
