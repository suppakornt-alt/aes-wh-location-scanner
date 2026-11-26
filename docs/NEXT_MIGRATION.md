# Next Migration and Hardening Work

This document contains future work that has not been applied yet. The current
application remains the active workplace system. Do not implement an item only
because it appears here; confirm the desired behavior before changing code or
data.

## Priority 1 — Office warehouse picking allocation

Implement the approved `ออฟฟิศโกดัง` workflow from
`docs/OFFICE_WAREHOUSE.md`.

Implemented and deployed on 2026-11-26 (DEC-016 to DEC-019), with the
15-minute deduction trigger installed. Remaining: run and record the `OFF-*`
release tests.

The owner pushed the follow-up controlled Lot dropdown and reconciliation work
(DEC-020 to DEC-023); live deployment and release evidence remain unrecorded.
The AES Team preparer selector and status-sheet rename (DEC-024/DEC-025) are
implemented and documented. Before the combined work is called complete:
verify the synchronized frontend/backend in the live environment, run
`rebuildLotReconciliation` once when still needed, then execute and record
`REC-009` to `REC-013`,
`LIFE-003`/`LIFE-006`, and `OFF-021` to `OFF-036`.

Later improvements, not in the first version: draft saving, editing a
`PENDING` ORD, undo after `COMPLETED`, free-goods labels, and stock reservation
between `PENDING` ORDs.

## Priority 2 — Documented next module

### Add `ระบบฝากขาย`

Add a third page to the main application for frontline consignment tire
registration before products are sent to a customer warehouse.

Before implementation, define:

- Exact source sheets and header rows.
- Product, Lot, tire, or serial identifiers.
- Whether a barcode scanner or keyboard scanner is used.
- Required quantities and duplicate rules.
- What record represents a completed registration.
- Whether the module writes to the current workbook or another source.
- Whether office staff can review or correct entries.
- Required audit log fields.

It must use the existing one-time internal authentication session unless the
owner explicitly changes the security model.

## Priority 3 — Production hardening

- Add a formal cleanup recovery action from `CLEANUP_REQUIRED` to `ACTIVE` with
  reason, user, timestamp, and permission rules.
- Define whether cleanup, Lot editing, and location assignment require a
  supervisor role.
- Add idempotency keys or a safe retry strategy for every quantity-changing
  request where an uncertain network response could cause a duplicate action.
- Replace fixed-index assumptions in any remaining backend path with header-name
  mappings.
- Move ERP sheet headers from row 6 to a cleaner agreed location, then update
  code and test the migration without changing quantities.
- Add stronger automated tests around quantity locks, merge behavior, and
  lifecycle filtering.

## Priority 4 — Deployment and operations

- Record the exact GitHub Pages/GitHub Actions workflow in the repository.
- Document the production Apps Script deployment/version procedure.
- Add a clear rollback procedure for frontend and backend releases.
- Add a non-production test-data strategy that cannot alter workplace stock.
- Expand browser/device verification beyond Android Chrome when required.

## Explicitly not assumed

The following are ideas, not approved migrations:

- Moving from Google Sheets to a database.
- Offline operation.
- Automatic ERP API integration.
- Location QR/LPN labels.
- Route optimization in the 3D view.
- Mobile push notifications.

Add an item here only after the project owner decides it is a real future
requirement.
