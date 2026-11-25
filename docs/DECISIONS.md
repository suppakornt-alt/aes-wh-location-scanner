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
