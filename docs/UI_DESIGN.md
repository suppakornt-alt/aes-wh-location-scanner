# UI Design

## Design goals

- Mobile-first for warehouse workers, primarily Android Chrome.
- Thai-first worker-facing labels and status feedback.
- One authentication step at the landing page.
- Large touch targets and clear next actions.
- Light theme by default with an available theme toggle.
- Camera and numeric-keypad workflows that reduce Lot-entry errors.
- Clear loading, success, empty, and error states.

The existing visual language uses Kanit, light layered surfaces, subtle borders,
blue focus states, green success actions, amber warnings, and red errors.

## Root authentication and team chooser

The root page shows:

```text
AES Warehouse
    -> Google sign-in
    -> backend authorization check
    -> team chooser
```

The user signs in once. A valid session is reused when entering the picker or
office page. The UI must not show a second login panel inside normal work pages.
If the token expires or is rejected, the user returns to this landing page.

## Picker page

The picker page contains four views in the sidebar:

1. `สแกนเนอร์บาร์โค้ด`
2. `แผนผังคลัง 3D`
3. `จัดการหยิบ / เติม / ย้าย`
4. `ตรวจสอบยอด ERP`

`เปลี่ยนทีม` remains at the top of the sidebar.

### Scanner view

```text
Scan mode / manual Lot mode
    -> camera or numeric Lot input
    -> lookup status
    -> Lot result
    -> product code and name
    -> frontline / ERP reconciliation
    -> active locations and actions
```

Camera mode accepts seven digits and confirms after five matching detections.
Manual mode uses `type="tel"`/numeric input and supports up to 20 numeric digits.

The location row shows:

- Display location
- Quantity and unit
- Current Lot or `+ ระบุ Lot`
- `เติม`
- `เบิก`
- `ย้าย`
- Safe close/cleanup icon

When recording a Lot from a scanner result, workers can use the Lot currently
shown by the scanner or choose to enter another numeric Lot.

### Reconciliation panel

After a product is resolved, show:

- Frontline total across active locations
- ERP total from `DATA : Current Stock`
- Difference
- `EQUAL`, `UNDER`, or `OVER` status
- Cleanup quantity separately when present

This comparison is SKU-wide, not limited to one physical location.

### Relocation modal

The relocation modal supports:

- Quantity input
- `ย้ายทั้งหมด` shortcut
- Existing destination from the same product code
- Same physical coordinate with a different level
- Manual new coordinate and level

Existing destinations must never list every SKU in the warehouse. The current
source location is excluded. Manual destination remains available when the
desired location is not already represented.

### 3D view

The 3D view renders active positive-quantity location rows. It provides SKU
search, product-category colors, velocity/criteria filters, heatmap mode, and
detail interaction. Inactive lifecycle rows are not rendered as active stock.

### Operations view

Operations groups active rows by product type and product name. Workers can
search by name, SKU, or Lot and use pick, add, relocate, Lot edit, and safe-close
actions from location rows.

### Audit view

The audit view compares ERP and frontline values and provides KPI counts for
unassigned, under, and over results. It is a review surface; it must not
silently change stock quantities.

## Office page

The office page currently provides a picking-order form:

```text
ORD number
    -> add product blocks
    -> add Lot and quantity rows
    -> validate
    -> preview
    -> local test-mode confirmation
```

The current code identifies this page as test mode and does not yet send the
final order to a Google Sheet backend. That limitation must remain visible until
the backend save action is implemented.

### Approved next workflow: `ออฟฟิศโกดัง`

The next implementation replaces the earlier test-mode flow with ORD location
allocation. The detailed requirements are in `docs/OFFICE_WAREHOUSE.md`.

The first screen shows pending ORD work with:

- ORD date
- ORD number
- product code
- product name
- required amount
- allocation status
- `เบิกรายการ` action

The allocation screen opens the full ORD and shows every SKU's required,
allocated, and remaining amount. The administrator chooses a location from a
product-filtered selector, enters the quantity to pick, and uses `+` to add
another location when the SKU is split across locations. Final confirmation is
for the full ORD, not just the last visible SKU.

The UI must show the current available quantity for each choice, prevent invalid
or duplicate location entries, and require explicit final confirmation before
the backend changes stock. Location text is display-only; the submitted
`location_id` is authoritative.

The existing one-time authentication session, Thai-first worker language,
shared styling, and responsive mobile behavior remain in force. The office
page and office JavaScript may be substantially replaced during implementation,
but authentication/session contracts must not be removed accidentally.

## Planned third page: `ระบบฝากขาย`

The project will add a third page for frontline consignment tire registration
before goods are sent to a customer warehouse. Its authentication remains the
same one-time internal session. Detailed fields, workflow, and backend actions
are not yet defined and must be documented before implementation.

## Device and accessibility rules

- Primary device target: Android Chrome.
- Test at narrow mobile width and desktop width.
- Keep scanner controls visible without unnecessary scrolling.
- Use semantic labels for inputs and meaningful button text.
- Keep numeric inputs compatible with a mobile keypad.
- Show clear feedback when camera permission or network access fails.
- Do not expose tokens, credentials, or internal URLs in visible UI.
