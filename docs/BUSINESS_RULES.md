# Business Rules

These are the current rules for the active warehouse-location application.
The backend is authoritative. The browser collects input and provides feedback,
but it must not be trusted to decide identity, quantity, or authorization.

## Authentication and authorization

1. The user signs in once with Google on the root landing page.
2. The authenticated session is reused while navigating between picker, 3D,
   operations, audit, and office pages.
3. Apps Script silently validates the current ID token for every protected API
   request. This is a backend security check, not a repeated login step.
4. The backend verifies token issuer, audience, expiry, and verified email.
5. The configured company domain and configured test exception are allowed.
6. The browser must never authorize an account from a supplied email alone.
7. An expired or invalid token returns the user to the landing page.
8. No customer-style step-up authentication is required for normal internal
   warehouse actions.

Fine-grained supervisor permissions for cleanup actions are not yet defined.
Until that changes, do not document a supervisor-only restriction as if it were
implemented.

## Lot lookup

1. Camera scanning accepts exactly seven numeric digits.
2. The reusable scanner requires five matching detections before confirmation.
3. Manual Lot entry uses a numeric keypad and accepts numeric values up to 20
   digits for exceptional Lots.
4. The backend resolves Lot to product code through `DATA : Stock By Lot`.
5. A successful lookup returns product metadata, active location rows, and SKU
   reconciliation data.
6. Unknown Lots or product codes must return a clear failure/empty state and
   must not create a location record.

## Quantity operations

### Pick

- Quantity must be a positive number.
- Picking more than the current quantity is rejected.
- The backend uses a script lock around the read-check-write operation.
- If quantity reaches zero, the row remains and becomes `INACTIVE_EMPTY`.

### Add

- Quantity must be positive.
- The backend uses a script lock around the quantity update.
- The location must be an active usable row.
- Adding to a closed lifecycle row is not silently allowed; the future recovery
  rule must be defined explicitly.

### Relocate

- Both partial and full relocation are supported.
- A partial move subtracts only the requested quantity from the source.
- A full move preserves the source row with zero quantity and
  `INACTIVE_EMPTY` status.
- The destination cannot equal the source location and level.
- Existing destinations are filtered to the current product code.
- Existing destinations may have a different Lot of the same product code.
- An exact SKU + Lot + coordinate + level match may merge quantities.
- A non-exact match creates or preserves a separate row.
- Same-coordinate/different-level and manual new-coordinate modes remain
  available when the worker cannot use an existing destination.
- Relocation uses a script lock.

## Location lifecycle

Valid lifecycle states:

```text
blank or ACTIVE -> ACTIVE
ACTIVE -> INACTIVE_EMPTY       when quantity reaches zero
ACTIVE -> CLEANUP_REQUIRED     when a non-empty location is invalid/questionable
```

- Blank `LOCATION_STATUS` is treated as `ACTIVE` for legacy rows.
- New rows should explicitly store `ACTIVE`.
- `INACTIVE_EMPTY` and `CLEANUP_REQUIRED` are excluded from normal operations,
  scanner location lists, and 3D rendering.
- Cleanup rows preserve their quantity, timestamp, user, and reason.
- The empty-location close reason is optional. A non-empty cleanup action still
  requires a reason because its quantity is being preserved for investigation.
- When a scanned or manually entered Lot exactly matches a cleanup row's
  `LOT_NO`, that row appears below active rows in red and remains read-only.
- `CLEANUP_REQUIRED -> ACTIVE` is a future workflow and is intentionally not
  changed in the current implementation.
- Normal worker actions must never physically delete a location row.

## Lot recording

When editing an existing location from scanner results, the worker can choose
the Lot currently displayed as the scanned/entered result or type a different
numeric Lot. The backend validates the final value before saving it.

When adding a new location after resolving a Lot, the worker can use the
resolved Lot or manually enter another numeric Lot. Camera validation remains
seven digits; manual entry may be longer.

## Reconciliation

The scanner compares all active main-location quantities for the resolved SKU
against all matching ERP `STOCK` values in `DATA : Current Stock`.

```text
frontlineQty = active physical-location sum
erpQty       = Current Stock sum
difference   = frontlineQty - erpQty
```

For a Lot lookup, exact-Lot `CLEANUP_REQUIRED` quantity is displayed separately
so questionable records are not silently counted as confirmed frontline stock.

Lot reconciliation is separate from SKU-wide ERP reconciliation:

```text
State active Lot quantity = sum QTY for ACTIVE rows with SKU_ID + LOT_NO
Stock By Lot quantity     = sum Remaining for Product Code + Lot No.
difference                = State active Lot quantity - Stock By Lot quantity
```

