# Office Warehouse Picking Allocation Requirements

## Status

This is the first-version scope for the `ออฟฟิศโกดัง` page, agreed with the
project owner on 2026-11-26 and implemented the same day. On 2026-11-26 the
owner pushed the backend, installed the deduction trigger, and deployed a new
web-app version. Release test results (`OFF-*` in `docs/TEST_PLAN.md`) have not
been recorded yet.

The owner later pushed the controlled blank-Lot dropdown, delayed Lot
assignment, Lot reconciliation, and exception handling. Live deployment and
release evidence are not recorded. The required AES Team preparer selector and
status-sheet capitalization migration are the current local implementation.

Implementation:

| Part | File |
| --- | --- |
| Page | `pages/office.html`, `js/office.js`, `css/style.css` (`of-*` classes) |
| Backend | `backend/office-allocation.js` |
| Config | `backend/Code.js` (`SHEET_ORD`, `SHEET_AES_TEAM`, header rows, status/allocation sheets, `ORD_HOLD_HOURS`) |
| API actions | `getOfficeOrders`, `getOrderLocationChoices`, `submitOrderAllocation`, `cancelOrderAllocation`, plus existing `add` and `assign` |
| Trigger | `processDueOrderAllocations`, installed once with `installOrderDeductionTrigger` |

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
| `DATA : AES Team` | Every valid row is an eligible ORD preparer. Header row 1. | Never. |
| `MAIN : ตำแหน่งสินค้าทั้งหมด` | Location choices and the stock that is deducted. | Yes: add location, add quantity, timed deduction. |
| `DATA : Stock By Lot` | Supplies positive-`Remaining` Lot choices and the comparison quantity. | Never. |
| `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว` | One row per ORD, keyed by `ord_id`, overwritten on status change. Source of truth for which ORDs are done. | Yes. |
| `MAIN : Log พิกัดจาก ORD` | One row per location chosen for an ORD. | Yes. |
| `MAIN : Log ข้อมูลตำแหน่ง` | Existing quantity audit log. | Yes, when stock is actually deducted. |
| `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ` | Append-only Lot reconciliation snapshots. | Yes. |

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
allocation. An ORD is available when `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว` has
no row for its `ord_id`, or its row is `CANCELED`. A `CANCELED` ORD returns to
the list.

Each ORD shows `order_date`, `ord_id`, `customer`, the number of SKUs, and a
`เบิกรายการ` action.

### 2. Location allocation screen

The admin opens one full ORD. Each merged SKU card shows:

- product code, product name, unit;
- required quantity, allocated quantity, remaining quantity;
- one or more location rows, each with a location selector, Lot control, and a
  quantity to pick from that location;
- `+` to add another location row when the SKU is split across locations.

Location choices come from `MAIN : ตำแหน่งสินค้าทั้งหมด` and include only rows
where `SKU_ID` equals the product code, `LOCATION_STATUS` is `ACTIVE` (or
blank), and `QTY > 0`. Each choice shows `DISPLAY_LOC`, `LOT_NO`, and `QTY`.
`LOCATION_ID` is the submitted value; display text is never used to deduct.

The same location may not appear twice in one SKU card.

The top-right ORD header contains a required multi-worker dropdown. It includes
every valid `DATA : AES Team` row and displays `full_name (nickname)`. At least
one worker must be selected; multiple workers may prepare one ORD.

If the selected State row already has `LOT_NO`, the UI displays it as a
read-only value. If `LOT_NO` is blank, the admin must choose a Lot from a
dropdown built from the same SKU's positive summed `Remaining` values in
`DATA : Stock By Lot`. There is no manual text override in this workflow.

### 3. Fixing location data from the office page

The location web app may not match the real warehouse. The admin must make it
match before choosing a location:

- **Add new location:** when the real location is not in the selector, the
  admin uses a button on the SKU card. It opens the same new-location form that
  the picker page uses (existing `assign` action).
- **Add quantity:** when a location shows less than what is really there, the
  admin adds quantity to that location first (existing `add` action).

`เติม` increases the State quantity immediately. It is independent of the ORD
hold and does not wait four hours. A Lot selected specifically for the ORD is
not assigned by `เติม`.

After either action, the location choices for that SKU reload. The ORD being
allocated stays on screen with the admin's entries kept.

### 4. Submit

The admin can submit only when, for every SKU in the ORD:

- the allocated total equals the required quantity; and
- every row's quantity is a positive number and does not exceed the selected
  location's current `QTY`; and
- every selected blank-Lot location has a valid dropdown Lot for its SKU.
- at least one live AES Team `actor_id` is selected.

The final action is `ยืนยันการเบิก`. Submitting does **not** deduct stock. It
saves the ORD as `PENDING` and the ORD leaves the pending list.

