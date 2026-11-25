# Test Plan

This plan is for regression and production-hardening of the active workplace
application. A test is not considered complete from code inspection alone.
Record evidence and date when a scenario is manually verified.

Status values:

```text
NOT_RUN | PASS | FAIL | BLOCKED
```

## Test environment

- Primary: Android Chrome on a warehouse phone.
- Secondary: desktop Chrome for office and 3D work.
- Backend: deployed Apps Script web app connected to the project Sheets.
- Data: use approved test Lots/SKUs; do not alter production quantities without
  a recovery plan.
- Test account: use an authorized company account or the configured test account.

## Authentication

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| AUTH-001 | Authorized user signs in at root | Backend authorization succeeds and team chooser appears | NOT_RUN |
| AUTH-002 | Unauthorized Google account signs in | Access is rejected; team chooser remains hidden | NOT_RUN |
| AUTH-003 | User enters picker after sign-in | No second login screen appears | NOT_RUN |
| AUTH-004 | User enters office after sign-in | Same session is reused; no second login screen appears | NOT_RUN |
| AUTH-005 | Token expires or becomes invalid | User returns to root sign-in | NOT_RUN |
| AUTH-006 | Direct page URL without session | User is redirected to root | NOT_RUN |
| AUTH-007 | Normal API action with valid session | Backend accepts the verified account | NOT_RUN |
| AUTH-008 | API request without valid token | Backend rejects the request | NOT_RUN |

## Lot scanner and lookup

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| LOT-001 | Camera detects a valid seven-digit Lot | Confirmation occurs after five matching detections | NOT_RUN |
| LOT-002 | Camera detects fewer than five matching values | Camera does not confirm | NOT_RUN |
| LOT-003 | Camera receives a non-seven-digit value | Value is rejected by camera pattern | NOT_RUN |
| LOT-004 | Manual numeric seven-digit Lot | Numeric keypad appears and lookup runs | NOT_RUN |
| LOT-005 | Manual longer numeric Lot | Value up to 20 digits can be submitted | NOT_RUN |
| LOT-006 | Manual mixed-character Lot | Submission is rejected | NOT_RUN |
| LOT-007 | Lot resolves through `DATA : Stock By Lot` | Correct product code and metadata appear | NOT_RUN |
| LOT-008 | Unknown Lot | Clear not-found state; no location is created | NOT_RUN |
| LOT-009 | Scanner result opens Lot editor | Worker can use displayed Lot or enter another Lot | NOT_RUN |

## Reconciliation and locations

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| REC-001 | SKU exists in active main rows and ERP | Frontline and ERP totals are displayed | NOT_RUN |
| REC-002 | Frontline equals ERP | Status is `EQUAL` | NOT_RUN |
| REC-003 | Frontline is below ERP | Status is `UNDER` | NOT_RUN |
| REC-004 | Frontline is above ERP | Status is `OVER` | NOT_RUN |
| REC-005 | SKU has cleanup quantity | Cleanup quantity is shown separately | NOT_RUN |
| REC-006 | Location is `INACTIVE_EMPTY` | It is excluded from normal scanner and 3D views | NOT_RUN |
| REC-007 | Location is `CLEANUP_REQUIRED` | It is excluded from active total but preserved | NOT_RUN |
| REC-008 | Multiple SKUs share a coordinate | Each product row remains visible separately | NOT_RUN |

## Quantity actions

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| QTY-001 | Pick a positive amount below balance | Quantity decreases and audit log is appended | NOT_RUN |
| QTY-002 | Pick more than balance | Request is rejected; quantity is unchanged | NOT_RUN |
| QTY-003 | Pick the exact remaining balance | Quantity becomes zero; row becomes `INACTIVE_EMPTY` | NOT_RUN |
| QTY-004 | Add a positive amount to an active row | Quantity increases and audit log is appended | NOT_RUN |
| QTY-005 | Submit zero or negative quantity | Request is rejected | NOT_RUN |
| QTY-006 | Two quantity actions occur concurrently | Locking prevents lost updates | NOT_RUN |