Only active/legacy-blank lifecycle rows participate. Blank Lots are
`LOT_UNASSIGNED`; equal quantities are `LOT_MATCHED`; a nonzero difference is
`LOT_MISMATCHED`; and a missing Stock By Lot pair is `LOT_NOT_FOUND`. The
backend writes the latest result to `LOT_CHECK_STATUS` and appends a snapshot
to `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ`.

## Audit logging

Location quantity and lifecycle changes append a row to
`MAIN : Log ข้อมูลตำแหน่ง`. The log records the authenticated user, action,
SKU, quantity delta, source/destination locations, and a reference/reason.

## Office warehouse picking allocation

The `ออฟฟิศโกดัง` workflow is implemented in `backend/office-allocation.js`
and `js/office.js`. Full requirements are in `docs/OFFICE_WAREHOUSE.md`; the
key rules are:

- Input is `DATA : Current ORD` (header row 6). The app never writes to it.
- Rows with the same `ord_id + product_code` are merged into one SKU
  requirement by summing `quantity`.
- An ORD is hidden from the allocation list while it has a `PENDING`,
  `COMPLETED`, or `EXCEPTION` entry in
  `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว`. `CANCELED` returns it to the list.
- At least one preparer is required. The selector includes every populated,
  valid row in `DATA : AES Team`; it does not filter by `team` or `role`.
- The frontend submits `actor_id` values only. The backend re-reads the team
  sheet, rejects missing/unknown/duplicate IDs, and stores each picker as
  `actor_id — full_name (nickname)` in the status row's `pickers` cell.
- The admin chooses locations. Choices are `ACTIVE` rows with `QTY > 0` and a
  matching `SKU_ID`. One SKU may be split across locations; each location is
  one row in `MAIN : Log พิกัดจาก ORD`.
- A selected row's existing Lot is authoritative and read-only. If its Lot is
  blank, the admin must choose from a dropdown containing only that SKU's Lots
  with positive summed `Remaining` in `DATA : Stock By Lot`. Arbitrary Lot text
  is not accepted in the ORD allocation screen.
- A chosen quantity must be positive and must not exceed the location's current
  `QTY`. If the real location holds more, or is missing, the admin first fixes
  the location data from the office page (`add` or `assign`).
- The whole ORD is submitted at once. Every SKU must be allocated exactly.
  Submit writes all rows in one batch under `LockService`, or writes nothing.
- Submit does not deduct stock. The ORD becomes `PENDING` for four hours.
- The saved allocation includes the confirmed Lot. Canceling before deduction
  changes no State Lot or quantity.
- Any authorized user can cancel a `PENDING` ORD (`CANCELED`, no stock change).
  A `PENDING` ORD cannot be edited; cancel and redo it.
- A time-driven trigger runs every 15 minutes and deducts ORDs that have been
  `PENDING` for at least four hours. For a still-blank State row, the saved Lot
  is assigned to the entire row immediately before the ORD quantity is deducted.
- If the location became inactive or its Lot changed to a conflicting value,
  the whole ORD becomes `EXCEPTION` and no allocation is deducted. Cancel and
  redo the ORD after correcting the data.
- If a location holds less than the chosen quantity at deduction time, it is
  deducted to 0 and the shortfall is logged. A location at 0 becomes
  `INACTIVE_EMPTY`.
- A repeated submit for an ORD that is already `PENDING`, `COMPLETED`, or
  `EXCEPTION` is rejected, which makes double-clicks and network retries safe.
- There is no undo after `COMPLETED`. Staff restore stock with the normal `add`
  action.
- No extra roles: every authorized user can use the office workflow.

## Current API actions

The Apps Script router currently exposes these actions after authentication:

```text
authCheck
lookup
pick
add
relocate
closeLocation
updateLot
assign
get3D
getOps
audit
getOfficeOrders
getOrderLocationChoices
submitOrderAllocation
cancelOrderAllocation
```

`assign` creates a new location row and is logged as `รับเข้า (RECEIVE)`.
`add` resolves its columns by header name.

The four office actions never deduct ORD stock. The `add` action still increases
location quantity immediately and independently. The timed deduction is the
`processDueOrderAllocations` trigger (not an API action) and is logged as
`เบิกตาม ORD (ORD_PICK)`.

The planned consignment registry will use the same authentication model but its
business rules have not yet been defined here.

## Known gaps

- Cleanup recovery back to `ACTIVE` is not implemented.
- Supervisor/admin action boundaries are not implemented as separate roles.
- `pick` and `relocate` still read some columns by fixed index.
- Client-request idempotency for uncertain network retries is not yet defined
  for every quantity operation.
