# Data Model

This document describes the current Google Sheets data model used by the
warehouse-location application. The sheet names and header spelling are part of
the existing workplace workflow.

## Relationship overview

```text
DATA : Stock By Lot
    LOT_NO -> SKU_ID / product metadata

DATA : Current Stock
    SKU_ID -> authoritative ERP quantity

MAIN : ตำแหน่งสินค้าทั้งหมด
    SKU_ID + LOT_NO + physical coordinate -> frontline location quantity

MAIN : Log ข้อมูลตำแหน่ง
    audit trail for pick, add, relocate, close, receive (new location via
    the `assign` action), Lot edits, and timed office ORD deductions

DATA : Current ORD
    cleaned ORD lines waiting for office allocation
    product_code -> SKU_ID

MAIN : Log ORD ที่ยืนยันพิกัดแล้ว
    one row per submitted ORD and its status
    (PENDING / COMPLETED / CANCELED / EXCEPTION)

MAIN : Log พิกัดจาก ORD
    one row per location chosen for a submitted ORD
    location_id -> LOCATION_ID

MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ
    append-only SKU + Lot reconciliation snapshots
```

The backend resolves a scanned or entered Lot through `DATA : Stock By Lot`,
then uses the resolved product code to find active location rows and sum ERP
quantity from `DATA : Current Stock`.

## Sheet: `MAIN : ตำแหน่งสินค้าทั้งหมด`

Current header order:

```text
LOCATION_ID
SKU_ID
NAME
LOT_NO
CATEGORY
BRAND
QTY
COL_NAME_START
COL_NAME_END
COL_START
COL_END
ROW_START
ROW_END
MIN_LEVEL
MAX_LEVEL
DISPLAY_LOC
LOCATION_STATUS
CLOSED_AT
CLOSED_BY
CLOSED_REASON
LOT_CHECK_STATUS
LATEST_SALES
DIFF_DAYS
CRITERIA
STATUS
```

### Field meanings

| Field | Meaning |
| --- | --- |
| `LOCATION_ID` | Unique identifier for one location record. |
| `SKU_ID` | Product code. |
| `NAME` | Product name stored on the location row. |
| `LOT_NO` | Lot recorded at this location. |
| `CATEGORY` | Product category/type stored on the location row. |
| `BRAND` | Product brand. |
| `QTY` | Quantity assigned to this location record. |
| `COL_NAME_START`, `COL_NAME_END` | Human-readable coordinate columns. |
| `COL_START`, `COL_END` | Numeric coordinate-column values. |
| `ROW_START`, `ROW_END` | Numeric row range. |
| `MIN_LEVEL`, `MAX_LEVEL` | Shelf-level range. |
| `DISPLAY_LOC` | Worker-facing formatted location. |
| `LOCATION_STATUS` | Lifecycle state: blank/`ACTIVE`, `INACTIVE_EMPTY`, or `CLEANUP_REQUIRED`. |
| `CLOSED_AT` | Timestamp for a closed or cleanup-marked row. |
| `CLOSED_BY` | Authenticated account that changed the lifecycle state. |
| `CLOSED_REASON` | Reason recorded for closing or cleanup. |
| `LOT_CHECK_STATUS` | Backend-derived ACTIVE-row Lot result: `LOT_UNASSIGNED`, `LOT_MATCHED`, `LOT_MISMATCHED`, or `LOT_NOT_FOUND`. |
| `LATEST_SALES` | Formula/lookup field for sales recency. |
| `DIFF_DAYS` | Formula/lookup field for elapsed sales days. |
| `CRITERIA` | Formula/lookup velocity category such as `FAST`, `MEDIUM`, `SLOW`, or `DEAD`. |
| `STATUS` | Existing formula/lookup field; exact business meaning is retained from the sheet. |

### Location identity and overlap

`LOCATION_ID` is unique. Multiple SKU and Lot records may share the same
physical coordinate, especially during the current cleaning process.

The current implementation merges a moved quantity only when SKU, Lot,
coordinate range, and shelf-level range all match exactly. If any of those
values differ, the backend creates or preserves a separate row. This rule
should be confirmed before changing merge behavior.

## Sheet: `DATA : Current Stock`

The header starts at physical row 6. Data starts at row 7. This layout is known
to be inconvenient and is planned for later cleanup; current code must continue
to use row 6 until that migration is deliberately performed.

Current headers:

```text
PRODUCT CODE
PRODUCT NAME
STOCK
BO
UNIT
BRAND
PRODUCT TYPE
STATE SHEET
STATUS
LATEST SALES
DIFF DAYS
CRITERIA
```

`PRODUCT CODE` identifies the SKU. `STOCK` is the authoritative ERP quantity
used for reconciliation. The remaining fields provide product metadata or
ERP/velocity information.

## Sheet: `DATA : Stock By Lot`

The header starts at physical row 6. Data starts at row 7.

Current headers:

```text
Product Code
Product Name
Unit
Lot No.
Created Date
Input Amount
Ref Code
Location
Remaining
LATEST LOCATION
CHECK STATUS
PRODUCT TYPE
PRODUCT BRAND
```

`Lot No.` is resolved to `Product Code`. Product name, unit, type, and brand
are returned as lookup metadata when available. Lot reconciliation and the
office blank-Lot dropdown sum `Remaining` for repeated rows with the same
`Product Code + Lot No.`; only Lots with positive summed `Remaining` are offered
for assignment.

## Sheet: `MAIN : Log ข้อมูลตำแหน่ง`

The backend creates this sheet when it does not exist. Current headers:

```text
LOG_ID
วันเวลา
อีเมลผู้บันทึก
ประเภทรายการ
รหัสสินค้า
จำนวนที่เปลี่ยน
จากพิกัด
ไปพิกัด
เอกสารอ้างอิง
```

This is an append-only operational audit log for location quantity and lifecycle
actions. It is not the source of truth for the current quantity; the main
location sheet remains the current-state source.

## Sheet: `DATA : Current ORD`

Cleaned ORD lines from the Magic 2002 ERP raw export, brought in through an
import range from another file and overwritten daily. This sheet is the input
work list for the `ออฟฟิศโกดัง` allocation workflow. The office application
reads it and never writes to it.

The header starts at physical row 6. Data starts at row 7, matching the other
`DATA :` sheets.

Current headers:

```text
order_date
ord_id
customer
product_code
product_name
quantity
weight
unit
line_amount_source
order_subtotal_before_vat
vat
order_total
```

### Field meanings

| Field | Meaning | Used by allocation |
| --- | --- | --- |
| `order_date` | ORD document date. | Display and sorting. |
| `ord_id` | ORD document number. | Groups lines into one ORD commit. |
| `customer` | Customer on the ORD. | Display only. |
| `product_code` | Required SKU; matches `SKU_ID` in the location sheet. | Filters location choices. |
| `product_name` | Product name from the ERP export. | Display only. |
| `quantity` | Required quantity for this ORD line. | Summed per `ord_id + product_code`. |
| `weight` | Line weight from the ERP export. Unit not yet confirmed. | Not used. |
| `unit` | Unit of measure for `quantity`. | Display only. |
| `line_amount_source` | Line value from the ERP export. `0.00` usually means a free line, but not always. | Not used. |
| `order_subtotal_before_vat` | ORD subtotal before VAT. Assumed to repeat on every line of the ORD; confirm. | Not used. |
| `vat` | ORD VAT amount. Assumed ORD-level; confirm. | Not used. |
| `order_total` | ORD total including VAT. Assumed ORD-level; confirm. | Not used. |

Monetary and weight fields are retained from the source but are not part of the
stock allocation rules. The allocation workflow must not modify them.

### Duplicate products in one ORD

The sheet has no line-number column, and one ORD can contain the same
`product_code` more than once (for example a paid line and a free line with
`line_amount_source` = `0.00`). The office workflow merges rows with the same
`ord_id + product_code` into one SKU requirement by summing `quantity`. No line
identifier is needed because the whole ORD is submitted at once.

Example from a real ORD:

```text
ord_id        product_code  quantity  line_amount_source
ORD261002004  MI16P-0003    2         0.00
ORD261002004  MI16P-0003    2         3,800.00
-> one requirement: ORD261002004 / MI16P-0003 / 4
```

### Completion tracking

`DATA : Current ORD` is overwritten daily, so no status is written to it. Which
ORDs are done is decided only by `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว`.

## Sheet: `DATA : AES Team`

Header row 1. Every populated valid row is available in the required office
ORD preparer selector; there is currently no `team` or `role` filter.

```text
actor_id full_name nickname display_name team role email
```

`actor_id` is the submitted stable identity. The UI label is
`full_name (nickname)`, falling back to `full_name` when nickname is blank.
Blank trailing rows are ignored; a populated row without `actor_id` or
`full_name`, or a duplicate `actor_id`, blocks loading so bad identities are
not recorded.

## Sheet: `MAIN : Log ORD ที่ยืนยันพิกัดแล้ว`

Created automatically by the backend on first use, with the header on row 1.
**One row per ORD, keyed by `ord_id`.** The row is overwritten when
the status changes; status history is not kept. It is the source of truth for
whether an ORD is still available for allocation:

- `PENDING`, `COMPLETED`, or `EXCEPTION`: hidden from the available allocation
  list; `PENDING` and `EXCEPTION` appear in the waiting-status view;
- `CANCELED`, or no row: shown in the available allocation list.

Columns (approved 2026-11-26):

```text
timestamp   submit time of the current submission; starts the four-hour hold
ord_id      key; one row per ORD
status      PENDING | COMPLETED | CANCELED | EXCEPTION
user        submitting user; replaced by the canceling user on CANCELED
message     conflict detail for EXCEPTION; blank otherwise
pickers     semicolon-separated actor_id — full_name (nickname) snapshots
```

