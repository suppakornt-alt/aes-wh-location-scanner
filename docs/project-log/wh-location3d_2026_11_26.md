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

- Admin chooses **locations** (`LOCATION_ID`), not Lots.
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
MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว   timestamp | ord_id | status | user
    one row per ord_id, overwritten on status change (no history)
MAIN : Log พิกัดจาก ORD            timestamp | ord_id | product_code | product_name | location_id | location | amount
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