There is no draft feature in the first version.

### 5. Four-hour hold and cancel

A `PENDING` ORD waits four hours from submission before stock is deducted, in
case the customer cancels.

- The page shows a list of `PENDING` ORDs with their submit time.
- Any authorized user may cancel a `PENDING` ORD. It becomes `CANCELED`, no
  State Lot or quantity changes, and the ORD returns to the pending list to be
  redone.
- A `PENDING` ORD cannot be edited. To change it, cancel and redo it.

### 6. Automatic deduction

A time-driven Apps Script trigger runs every 15 minutes. For each `PENDING`
ORD submitted at least four hours earlier, it deducts every chosen location and
marks the ORD `COMPLETED`. For a location whose State Lot is still blank, it
first applies the saved dropdown Lot to the whole location row (Option A), then
deducts only the allocated ORD quantity. Stock is therefore deducted between
4 hours and 4 hours 15 minutes after submission.

If a selected location is inactive, missing, or now has a different nonblank
Lot, the trigger changes the whole ORD to `EXCEPTION` and deducts nothing. The
pending screen displays the reason; an authorized user cancels and redoes it.

After `COMPLETED`, the office page offers no undo. If a customer cancels later,
staff restore stock manually with the normal add-quantity action.

## Backend rules

### Loading

- Read `DATA : Current ORD` by header name from row 6.
- Merge rows by `ord_id + product_code`.
- Exclude ORDs with a `PENDING`, `COMPLETED`, or `EXCEPTION` status entry.

### Submit (`ยืนยันการเบิก`)

Under `LockService`, as one operation:

1. Verify the session token and authorization.
2. Re-read the ORD from `DATA : Current ORD` and merge it again. If its SKUs or
   required quantities differ from the submitted ORD, reject with
   `ORD นี้มีการเปลี่ยนแปลง กรุณาโหลดใหม่`.
3. Reject if the ORD's status row is `PENDING`, `COMPLETED`, or `EXCEPTION`.
   This also makes double-clicks and network retries safe without an extra ID.
4. Re-read the location sheet. Every chosen `LOCATION_ID` must exist, be
   `ACTIVE`, match the product code, and hold at least the chosen quantity.
5. Preserve an existing State Lot. For a blank State Lot, verify that the
   submitted Lot is one of the SKU's positive-`Remaining` dropdown choices.
6. Re-read `DATA : AES Team`, validate every selected `actor_id`, and build the
   canonical `actor_id — full_name (nickname)` picker snapshot.
7. Every SKU's allocated total must equal its required quantity.
8. Append all allocation rows, including `lot_no`, in one batch with the same
   `timestamp`. Then append the ORD's status row, or overwrite its `CANCELED`
   row, with `PENDING`, that `timestamp`, the submitter as `user`, and selected
   preparers in `pickers`.

Any failed check writes nothing.

### Cancel

Under `LockService`: a `PENDING` or `EXCEPTION` ORD can be canceled. Overwrite
`status` with `CANCELED` and `user` with the canceling user. No stock change.
The cancel time is not stored.

### Timed deduction

Under `LockService`, for each due `PENDING` ORD:

1. Read the allocation rows whose `ord_id` and `timestamp` match the ORD's
   status row. Rows from earlier canceled submissions are ignored.
2. Preflight every row. If a location is missing/inactive, has no confirmed
   Lot, or has changed to a different Lot, set the ORD to `EXCEPTION` and do
   not change any State row.
3. Plan each safe row's whole-row Lot assignment (only when State remains
   blank), quantity deduction, shortfall, and lifecycle result in memory.
4. Mark the ORD `COMPLETED` before stock writes so a partial write failure
   cannot cause the next trigger to deduct the same ORD twice.
5. Apply the planned Lot and quantity writes. A location that reaches 0 becomes
   `INACTIVE_EMPTY`; the row is never deleted.
6. Append one row per deducted location to `MAIN : Log ข้อมูลตำแหน่ง`. The user
   is the status row's `user` (the submitter). The reference contains the
   `ord_id`, `AUTO`, and any shortfall.
7. Refresh Lot reconciliation for each affected SKU/Lot. The ORD's original
   `timestamp` and `user` stay unchanged.

Because the timed deduction uses the saved allocation rows, it does not depend
on `DATA : Current ORD` still containing the ORD.

## Status values

```text
PENDING    submitted, waiting for the four-hour hold; no stock deducted
COMPLETED  stock deducted by the timed trigger
CANCELED   canceled during the hold; ORD can be allocated again
EXCEPTION  location/Lot conflict; no deduction; cancel and redo
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
- Automatic Lot choice when more than one positive-Remaining Lot exists.
- Automatic location selection or route optimization.
