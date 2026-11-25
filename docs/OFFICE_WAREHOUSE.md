# Office Warehouse Picking Allocation Requirements

## Status

This is the approved first-version scope for the `ออฟฟิศโกดัง` page. The
requirements were agreed with the project owner on 2026-11-26. Code changes
start only after the owner gives the signal to plan and implement.

## Purpose

Replace the current office test-mode Lot form with a workflow where the
warehouse administrator chooses the physical location from which each SKU of an
ORD will be picked. After a four-hour cancellation hold, the backend deducts
the chosen quantities from the location sheet automatically.

The administrator chooses locations. The backend remains responsible for
identity, authorization, quantity validation, concurrency protection, stock
deduction, and auditability.

The location web app is a location-finding aid for workers, not the stock
authority. ERP remains the authoritative stock source. The office workflow
therefore keeps the location data close to reality; it does not reserve stock.

## Current operational boundary

The first version does not download directly from the ERP. The existing manual
boundary remains:

1. Download the ORD raw file from Magic 2002 ERP.
2. Put the file in the company shared drive.
3. The existing two-hour cleaning cycle and import range refresh
   `DATA : Current ORD`. The sheet is overwritten daily.
4. Open the `ออฟฟิศโกดัง` page and allocate locations.

The import source, cleaning process, and raw-file storage location must not be
redesigned as part of the office-page implementation.

## Data sources

| Sheet | Role | Written by this workflow |
| --- | --- | --- |
| `DATA : Current ORD` | Input ORD lines. Header row 6, data from row 7. | Never. |
| `MAIN : ตำแหน่งสินค้าทั้งหมด` | Location choices and the stock that is deducted. | Yes: add location, add quantity, timed deduction. |
| `MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว` | One row per ORD, keyed by `ord_id`, overwritten on status change. Source of truth for which ORDs are done. | Yes. |
| `MAIN : Log พิกัดจาก ORD` | One row per location chosen for an ORD. | Yes. |
| `MAIN : Log ข้อมูลตำแหน่ง` | Existing quantity audit log. | Yes, when stock is actually deducted. |

Column details are in `docs/DATA_MODEL.md`.

## ORD lines and duplicate products

`DATA : Current ORD` can contain the same `product_code` more than once in one
ORD (for example a paid line and a free line). In the first version, the
backend merges rows with the same `ord_id + product_code` into one SKU
requirement by summing `quantity`.

Example: `ORD261002004` contains `MI16P-0003` twice with quantity 2 each. The
office page shows one card, `MI16P-0003 · 4 วง`.

The page does not label free goods. Money fields are not used by this workflow.

## Office workflow

### 1. Pending ORD list

The page lists ORDs from `DATA : Current ORD` that are available for
allocation. An ORD is available when `MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว` has
no row for its `ord_id`, or its row is `CANCELED`. A `CANCELED` ORD returns to
the list.

Each ORD shows `order_date`, `ord_id`, `customer`, the number of SKUs, and a
`เบิกรายการ` action.

### 2. Location allocation screen

The admin opens one full ORD. Each merged SKU card shows:

- product code, product name, unit;
- required quantity, allocated quantity, remaining quantity;
- one or more location rows, each with a location selector and a quantity to
  pick from that location;
- `+` to add another location row when the SKU is split across locations.

Location choices come from `MAIN : ตำแหน่งสินค้าทั้งหมด` and include only rows
where `SKU_ID` equals the product code, `LOCATION_STATUS` is `ACTIVE` (or
blank), and `QTY > 0`. Each choice shows `DISPLAY_LOC`, `LOT_NO`, and `QTY`.
`LOCATION_ID` is the submitted value; display text is never used to deduct.

The same location may not appear twice in one SKU card.

### 3. Fixing location data from the office page

The location web app may not match the real warehouse. The admin must make it
match before choosing a location:

- **Add new location:** when the real location is not in the selector, the
  admin uses a button on the SKU card. It opens the same new-location form that
  the picker page uses (existing `assign` action).
- **Add quantity:** when a location shows less than what is really there, the
  admin adds quantity to that location first (existing `add` action).

After either action, the location choices for that SKU reload. The ORD being
allocated stays on screen with the admin's entries kept.

### 4. Submit

The admin can submit only when, for every SKU in the ORD:

- the allocated total equals the required quantity; and
- every row's quantity is a positive number and does not exceed the selected
  location's current `QTY`.

