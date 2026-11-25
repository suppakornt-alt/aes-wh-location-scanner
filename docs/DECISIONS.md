# Architecture Decisions

This file records decisions that future AI sessions should preserve unless the
project owner explicitly changes them.

## DEC-001 — One internal authentication session

**Decision:** Users sign in once at the root landing page. Picker, 3D,
operations, audit, office, and the future consignment page reuse the session.

**Reason:** This is an internal warehouse tool. Repeated customer-style login
or confirmation would slow frontline work.

**Security boundary:** Apps Script still verifies the ID token and authorization
on each API request silently. A valid session must not become a reason to trust
browser-supplied identity or quantity.

## DEC-002 — Google Sheets remains the current system of record

**Decision:** Keep the existing Google Sheets workbook and Apps Script backend
for the active workplace application.

**Reason:** The application is already operating with this data source. A
database migration is future work, not an automatic redesign.

## DEC-003 — Backend source lives under `backend/`

**Decision:** Apps Script source and manifest remain under `backend/`, with
`.clasp.json` using `rootDir: backend`.

**Reason:** It creates a clear frontend/backend deployment boundary and avoids
mixing browser code into the Apps Script project.

## DEC-004 — Location rows are preserved instead of deleted

**Decision:** Normal pick, full move, empty close, and cleanup operations retain
the main location row and use lifecycle fields.

**Reason:** Warehouse cleanup requires history and must not erase evidence of
what workers previously recorded.

## DEC-005 — Blank location status is legacy-active

**Decision:** A blank `LOCATION_STATUS` is interpreted as `ACTIVE`; new rows
should write `ACTIVE` explicitly.

**Reason:** Existing rows predate the lifecycle columns and must continue to
work without a risky bulk rewrite.

## DEC-006 — SKU-wide reconciliation

**Decision:** Compare the sum of active main-location quantities for a SKU with
the ERP sum in `DATA : Current Stock`. Report cleanup quantity separately.

**Reason:** ERP is authoritative for total stock, while frontline location
records describe physical placement and may be incomplete during cleanup.

## DEC-007 — Multiple product/Lot rows may share a coordinate

**Decision:** Do not treat a physical coordinate as globally unique. Merge only
when SKU, Lot, coordinate range, and level range all match exactly.

**Reason:** The current warehouse data contains overlapping records during
cleanup and a coordinate can contain more than one product or Lot.

## DEC-008 — Camera and manual Lot validation differ

**Decision:** Camera labels remain exactly seven digits and require five matching
detections. Manual numeric entry supports up to 20 digits.

**Reason:** The normal barcode format is seven digits, while the workplace has
an exceptional longer numeric Lot that workers may need to enter manually.

## DEC-009 — Light theme is the default

**Decision:** The application starts in the light theme; users may switch theme
where the page provides the control.

**Reason:** The warehouse workflow and current 3D presentation were adjusted for
light-first readability.

## DEC-010 — Frontend and backend are synchronized separately

**Decision:** Frontend changes go through Git/GitHub hosting. Apps Script changes
are synchronized with clasp and then deployed as a web-app version.

**Reason:** Camera access belongs to the frontend hosting environment, while
Sheets access and token verification belong to Apps Script.

## DEC-011 — Consignment registry is a future third page

**Decision:** Add `ระบบฝากขาย` to the main application later, using the same
internal authentication session. Do not mix its business rules into the current
warehouse-location rules until its data model is defined.

**Reason:** It is the next module, but its exact workflow and columns have not
yet been supplied for this project.

## DEC-012 — Keep known limitations explicit

**Decision:** Document row-6 ERP headers, office test-mode save behavior,
cleanup recovery, and role granularity as known gaps instead of pretending they
are complete.

**Reason:** Accurate documentation is more useful to future AI sessions than a
clean-looking document that hides unfinished behavior.

## DEC-013 — Make `ออฟฟิศโกดัง` the next implementation area

**Decision:** The next implementation will replace the current office
test-mode picking form with the ORD location-allocation workflow documented in
`docs/OFFICE_WAREHOUSE.md`.

**Reason:** Warehouse administrators need to choose the physical source
locations for ORD lines, while the backend should perform the controlled stock
deduction and audit update.

**Boundary:** The current ERP export, shared-drive handoff, and two-hour
cleaning cycle remain unchanged for the first version. Picker and 3D workflows
are out of scope.

## DEC-014 — Store one allocation row per selected location

**Decision:** If one SKU is picked from multiple locations, preserve one saved
allocation row per location with its own quantity. The authoritative reference
is `location_id`; display location text is a snapshot for people.

**Reason:** This keeps split picks traceable and allows the backend to validate
and deduct each physical source independently.

## DEC-015 — Preserve the shared authentication boundary while rebuilding office UI

**Decision:** The office page and office JavaScript may be substantially
replaced for the new workflow, but the existing one-time Google session and
backend token-validation contract remain required.

**Reason:** The current office form is test-mode work, but authentication and
authorization are shared application infrastructure and must not be weakened
by a page rewrite.

## DEC-016 — Office allocation is location-based, full-ORD, with merged duplicates

**Decision:** The admin chooses locations (`LOCATION_ID`), not Lots. One ORD
is submitted as a whole. Rows with the same `ord_id + product_code` are merged
into one requirement by summing `quantity`.

**Reason:** A location row already fixes SKU, Lot, and coordinate. Merging
duplicate product lines (paid and free) keeps the screen simple and removes the
need for a line identifier, which `DATA : Current ORD` does not have.

## DEC-017 — Four-hour hold before automatic stock deduction

**Decision:** Submit saves the ORD as `PENDING` without deducting stock. A
time-driven trigger every 15 minutes deducts ORDs that have been `PENDING` for
four hours and marks them `COMPLETED`. During the hold, any authorized user may
cancel (`CANCELED`). After `COMPLETED` there is no undo on the office page.

**Reason:** Customers sometimes cancel after the delivery leaves. A hold avoids
putting stock back by hand in most cases. Rare later cancellations are handled
with the normal add action.

## DEC-018 — Location data must match reality before allocation

**Decision:** A chosen quantity may not exceed the location's current `QTY`.
The admin fixes missing or understated locations from the office page using the
existing `assign` and `add` actions. At deduction time, a location holding less
than allocated is deducted to 0 and the shortfall is logged. No stock is
reserved between `PENDING` ORDs.

**Reason:** ERP is the stock authority. The location app helps new workers find
products, so keeping its data correct matters more than blocking ORDs.

## DEC-019 — ORD status lives in a separate sheet

**Decision:** `DATA : Current ORD` is read-only to the app. ORD status is kept in
`MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว` as one row per `ord_id`, overwritten on
status change (no status history). Chosen locations are appended to
`MAIN : Log พิกัดจาก ORD` and never edited. Stock deductions are also audited
in `MAIN : Log ข้อมูลตำแหน่ง`.

**Reason:** `DATA : Current ORD` comes from an import range and is overwritten
daily. A repeated submit for a `PENDING` or `COMPLETED` ORD is rejected, which
gives retry safety without an extra ID.