## Relocation

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| MOVE-001 | Move a partial quantity | Source keeps the remainder; destination receives moved quantity | NOT_RUN |
| MOVE-002 | Move all quantity | Source becomes inactive-empty; destination receives all quantity | NOT_RUN |
| MOVE-003 | Open existing destination list | Only locations for the current SKU appear | NOT_RUN |
| MOVE-004 | Choose exact same SKU, Lot, coordinate, and level | Quantities merge | NOT_RUN |
| MOVE-005 | Choose same SKU but different Lot | Separate destination row is preserved | NOT_RUN |
| MOVE-006 | Choose same coordinate with another level | New level record is created or merged exactly | NOT_RUN |
| MOVE-007 | Enter a manual new destination | New location record is created | NOT_RUN |
| MOVE-008 | Select the source itself | Backend rejects the move | NOT_RUN |
| MOVE-009 | Move quantity concurrently with another action | Locking prevents lost quantities | NOT_RUN |

## Cleanup and lifecycle

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| LIFE-001 | Close an empty location | Row becomes `INACTIVE_EMPTY`; row is not deleted | NOT_RUN |
| LIFE-002 | Flag a non-empty invalid location | Row becomes `CLEANUP_REQUIRED`; quantity is preserved | NOT_RUN |
| LIFE-003 | Cleanup action requires a reason | Blank reason is rejected | NOT_RUN |
| LIFE-004 | Cleanup row appears in reconciliation | Quantity is reported separately | NOT_RUN |
| LIFE-005 | Attempt future cleanup recovery | Keep blocked until the recovery workflow is implemented | NOT_RUN |

## 3D, office, and UI

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| UI-001 | Open 3D view on desktop | Active stock renders and can be searched | NOT_RUN |
| UI-002 | Apply category and velocity filters | Visible 3D stock changes correctly | NOT_RUN |
| UI-003 | Open operations view on mobile | Cards and actions remain usable without horizontal overflow | NOT_RUN |
| UI-004 | Open audit view | KPI counters and discrepancy list render | NOT_RUN |
| UI-005 | Use office form with invalid ORD/product/Lot/quantity | Validation blocks save preview | NOT_RUN |
| UI-006 | Complete office test-mode preview | Correct summary appears; no false claim of Sheet save | NOT_RUN |
| UI-007 | Open on Android Chrome | Camera permission, keypad, layout, and scrolling work | NOT_RUN |
| UI-008 | Open on desktop Chrome | Sidebar, forms, 3D, and office layout work | NOT_RUN |

## Office warehouse picking allocation

These scenarios cover the approved next implementation described in
`docs/OFFICE_WAREHOUSE.md`.

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| OFF-001 | Load cleaned pending ORD data | Eligible ORD lines show date, ORD, SKU, product name, amount, status, and action | NOT_RUN |
| OFF-002 | Open `เบิกรายการ` for one ORD line | Required, allocated, remaining, and location-allocation controls appear | NOT_RUN |
| OFF-003 | Open a location selector | Only current locations for the selected SKU with usable quantity appear | NOT_RUN |
| OFF-004 | Split one SKU across two locations | Two allocation rows are retained with independent quantities | NOT_RUN |
| OFF-005 | Allocate every SKU in one ORD exactly | Backend commits the full ORD allocation, audit events, and state deductions | NOT_RUN |
| OFF-006 | Leave one SKU in the ORD incomplete | Full-ORD confirmation is rejected; no false completion occurs | NOT_RUN |
| OFF-007 | Submit more than the required amount | Submission is rejected and quantities are unchanged | NOT_RUN |
| OFF-008 | Select a location with insufficient current stock | Backend rejects after re-read; no partial deduction occurs | NOT_RUN |
| OFF-009 | Use a stale location quantity | Server-side validation detects the changed quantity and prevents an over-deduction | NOT_RUN |
| OFF-010 | Submit the same confirmation twice | Idempotency prevents a duplicate allocation or deduction | NOT_RUN |
| OFF-011 | Confirm concurrent allocations | Locking prevents lost updates and negative stock | NOT_RUN |
| OFF-012 | Reopen a completed ORD | It cannot be silently deducted a second time | NOT_RUN |
| OFF-013 | Correct a committed allocation | Original history remains; correction uses an approved reversal/adjustment path | NOT_RUN |
| OFF-014 | Use the office workflow on Android Chrome | Cards, selectors, numeric inputs, confirmation, and errors remain usable | NOT_RUN |

## Release evidence

Before a production change is called ready, record:

- Commit or release identifier.
- Backend version if Apps Script changed.
- Device/browser used.
- Test IDs and final statuses.
- Any known production risk or rollback step.
