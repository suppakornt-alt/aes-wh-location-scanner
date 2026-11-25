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
    audit trail for pick, add, relocate, close, receive, and Lot edits
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
are returned as lookup metadata when available.

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

## Derived reconciliation

For a resolved SKU:

```text
frontlineQty = sum(QTY for ACTIVE main-location rows of the SKU)
cleanupQty   = sum(QTY for CLEANUP_REQUIRED rows of the SKU)
erpQty       = sum(STOCK for matching Current Stock rows)
difference   = frontlineQty - erpQty
```

The UI displays `EQUAL`, `UNDER`, or `OVER` from the difference. Cleanup rows
are shown separately and are not silently included in frontline quantity.

## Known data-model gaps

- The owner plans to move the ERP header rows from row 6 later.
- The exact meaning of the existing `STATUS` formula column is not yet recorded
  here; preserve the formula and ask before changing it.
- The recovery workflow from `CLEANUP_REQUIRED` back to `ACTIVE` is not yet
  defined.
- No separate user/role sheet is currently documented for this internal app.