The final action is `ยืนยันการเบิก`. Submitting does **not** deduct stock. It
saves the ORD as `PENDING` and the ORD leaves the pending list.

There is no draft feature in the first version.

### 5. Four-hour hold and cancel

A `PENDING` ORD waits four hours from submission before stock is deducted, in
case the customer cancels.

- The page shows a list of `PENDING` ORDs with their submit time.
- Any authorized user may cancel a `PENDING` ORD. It becomes `CANCELED`, no
  stock changes, and the ORD returns to the pending list to be redone.
- A `PENDING` ORD cannot be edited. To change it, cancel and redo it.

### 6. Automatic deduction

A time-driven Apps Script trigger runs every 15 minutes. For each `PENDING`
ORD submitted at least four hours earlier, it deducts every chosen location and
marks the ORD `COMPLETED`. Stock is therefore deducted between 4 hours and
4 hours 15 minutes after submission.

After `COMPLETED`, the office page offers no undo. If a customer cancels later,
staff restore stock manually with the normal add-quantity action.

## Backend rules

### Loading

- Read `DATA : Current ORD` by header name from row 6.
- Merge rows by `ord_id + product_code`.
- Exclude ORDs with a `PENDING` or `COMPLETED` status entry.

### Submit (`ยืนยันการเบิก`)

Under `LockService`, as one operation:

1. Verify the session token and authorization.
2. Re-read the ORD from `DATA : Current ORD` and merge it again. If its SKUs or
   required quantities differ from the submitted ORD, reject with
   `ORD นี้มีการเปลี่ยนแปลง กรุณาโหลดใหม่`.
3. Reject if the ORD's status row is `PENDING` or `COMPLETED`. This also makes
   double-clicks and network retries safe without an extra ID.
4. Re-read the location sheet. Every chosen `LOCATION_ID` must exist, be
   `ACTIVE`, match the product code, and hold at least the chosen quantity.
5. Every SKU's allocated total must equal its required quantity.
6. Append all allocation rows in one batch with the same `timestamp`. Then
   append the ORD's status row, or overwrite its `CANCELED` row, with
   `PENDING`, that `timestamp`, and the submitter as `user`.

Any failed check writes nothing.

### Cancel

Under `LockService`: only a `PENDING` ORD can be canceled. Overwrite `status`
with `CANCELED` and `user` with the canceling user. No stock change. The cancel
time is not stored.

### Timed deduction

Under `LockService`, for each due `PENDING` ORD:

1. Read the allocation rows whose `ord_id` and `timestamp` match the ORD's
   status row. Rows from earlier canceled submissions are ignored.
2. For each row, find the location by `LOCATION_ID` and deduct the chosen
   quantity. If the location now holds less (workers may have picked from it
   during the hold), deduct down to 0 and record the shortfall.
3. A location that reaches 0 becomes `INACTIVE_EMPTY`. The row is never
   deleted.
4. Append one row per deducted location to `MAIN : Log ข้อมูลตำแหน่ง`. The user
   is the status row's `user` (the submitter). The reference contains the
   `ord_id`, `AUTO`, and any shortfall.
5. Overwrite the ORD's `status` with `COMPLETED`. `timestamp` and `user` stay.

A missing or inactive location is treated as a full shortfall, so the ORD still
completes and the problem appears in the log for cleaning.

Because the timed deduction uses the saved allocation rows, it does not depend
on `DATA : Current ORD` still containing the ORD.

## Status values

```text
PENDING    submitted, waiting for the four-hour hold; no stock deducted
COMPLETED  stock deducted by the timed trigger
CANCELED   canceled during the hold; ORD can be allocated again
```

These are separate from location lifecycle statuses such as `ACTIVE` and
`INACTIVE_EMPTY`.

## Authentication and language

- Reuse the existing one-time Google authentication session.
- Do not add a second login screen or role checks to the office page.
- Apps Script silently revalidates the ID token for every protected request.
- The timed trigger runs as the script owner and needs no ID token.
- Source identifiers and action names remain English.
- Worker-facing labels, validation, and status messages are Thai-first.
- Keep the existing visual theme of the office and picker pages.

## Non-goals for this version

- Direct ERP API integration.
- Replacing the import range or cleaning cycle.
- Stock reservation between `PENDING` ORDs.
- Draft saving.
- Editing a `PENDING` ORD, or undoing a `COMPLETED` ORD from the office page.
- Labelling free-goods lines.
- Role-based permissions.
- Changes to picker, 3D, reconciliation, or relocation behavior.
- Automatic location selection or route optimization.
