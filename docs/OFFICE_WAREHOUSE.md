# Office Warehouse Picking Allocation Requirements

## Status

This is the approved next implementation scope for the `ออฟฟิศโกดัง` page.
The requirements are documented before code changes. The current office page
and office JavaScript remain unchanged until implementation begins.

## Purpose

Replace the current office test-mode picking form with a workflow where the
warehouse administrator chooses the physical location from which each ORD line
will be picked. The backend then records the allocation and deducts the picked
quantity from the current location data.

The administrator chooses locations. The backend remains responsible for
identity, authorization, quantity validation, concurrency protection, stock
deduction, and auditability.

## Current operational boundary

The first version does not download directly from the ERP. The existing manual
boundary remains:

1. Download the ORD raw file from Magic 2002 ERP.
2. Put the file in the company shared drive.
3. Allow the existing two-hour Apps Script cleaning cycle to process it.
4. Open the `ออฟฟิศโกดัง` page and allocate locations.

The import source, cleaning process, and raw-file storage location must not be
silently redesigned as part of the office-page implementation.

## Logical data model

The following tables describe the required information. Actual sheet names,
header rows, and final header spelling must be confirmed before coding.

### Current location/state data

This is the existing current-state inventory by location. The current project
documentation identifies `MAIN : ตำแหน่งสินค้าทั้งหมด` as the location source.

| Logical field | Current documented field | Purpose |
| --- | --- | --- |
| `location_id` | `LOCATION_ID` | Authoritative location-record identifier. |
| `product_code` | `SKU_ID` | Product associated with the location. |
| `location` | `DISPLAY_LOC` plus coordinate fields | Worker-facing location display. |
| `amount` | `QTY` | Current quantity available at the location. |

This mapping is a working requirement and must be verified against the live
sheet before implementation. `location_id`, not the display text, is the
authoritative reference used for deduction.

### Raw ORD data

The cleaned ORD output must provide at least:

| Field | Purpose |
| --- | --- |
| `ord_id` | ORD document identifier. |
| `product_code` | SKU required by the ORD. |
| `amount` | Quantity that must be allocated for the ORD line. |

The office list is expected to display the ORD date, ORD number, product code,
product name, amount, and current allocation status when those values are
available from the cleaned source.

Each raw line must have a stable line identity. `ord_id + product_code` must not
be assumed to be unique if the ERP can export the same product more than once
in one ORD. A source line number or another stable `ord_line_id` is required
before duplicate handling is implemented.

### ORD location allocation data

The allocation table records the administrator's physical picking decision.
There is one row for each location used.

| Field | Purpose |
| --- | --- |
| `allocation_id` | Unique allocation record or commit reference. |
| `ord_line_id` | Stable reference to the raw ORD line. |
| `ord_id` | ORD document identifier for reporting. |
| `product_code` | SKU being picked. |
| `location_id` | Authoritative source location. |
| `location` | Display snapshot of the selected location. |
| `pull_off_amount` | Quantity picked from this location. |
| `created_at` | Allocation creation time. |
| `created_by` | Authenticated user who confirmed the allocation. |
| `status` | Allocation lifecycle value, if the implementation needs one. |

Example: if 10 units of one SKU are picked as 6 units from location A and 4
units from location B, the table contains two allocation rows. The UI may show
one SKU card with two location entries, but the saved data must preserve the
separate location quantities.

Every committed allocation must also leave an audit event. The implementation
may use the existing `MAIN : Log ข้อมูลตำแหน่ง` sheet, a dedicated stock-movement
table, or both, but the chosen design must preserve the ORD and allocation
reference for later investigation.

## Office workflow

### Pending ORD list

The page shows pending work in a mobile-friendly table or card list with:

- ORD date, when available
- ORD number
- product code
- product name
- required amount
- allocation status
- an action button such as `เบิกรายการ`

Only records that are still eligible for allocation should offer the picking
action. Completed records must not be silently processed again. When the
administrator opens an ORD, the allocation screen must make it clear whether
the action covers the full ORD or one individual line. The intended workflow
is to open the full ORD, complete every SKU line, and confirm once.

### Location allocation screen

For each ORD line, the administrator sees:

- required amount
- total amount currently allocated in the form
- remaining amount
- one or more location rows
- a location selector
- available quantity at the selected location
- quantity to pick from that location
- a `+` action to add another location when one SKU is split across locations

Location choices must be loaded from current state data and filtered to the
selected product code. The UI must not accept arbitrary free-text locations in
place of a valid `location_id`.

The UI must prevent duplicate location rows for the same SKU or combine them
before submission. The server must still validate the final payload.

### Confirmation

The stock-changing action requires an explicit final confirmation, such as
`ยืนยันการเบิก`. A draft feature may be added later, but saving a draft must
not deduct stock.

On successful confirmation, the page shows the committed result and refreshes
the remaining work list. On failure, it shows the reason and leaves current
state and allocation data unchanged.

## Backend rules

Before committing one ORD allocation, covering all required SKU lines in the
submitted ORD:

1. Re-read the current state rows on the server.
2. Verify the authenticated user and authorization.
3. Verify that every selected `location_id` exists and belongs to the selected
   product code.
4. Verify that every selected quantity is numeric and greater than zero.
5. Verify that no selected quantity exceeds the latest available location
   quantity.
6. Verify that the sum of allocations equals the required ORD amount before
   marking the line complete.
7. Acquire `LockService` before the final read-check-write operation.
8. Write the allocation and audit records, then deduct the current quantities.
9. Mark the ORD line completed only after the stock-changing operation succeeds.

The operation must be all-or-nothing for the submitted ORD commit. If any SKU
or location fails validation, the backend must not partially deduct the ORD.

The request must be safe against double-clicks and uncertain network retries.
Use a stable commit or idempotency reference so repeating the same confirmed
request cannot deduct the same stock twice.

## Quantity and status behavior

- A positive exact allocation completes the ORD line.
- An under-allocation remains incomplete and must be visible to the admin.
- An over-allocation is rejected.
- Insufficient current stock is rejected unless a future approved partial-pick
  rule explicitly allows it.
- A completed ORD line cannot be submitted again as a new deduction.
- Corrections must use a controlled reversal or adjustment that preserves the
  original allocation and audit history; do not silently overwrite history.
- The office allocation status is separate from location lifecycle statuses
  such as `ACTIVE` and `INACTIVE_EMPTY`.

Initial status names may be `PENDING`, `DRAFT`, `COMPLETED`, and `EXCEPTION`,
but the final set must be confirmed before implementation.

## Authentication and language

- Reuse the existing one-time Google authentication session.
- Do not add a second login screen to the office page.
- Apps Script must silently revalidate the ID token for every protected request.
- Source identifiers and action names remain English.
- Worker-facing labels, validation, and status messages are Thai-first.

## Non-goals for this implementation

- Direct ERP API integration.
- Replacing the two-hour raw-data cleaning process.
- Changes to picker, 3D, reconciliation, or relocation behavior.
- Automatic location selection or route optimization.
- A new authentication or supervisor system before those rules are approved.

## Decisions required before coding

- Confirm the actual State sheet and map its live headers to the logical fields.
- Confirm the raw ORD sheet name, header row, and stable line identifier.
- Confirm the allocation-table destination and exact headers.
- Confirm whether insufficient stock blocks the ORD or permits an explicit
  partial allocation.
- Confirm whether the first version needs draft saving or only final confirmation.
- Confirm who may reverse or correct a completed allocation.
- Confirm the final office allocation status values.