The backend safely renames the legacy
`MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว` tab when the new-cased name is absent. If
two distinct tabs somehow exist, it stops instead of silently splitting ORD
history.

How each action changes the row:

| Action | `timestamp` | `status` | `user` | `pickers` |
| --- | --- | --- | --- | --- |
| First submit | set to now | `PENDING` | submitter | selected worker snapshots |
| Cancel | unchanged | `CANCELED` | canceler | unchanged |
| Redo after cancel | set to now | `PENDING` | submitter | replaced by new selection |
| Timed deduction | unchanged | `COMPLETED` | unchanged (submitter) | unchanged |
| Trigger conflict | unchanged | `EXCEPTION` | unchanged (submitter) | unchanged |

`EXCEPTION` is used when a selected location becomes inactive or its Lot
conflicts with the pending Lot during the hold. It blocks deduction until an
authorized user cancels and redoes the ORD.

`timestamp` changes only on submit, so it always matches the `timestamp` of the
allocation rows that belong to the current submission.

## Sheet: `MAIN : Log พิกัดจาก ORD`

Created automatically by the backend on first use, with the header on row 1.
One row per location chosen for a submitted ORD. A SKU split across
two locations produces two rows.

Columns (approved 2026-11-26):

```text
timestamp      submit time; same value as the status row's timestamp
ord_id
product_code
product_name
location_id    LOCATION_ID; the only value used to deduct
location       DISPLAY_LOC text for people
amount         quantity to pick from this location
lot_no         existing State Lot, or the Stock By Lot dropdown choice for a blank row
```

Rows are written in one batch at submit and are never edited or deleted. Rows
from a canceled submission stay as history. The timed deduction uses only the
rows whose `ord_id` and `timestamp` match the ORD's current `PENDING` row.

## Office deduction and the existing audit log

The timed deduction subtracts `amount` from `QTY` of the matching
`LOCATION_ID` in `MAIN : ตำแหน่งสินค้าทั้งหมด`, down to a minimum of 0. Each
deducted location appends one row to `MAIN : Log ข้อมูลตำแหน่ง` with action
`เบิกตาม ORD (ORD_PICK)`, the status row's `user` (the submitter) as the user,
and a reference containing the `ord_id`, `AUTO`, and any shortfall.

Location mapping used by the office workflow:

```text
location_id   <- LOCATION_ID
product_code  <- SKU_ID
location      <- DISPLAY_LOC
available     <- QTY   (only ACTIVE/blank rows with QTY > 0)
```

The location selector shows `LOT_NO`. Existing Lots are read-only. When the
State row is blank, the admin must choose a positive-Remaining Lot from
`DATA : Stock By Lot`; the selected `lot_no` is saved for four-hour finalization.

## Sheet: `MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ`

Append-only reconciliation snapshots. The State sheet's `LOT_CHECK_STATUS`
contains the latest current result for each matching ACTIVE row.

```text
PRODUCT_CODE
LOT_NO
STATE_ACTIVE_QTY
STOCK_BY_LOT_REMAINING
DIFFERENCE
LOT_CHECK_STATUS
CHECKED_AT
```

```text
STATE_ACTIVE_QTY = sum QTY for ACTIVE/legacy-blank LOCATION_STATUS rows
STOCK_BY_LOT_REMAINING = sum Remaining for matching Product Code + Lot No.
DIFFERENCE = STATE_ACTIVE_QTY - STOCK_BY_LOT_REMAINING
```

`LOT_MATCHED` means difference 0; any nonzero difference is
`LOT_MISMATCHED`; a missing Stock By Lot pair is `LOT_NOT_FOUND`. Blank State
Lots use `LOT_UNASSIGNED` and do not create reconciliation log rows.

## Derived reconciliation

For a resolved SKU:

```text
frontlineQty = sum(QTY for ACTIVE main-location rows of the SKU)
cleanupQty   = sum(QTY for CLEANUP_REQUIRED rows of the SKU whose LOT_NO
               exactly matches the scanned/manual Lot)
erpQty       = sum(STOCK for matching Current Stock rows)
difference   = frontlineQty - erpQty
```

The UI displays `EQUAL`, `UNDER`, or `OVER` from the difference. Exact-Lot
cleanup rows are shown separately and are not silently included in frontline
quantity.

## Known data-model gaps

- The owner plans to move the ERP header rows from row 6 later.
- The exact meaning of the existing `STATUS` formula column is not yet recorded
  here; preserve the formula and ask before changing it.
- The recovery workflow from `CLEANUP_REQUIRED` back to `ACTIVE` is not yet
  defined.
- No separate user/role sheet is currently documented for this internal app.
- Whether order-level money fields repeat on every ORD line, and the meaning of
  `weight`, are not confirmed. They are not used by the office workflow.
