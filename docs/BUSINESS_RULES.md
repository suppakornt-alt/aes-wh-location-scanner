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

`CLEANUP_REQUIRED` quantity is displayed separately so questionable records are
not silently counted as confirmed frontline stock.

## Audit logging

Location quantity and lifecycle changes append a row to
`MAIN : Log ข้อมูลตำแหน่ง`. The log records the authenticated user, action,
SKU, quantity delta, source/destination locations, and a reference/reason.

## Office warehouse picking allocation

The next implementation scope is the `ออฟฟิศโกดัง` workflow described in
`docs/OFFICE_WAREHOUSE.md`.

- The cleaned ORD data is the input work list; the first version does not
  download directly from the ERP.
- The administrator selects locations for each ORD line. Location choices come
  from current state data and must match the selected product code.
- One SKU may be split across multiple locations. Each selected location is a
  separate allocation record with its own `pull_off_amount`.
- The intended confirmation boundary is the full ORD: every required SKU line
  must be allocated before one final confirmation commits the ORD.
- Quantities must be positive, and the final allocation total must equal the
  required amount for every ORD line before the ORD is marked complete.
- The backend must re-read state, acquire `LockService`, validate availability,
  and perform the allocation/audit/deduction as one protected operation.
- An invalid or insufficient-stock submission must make no quantity change.
- Completed lines cannot be deducted again. Reversals or corrections must
  preserve the original allocation and audit history.
- Duplicate submissions and uncertain network retries must be safe through a
  stable commit or idempotency reference.

The exact physical Sheets, status names, partial-allocation rule, and correction
permissions remain decisions to confirm before implementation.

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
```

The planned consignment registry will use the same authentication model but its
business rules have not yet been defined here.

## Known gaps

- Cleanup recovery back to `ACTIVE` is not implemented.
- Supervisor/admin action boundaries are not implemented as separate roles.
- The office page's final backend save workflow is still pending in the code.
- Client-request idempotency for uncertain network retries is not yet defined
  for every quantity operation.
