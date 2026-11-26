// Office warehouse (ออฟฟิศโกดัง) ORD location allocation.
//
// Flow (see docs/OFFICE_WAREHOUSE.md):
//   1. getOfficeOrders            -> allocatable ORDs, AES Team workers, and
//                                    the PENDING/EXCEPTION list.
//   2. getOrderLocationChoices    -> ACTIVE locations with QTY > 0 per SKU.
//   3. submitOrderAllocation      -> saves allocation rows + PENDING status.
//                                    Does NOT deduct stock.
//   4. cancelOrderAllocation      -> PENDING -> CANCELED, no stock change.
//   5. processDueOrderAllocations -> time-driven trigger; deducts stock for
//                                    ORDs PENDING for ORD_HOLD_HOURS, then
//                                    marks them COMPLETED.
//
// DATA : Current ORD is overwritten daily by an import range, so this module
// only reads it. ORD status lives in CONFIG.SHEET_ORD_STATUS (one row per
// ord_id, overwritten on status change).

const ORD_STATUS = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  EXCEPTION: 'EXCEPTION'
});

// Header rows of the two sheets this module owns. Columns are always resolved
// by these names, so the owner may reorder columns without breaking the code.
const ORD_STATUS_HEADERS = ['timestamp', 'ord_id', 'status', 'user', 'message', 'pickers'];
const ORD_ALLOCATION_HEADERS = [
  'timestamp', 'ord_id', 'product_code', 'product_name', 'location_id', 'location', 'amount', 'lot_no'
];

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

function openWarehouseSpreadsheet() {
  return SpreadsheetApp.openByUrl(CONFIG.SS_URL);
}

// Parses numbers that may arrive as "1,250.00" text from the ERP export.
function parseSheetNumber(value) {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Quantity sums are compared after rounding so decimal units (e.g. litres)
// do not fail exact-total checks because of floating-point noise.
function roundQty(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

// Status and allocation rows are linked by their shared submit timestamp.
// Compare at whole-second precision so a Date read back from Sheets always
// matches the Date that was written.
function toSecondKey(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? Math.round(time / 1000) : NaN;
}

function nowToWholeSecond() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

function formatThaiDateTime(value, timeZone) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return String(value || '');
  return Utilities.formatDate(value, timeZone, 'dd/MM/yyyy HH:mm');
}

function formatOrderDate(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone, 'dd/MM/yyyy');
  }
  return String(value || '').trim();
}

// Sortable yyyymmdd key for dd/MM/yyyy order dates; unknown dates sort last.
function orderDateSortKey(text) {
  const parts = String(text || '').split('/');
  if (parts.length !== 3) return 99999999;
  return Number(parts[2] + parts[1].padStart(2, '0') + parts[0].padStart(2, '0')) || 99999999;
}

// Returns a sheet owned by this module, creating it with its header row when
// missing, so the first deployment needs no manual sheet setup.
function getOrCreateOwnedSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  // These backend-owned sheets may predate new fields such as lot_no/message.
  // Append missing headers without moving or rewriting existing audit data.
  const width = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, width).getValues()[0];
  const columns = getColumnIndexMap(existing);
  const missing = headers.filter(header => columns[header.toUpperCase()] === undefined);
  if (missing.length) {
    sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

// Migrate the prior all-caps LOG sheet name in place so deployment preserves
// every existing ORD status. Two copies are unsafe because they split history.
function getOrCreateOrderStatusSheet(ss) {
  let current = ss.getSheetByName(CONFIG.SHEET_ORD_STATUS);
  const legacy = ss.getSheetByName(CONFIG.LEGACY_SHEET_ORD_STATUS);
  if (current && legacy && current.getSheetId() !== legacy.getSheetId()) {
    throw new Error(`พบทั้งชีต ${CONFIG.SHEET_ORD_STATUS} และ ${CONFIG.LEGACY_SHEET_ORD_STATUS} กรุณารวมข้อมูลก่อน`);
  }
  // Some Sheets lookups may match names without respecting capitalization;
  // normalize the visible tab name even when both lookups return one object.
  if (current && current.getName() !== CONFIG.SHEET_ORD_STATUS) {
    current.setName(CONFIG.SHEET_ORD_STATUS);
  }
  if (!current && legacy) {
    legacy.setName(CONFIG.SHEET_ORD_STATUS);
    current = legacy;
  }
  return getOrCreateOwnedSheet(ss, CONFIG.SHEET_ORD_STATUS, ORD_STATUS_HEADERS);
}

// Reads an owned sheet (header on row 1) and maps headers case-insensitively.
function readOwnedSheet(sheet) {
  const values = sheet.getDataRange().getValues();
  return {
    values: values,
    columns: getColumnIndexMap(values[0] || [])
  };
}

// Builds a row in the sheet's current column order from a {header: value} map.
function buildRowByHeaders(columns, width, record) {
  const row = new Array(width).fill('');
  Object.keys(record).forEach(header => {
    const index = columns[header.toUpperCase()];
    if (index !== undefined) row[index] = record[header];
  });
  return row;
}

function assertOwnedColumns(columns, headers, sheetName) {
  const missing = headers.filter(header => columns[header.toUpperCase()] === undefined);
  if (missing.length) {
    throw new Error(`ชีต ${sheetName} ไม่มีคอลัมน์: ${missing.join(', ')}`);
  }
}

// ------------------------------------------------------------
// Reading ORDs and status
// ------------------------------------------------------------

// Reads DATA : Current ORD (header row CONFIG.ORD_HEADER_ROW) and merges rows
// with the same ord_id + product_code into one requirement by summing quantity.
// Duplicate product lines happen for paid + free lines of the same SKU.
function readCurrentOrders(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_ORD);
  if (!sheet) throw new Error(`ไม่พบชีต ${CONFIG.SHEET_ORD}`);

  const timeZone = ss.getSpreadsheetTimeZone();
  const values = sheet.getDataRange().getValues();
  const headerIndex = CONFIG.ORD_HEADER_ROW - 1;
  const columns = getColumnIndexMap(values[headerIndex] || []);
  ['ORD_ID', 'PRODUCT_CODE', 'QUANTITY'].forEach(header => {
    if (columns[header] === undefined) throw new Error(`ชีต ${CONFIG.SHEET_ORD} ไม่มีคอลัมน์ ${header.toLowerCase()}`);
  });

  const orders = new Map();
  for (let i = headerIndex + 1; i < values.length; i++) {
    const row = values[i];
    const ordId = String(getColumnValue(row, columns, 'ORD_ID', '')).trim();
    const productCode = String(getColumnValue(row, columns, 'PRODUCT_CODE', '')).trim();
    const quantity = parseSheetNumber(getColumnValue(row, columns, 'QUANTITY', ''));
    // Rows without an ORD, SKU, or positive quantity cannot be allocated.
    if (!ordId || !productCode || !(quantity > 0)) continue;

    if (!orders.has(ordId)) {
      orders.set(ordId, {
        ordId: ordId,
        orderDate: formatOrderDate(getColumnValue(row, columns, 'ORDER_DATE', ''), timeZone),
        customer: String(getColumnValue(row, columns, 'CUSTOMER', '')).trim(),
        lines: new Map()
      });
    }

    const order = orders.get(ordId);
    const line = order.lines.get(productCode);
    if (line) {
      line.requiredQty += quantity;
    } else {
      order.lines.set(productCode, {
        productCode: productCode,
        productName: String(getColumnValue(row, columns, 'PRODUCT_NAME', '')).trim(),
        unit: String(getColumnValue(row, columns, 'UNIT', '')).trim(),
        requiredQty: quantity
      });
    }
  }
  return orders;
}

function serializeOrder(order) {
  return {
    ordId: order.ordId,
    orderDate: order.orderDate,
    customer: order.customer,
    lines: Array.from(order.lines.values())
  };
}

// Read every populated AES Team row by header name. actor_id is the submitted
// identity; the Thai full name and nickname are the worker-facing label.
function readAesTeamWorkers(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_AES_TEAM);
  if (!sheet) throw new Error(`ไม่พบชีต ${CONFIG.SHEET_AES_TEAM}`);
  const values = sheet.getDataRange().getDisplayValues();
  const headerIndex = CONFIG.AES_TEAM_HEADER_ROW - 1;
  const columns = getColumnIndexMap(values[headerIndex] || []);
  ['ACTOR_ID', 'FULL_NAME', 'NICKNAME'].forEach(header => {
    if (columns[header] === undefined) {
      throw new Error(`ชีต ${CONFIG.SHEET_AES_TEAM} ไม่มีคอลัมน์ ${header.toLowerCase()}`);
    }
  });

  const workers = [];
  const seenIds = new Set();
  for (let i = headerIndex + 1; i < values.length; i++) {
    const row = values[i];
    const actorId = String(getColumnValue(row, columns, 'ACTOR_ID', '')).trim();
    const fullName = String(getColumnValue(row, columns, 'FULL_NAME', '')).trim();
    const nickname = String(getColumnValue(row, columns, 'NICKNAME', '')).trim();
    if (!actorId && !fullName && !nickname) continue;
    if (!actorId || !fullName) {
      throw new Error(`ชีต ${CONFIG.SHEET_AES_TEAM} แถว ${i + 1} ต้องมี actor_id และ full_name`);
    }
    if (seenIds.has(actorId)) {
      throw new Error(`ชีต ${CONFIG.SHEET_AES_TEAM} มี actor_id ซ้ำ: ${actorId}`);
    }
    seenIds.add(actorId);
    workers.push({
      actorId: actorId,
      fullName: fullName,
      nickname: nickname,
      label: nickname ? `${fullName} (${nickname})` : fullName
    });
  }
  workers.sort((a, b) => a.label.localeCompare(b.label, 'th'));
  return workers;
}

// Reads the status sheet into a Map keyed by ord_id. If the owner ever leaves
// duplicate rows for one ord_id, the lowest row wins.
function readOrderStatusMap(statusSheet) {
  const { values, columns } = readOwnedSheet(statusSheet);
  assertOwnedColumns(columns, ORD_STATUS_HEADERS, CONFIG.SHEET_ORD_STATUS);

  const statusMap = new Map();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const ordId = String(getColumnValue(row, columns, 'ORD_ID', '')).trim();
    if (!ordId) continue;
    statusMap.set(ordId, {
      sheetRow: i + 1,
      timestamp: getColumnValue(row, columns, 'TIMESTAMP', ''),
      status: String(getColumnValue(row, columns, 'STATUS', '')).trim().toUpperCase(),
      user: String(getColumnValue(row, columns, 'USER', '')).trim(),
      message: String(getColumnValue(row, columns, 'MESSAGE', '')).trim(),
      pickers: String(getColumnValue(row, columns, 'PICKERS', '')).trim()
    });
  }
  return { statusMap: statusMap, columns: columns, width: (values[0] || []).length };
}

function isOrderLocked(statusEntry) {
  return Boolean(statusEntry) &&
    (statusEntry.status === ORD_STATUS.PENDING ||
      statusEntry.status === ORD_STATUS.COMPLETED ||
      statusEntry.status === ORD_STATUS.EXCEPTION);
}

function getHoldMilliseconds() {
  return CONFIG.ORD_HOLD_HOURS * 60 * 60 * 1000;
}

// ------------------------------------------------------------
// API: getOfficeOrders
// ------------------------------------------------------------

// Returns ORDs that still need allocation, every valid AES Team worker, and
// PENDING/EXCEPTION ORDs waiting for deduction or correction.
function getOfficeOrders() {
  const ss = openWarehouseSpreadsheet();
  const timeZone = ss.getSpreadsheetTimeZone();
  const orders = readCurrentOrders(ss);
  const statusSheet = getOrCreateOrderStatusSheet(ss);
  const { statusMap } = readOrderStatusMap(statusSheet);
  const workers = readAesTeamWorkers(ss);

  const available = Array.from(orders.values())
    .filter(order => !isOrderLocked(statusMap.get(order.ordId)))
    .map(serializeOrder)
    .sort((a, b) => orderDateSortKey(a.orderDate) - orderDateSortKey(b.orderDate) || a.ordId.localeCompare(b.ordId));

  const pending = [];
  statusMap.forEach((entry, ordId) => {
    if (entry.status !== ORD_STATUS.PENDING && entry.status !== ORD_STATUS.EXCEPTION) return;
    const submittedAt = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
    const dueAt = new Date(submittedAt.getTime() + getHoldMilliseconds());
    const order = orders.get(ordId);
    pending.push({
      ordId: ordId,
      customer: order ? order.customer : '',
      user: entry.user,
      pickers: entry.pickers,
      status: entry.status,
      message: entry.message,
      submittedAt: formatThaiDateTime(submittedAt, timeZone),
      dueAt: entry.status === ORD_STATUS.PENDING ? formatThaiDateTime(dueAt, timeZone) : '',
      dueTime: entry.status === ORD_STATUS.PENDING ? dueAt.getTime() : Number.MAX_SAFE_INTEGER
    });
  });
  pending.sort((a, b) => a.dueTime - b.dueTime);

  return {
    success: true,
    data: { orders: available, pending: pending, workers: workers, holdHours: CONFIG.ORD_HOLD_HOURS }
  };
}

// ------------------------------------------------------------
// API: getOrderLocationChoices
// ------------------------------------------------------------

// Product metadata from DATA : Current Stock, used by the office page's
// add-new-location form (the existing `assign` action needs type and brand).
function readStockMeta(ss, productCodes) {
  const meta = {};
  const sheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  if (!sheet) return meta;

  const values = sheet.getDataRange().getValues();
  const headerIndex = CONFIG.STOCK_HEADER_ROW - 1;
  const columns = getColumnIndexMap(values[headerIndex] || []);
  for (let i = headerIndex + 1; i < values.length; i++) {
    const code = String(getColumnValue(values[i], columns, 'PRODUCT CODE', '')).trim();
    if (!productCodes.has(code) || meta[code]) continue;
    meta[code] = {
      unit: String(getColumnValue(values[i], columns, 'UNIT', '')).trim(),
      brand: String(getColumnValue(values[i], columns, 'BRAND', '')).trim(),
      type: String(getColumnValue(values[i], columns, 'PRODUCT TYPE', '')).trim()
    };
  }
  return meta;
}

// Returns ACTIVE location choices plus valid positive-Remaining Lots per SKU.
// Existing location Lots stay read-only; blank locations use the Lot dropdown.
function getOrderLocationChoices(payload) {
  const requested = Array.isArray(payload.productCodes) ? payload.productCodes : [];
  const productCodes = new Set(requested.map(code => String(code || '').trim()).filter(Boolean));
  if (!productCodes.size || productCodes.size > 300) {
    return { success: false, message: 'รายการรหัสสินค้าไม่ถูกต้อง' };
  }

  const ss = openWarehouseSpreadsheet();
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!stateSheet) return { success: false, message: 'ไม่พบชีตตำแหน่งสินค้า' };

  const values = stateSheet.getDataRange().getValues();
  const columns = getColumnIndexMap(values[0] || []);
  const choices = {};
  productCodes.forEach(code => { choices[code] = []; });

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const sku = String(getColumnValue(row, columns, 'SKU_ID', '')).trim();
    if (!productCodes.has(sku) || !isActiveLocationRow(row, columns)) continue;
    const qty = Number(getColumnValue(row, columns, 'QTY', 0)) || 0;
    if (qty <= 0) continue;
    choices[sku].push({
      locationId: String(getColumnValue(row, columns, 'LOCATION_ID', '')).trim(),
      location: String(getColumnValue(row, columns, 'DISPLAY_LOC', '')).trim(),
      lotNo: String(getColumnValue(row, columns, 'LOT_NO', '')).trim(),
      qty: qty
    });
  }

  Object.keys(choices).forEach(code => {
    choices[code].sort((a, b) => a.location.localeCompare(b.location));
  });

  return {
    success: true,
    data: {
      choices: choices,
      lots: getPositiveLotChoicesByProduct(ss, productCodes),
      meta: readStockMeta(ss, productCodes)
    }
  };
}

// ------------------------------------------------------------
// API: submitOrderAllocation
// ------------------------------------------------------------

// Validates the payload shape before taking the lock. Returns an error message
// or null. Business checks against live data happen inside the lock.
function validateAllocationPayloadShape(ordId, lines, allocations, pickerIds) {
  if (!ordId) return 'ไม่พบเลข ORD';
  if (!Array.isArray(lines) || !lines.length) return 'ไม่พบรายการสินค้าใน ORD';
  if (!Array.isArray(allocations) || !allocations.length) return 'ยังไม่ได้เลือกพิกัด';
  if (allocations.length > 500) return 'จำนวนพิกัดมากเกินไป';
  if (!Array.isArray(pickerIds) || !pickerIds.length) return 'กรุณาเลือกผู้จัดสินค้าอย่างน้อย 1 คน';
  if (pickerIds.length > 100) return 'จำนวนผู้จัดสินค้ามากเกินไป';

  // Duplicate or blank actor IDs are malformed even though the UI prevents
  // them; backend validation keeps direct API requests safe.
  const cleanPickerIds = pickerIds.map(id => String(id || '').trim());
  if (cleanPickerIds.some(id => !id) || new Set(cleanPickerIds).size !== cleanPickerIds.length) {
    return 'ข้อมูลผู้จัดสินค้าไม่ถูกต้อง';
  }

  const seenLocations = new Set();
  for (const item of allocations) {
    const locationId = String(item.locationId || '').trim();
    const amount = Number(item.amount);
    const lotNo = String(item.lotNo || '').trim();
    if (!String(item.productCode || '').trim() || !locationId) return 'ข้อมูลพิกัดไม่ครบ';
    if (!Number.isFinite(amount) || amount <= 0) return 'จำนวนที่เบิกต้องมากกว่า 0';
    // The browser submits existing and selected Lots as text so leading zeroes
    // survive; the live State/Stock By Lot checks below remain authoritative.
    if (lotNo && !/^\d{1,20}$/.test(lotNo)) return 'Lot Number ต้องเป็นตัวเลขไม่เกิน 20 หลัก';
    // One location belongs to one SKU, so a location may appear only once.
    if (seenLocations.has(locationId)) return 'เลือกพิกัดซ้ำในใบเบิกเดียวกัน';
    seenLocations.add(locationId);
  }
  return null;
}

// The page must submit exactly the SKUs and required quantities it was shown.
// If DATA : Current ORD changed since then, the admin must reload.
function orderMatchesSubmittedLines(order, lines) {
  if (order.lines.size !== lines.length) return false;
  return lines.every(line => {
    const current = order.lines.get(String(line.productCode || '').trim());
    return current && roundQty(current.requiredQty) === roundQty(line.requiredQty);
  });
}

function readStateRowsById(stateSheet) {
  const values = stateSheet.getDataRange().getValues();
  const columns = getColumnIndexMap(values[0] || []);
  const rowsById = new Map();
  for (let i = 1; i < values.length; i++) {
    const id = String(getColumnValue(values[i], columns, 'LOCATION_ID', '')).trim();
    if (id) rowsById.set(id, { index: i, row: values[i] });
  }
  return { values: values, columns: columns, rowsById: rowsById };
}

// Saves the admin's location choices for a whole ORD and marks it PENDING.
// Stock is not deducted here; processDueOrderAllocations does that after the
// hold. Every check runs under the script lock and nothing is written unless
// all checks pass.
function submitOrderAllocation(payload) {
  const ordId = String(payload.ordId || '').trim();
  const lines = payload.lines;
  const allocations = payload.allocations;
  const pickerIds = payload.pickerIds;
  const shapeError = validateAllocationPayloadShape(ordId, lines, allocations, pickerIds);
  if (shapeError) return { success: false, message: shapeError };

  const userEmail = getCurrentUserEmail();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = openWarehouseSpreadsheet();

    // Resolve submitted IDs against the live team table and save canonical,
    // human-readable identity snapshots rather than trusting browser labels.
    const workerMap = new Map(readAesTeamWorkers(ss).map(worker => [worker.actorId, worker]));
    const selectedWorkers = pickerIds.map(id => workerMap.get(String(id).trim()));
    if (selectedWorkers.some(worker => !worker)) {
      return { success: false, message: 'รายชื่อผู้จัดสินค้ามีการเปลี่ยนแปลง กรุณาโหลดใหม่' };
    }
    const pickersValue = selectedWorkers
      .map(worker => `${worker.actorId} — ${worker.label}`)
      .join('; ');

    const order = readCurrentOrders(ss).get(ordId);
    if (!order) return { success: false, message: `ไม่พบ ${ordId} ใน ${CONFIG.SHEET_ORD} กรุณาโหลดใหม่` };
    if (!orderMatchesSubmittedLines(order, lines)) {
      return { success: false, code: 'ORDER_CHANGED', message: 'ORD นี้มีการเปลี่ยนแปลง กรุณาโหลดใหม่' };
    }

    // A locked ORD cannot be submitted again. This also makes double-clicks
    // and uncertain network retries safe.
    const statusSheet = getOrCreateOrderStatusSheet(ss);
    const statusInfo = readOrderStatusMap(statusSheet);
    const existingStatus = statusInfo.statusMap.get(ordId);
    if (isOrderLocked(existingStatus)) {
      return { success: false, code: 'ALREADY_SUBMITTED', message: `${ordId} ถูกยืนยันไปแล้ว` };
    }

    const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    if (!stateSheet) return { success: false, message: 'ไม่พบชีตตำแหน่งสินค้า' };
    const state = readStateRowsById(stateSheet);
    // Blank State rows may receive only Lots currently listed with positive
    // Remaining for their SKU; the dropdown is convenience, this is security.
    const validLotsByProduct = getPositiveLotChoicesByProduct(ss, new Set(order.lines.keys()));

    // Each chosen location must exist, be ACTIVE, belong to the SKU, and hold
    // at least the chosen amount right now.
    const allocatedBySku = new Map();
    const allocationRecords = [];
    for (const item of allocations) {
      const productCode = String(item.productCode).trim();
      const locationId = String(item.locationId).trim();
      const amount = Number(item.amount);
      const line = order.lines.get(productCode);
      if (!line) return { success: false, message: `${productCode} ไม่อยู่ใน ${ordId}` };

      const found = state.rowsById.get(locationId);
      if (!found || !isActiveLocationRow(found.row, state.columns)) {
        return { success: false, message: `พิกัดของ ${productCode} ไม่พร้อมใช้งาน กรุณาโหลดพิกัดใหม่` };
      }
      const sku = String(getColumnValue(found.row, state.columns, 'SKU_ID', '')).trim();
      if (sku !== productCode) {
        return { success: false, message: `พิกัดที่เลือกไม่ใช่ของ ${productCode}` };
      }
      const location = String(getColumnValue(found.row, state.columns, 'DISPLAY_LOC', '')).trim();
      const available = Number(getColumnValue(found.row, state.columns, 'QTY', 0)) || 0;
      if (amount > available) {
        return {
          success: false,
          message: `${productCode} พิกัด ${location} มีเพียง ${available} แต่เลือกเบิก ${amount} กรุณาเติมจำนวนพิกัดก่อน`
        };
      }

      const currentLot = String(getColumnValue(found.row, state.columns, 'LOT_NO', '')).trim();
      const submittedLot = String(item.lotNo || '').trim();
      let effectiveLot = currentLot;
      if (currentLot) {
        if (submittedLot && submittedLot !== currentLot) {
          return { success: false, message: `Lot ของพิกัด ${location} เปลี่ยนแล้ว กรุณาโหลดพิกัดใหม่` };
        }
      } else {
        const validLots = validLotsByProduct[productCode] || [];
        if (!submittedLot || !validLots.some(option => option.lotNo === submittedLot)) {
          return { success: false, message: `กรุณาเลือก Lot ที่มียอดคงเหลือสำหรับ ${productCode}` };
        }
        effectiveLot = submittedLot;
      }

      allocatedBySku.set(productCode, (allocatedBySku.get(productCode) || 0) + amount);
      allocationRecords.push({
        product_code: productCode,
        product_name: line.productName,
        location_id: locationId,
        location: location,
        amount: amount,
        lot_no: effectiveLot
      });
    }

    // Every SKU in the ORD must be allocated exactly: no partial ORDs.
    for (const line of order.lines.values()) {
      const allocated = roundQty(allocatedBySku.get(line.productCode) || 0);
      if (allocated !== roundQty(line.requiredQty)) {
        return {
          success: false,
          message: `${line.productCode} ต้องเบิก ${line.requiredQty} แต่เลือกไว้ ${allocated}`
        };
      }
    }

    const timestamp = nowToWholeSecond();

    // 1) Allocation rows first, in one batch. If the status write below fails,
    //    these rows have no matching PENDING row and are never deducted.
    const allocationSheet = getOrCreateOwnedSheet(ss, CONFIG.SHEET_ORD_ALLOCATION, ORD_ALLOCATION_HEADERS);
    const allocationInfo = readOwnedSheet(allocationSheet);
    assertOwnedColumns(allocationInfo.columns, ORD_ALLOCATION_HEADERS, CONFIG.SHEET_ORD_ALLOCATION);
    const allocationWidth = (allocationInfo.values[0] || []).length;
    const allocationRows = allocationRecords.map(record => buildRowByHeaders(
      allocationInfo.columns,
      allocationWidth,
      Object.assign({ timestamp: timestamp, ord_id: ordId }, record)
    ));
    allocationSheet
      .getRange(allocationSheet.getLastRow() + 1, 1, allocationRows.length, allocationWidth)
      .setValues(allocationRows);

    // 2) One status row per ORD: overwrite a CANCELED row, or append a new one.
    const statusRow = buildRowByHeaders(statusInfo.columns, statusInfo.width, {
      timestamp: timestamp,
      ord_id: ordId,
      status: ORD_STATUS.PENDING,
      user: userEmail,
      message: '',
      pickers: pickersValue
    });
    const targetRow = existingStatus ? existingStatus.sheetRow : statusSheet.getLastRow() + 1;
    statusSheet.getRange(targetRow, 1, 1, statusInfo.width).setValues([statusRow]);
    SpreadsheetApp.flush();

    const dueAt = new Date(timestamp.getTime() + getHoldMilliseconds());
    return {
      success: true,
      ordId: ordId,
      dueAt: formatThaiDateTime(dueAt, ss.getSpreadsheetTimeZone())
    };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// API: cancelOrderAllocation
// ------------------------------------------------------------

// Cancels a PENDING ORD during the hold. No stock changes. The status row keeps
// its submit timestamp; status becomes CANCELED and user becomes the canceler.
function cancelOrderAllocation(payload) {
  const ordId = String(payload.ordId || '').trim();
  if (!ordId) return { success: false, message: 'ไม่พบเลข ORD' };

  const userEmail = getCurrentUserEmail();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = openWarehouseSpreadsheet();
    const statusSheet = getOrCreateOrderStatusSheet(ss);
    const { statusMap, columns } = readOrderStatusMap(statusSheet);
    const entry = statusMap.get(ordId);
    if (!entry || (entry.status !== ORD_STATUS.PENDING && entry.status !== ORD_STATUS.EXCEPTION)) {
      return { success: false, message: `${ordId} ไม่ได้อยู่ในสถานะรอตัดสต็อก/ตรวจสอบ จึงยกเลิกไม่ได้` };
    }

    statusSheet.getRange(entry.sheetRow, columns.STATUS + 1).setValue(ORD_STATUS.CANCELED);
    statusSheet.getRange(entry.sheetRow, columns.USER + 1).setValue(userEmail);
    if (columns.MESSAGE !== undefined) statusSheet.getRange(entry.sheetRow, columns.MESSAGE + 1).setValue('');
    return { success: true, ordId: ordId };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// Timed trigger: processDueOrderAllocations
// ------------------------------------------------------------

// Appends audit rows to MAIN : Log ข้อมูลตำแหน่ง in one batch, using the same
// columns as logTransaction().
function appendLocationLogRows(ss, rows) {
  if (!rows.length) return;
  let logSheet = ss.getSheetByName('MAIN : Log ข้อมูลตำแหน่ง');
  if (!logSheet) {
    logSheet = ss.insertSheet('MAIN : Log ข้อมูลตำแหน่ง');
    logSheet.appendRow(['LOG_ID', 'วันเวลา', 'อีเมลผู้บันทึก', 'ประเภทรายการ', 'รหัสสินค้า', 'จำนวนที่เปลี่ยน', 'จากพิกัด', 'ไปพิกัด', 'เอกสารอ้างอิง']);
  }
  logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// Groups allocation rows by ord_id + submit second, so only the rows from the
// ORD's current submission are deducted (rows from canceled tries are ignored).
function readAllocationGroups(allocationSheet) {
  const { values, columns } = readOwnedSheet(allocationSheet);
  assertOwnedColumns(columns, ORD_ALLOCATION_HEADERS, CONFIG.SHEET_ORD_ALLOCATION);
  const groups = new Map();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const ordId = String(getColumnValue(row, columns, 'ORD_ID', '')).trim();
    const key = `${ordId}|${toSecondKey(getColumnValue(row, columns, 'TIMESTAMP', ''))}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      productCode: String(getColumnValue(row, columns, 'PRODUCT_CODE', '')).trim(),
      locationId: String(getColumnValue(row, columns, 'LOCATION_ID', '')).trim(),
      location: String(getColumnValue(row, columns, 'LOCATION', '')).trim(),
      amount: Number(getColumnValue(row, columns, 'AMOUNT', 0)) || 0,
      lotNo: String(getColumnValue(row, columns, 'LOT_NO', '')).trim()
    });
  }
  return groups;
}

// Runs from a time-driven trigger (see installOrderDeductionTrigger). For each
// ORD that has been PENDING for CONFIG.ORD_HOLD_HOURS, deducts the chosen
// locations and marks the ORD COMPLETED.
//
// If a location now holds less than the chosen amount (workers may have picked
// during the hold), it is deducted to 0 and the shortfall is written in the log.
// A location that reaches 0 becomes INACTIVE_EMPTY; rows are never deleted.
function processDueOrderAllocations() {
  const lock = LockService.getScriptLock();
  // Worker actions share this lock. If it is busy, the next run retries.
  if (!lock.tryLock(30000)) {
    console.warn('processDueOrderAllocations: lock busy, will retry next run');
    return;
  }

  try {
    const ss = openWarehouseSpreadsheet();
    // Ensure newly introduced message/lot_no columns exist before the trigger
    // reads older backend-owned sheets.
    const statusSheet = getOrCreateOrderStatusSheet(ss);
    const allocationSheet = getOrCreateOwnedSheet(ss, CONFIG.SHEET_ORD_ALLOCATION, ORD_ALLOCATION_HEADERS);
    const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    if (!stateSheet) return;

    const { statusMap, columns: statusColumns } = readOrderStatusMap(statusSheet);
    const cutoff = Date.now() - getHoldMilliseconds();
    const due = [];
    statusMap.forEach((entry, ordId) => {
      if (entry.status !== ORD_STATUS.PENDING) return;
      const submittedAt = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
      if (!isNaN(submittedAt.getTime()) && submittedAt.getTime() <= cutoff) {
        due.push({ ordId: ordId, entry: entry });
      }
    });
    if (!due.length) return;

    const groups = readAllocationGroups(allocationSheet);
    const state = readStateRowsById(stateSheet);
    const qtyColumn = state.columns.QTY;
    const lotColumn = state.columns.LOT_NO;
    if (qtyColumn === undefined) throw new Error('ชีตตำแหน่งสินค้าไม่มีคอลัมน์ QTY');
    if (lotColumn === undefined) throw new Error('ชีตตำแหน่งสินค้าไม่มีคอลัมน์ LOT_NO');
    // Validate reconciliation destinations before any ORD is marked complete.
    getLotReconciliationLogSheet(ss);

    due.forEach(({ ordId, entry }) => {
      const items = groups.get(`${ordId}|${toSecondKey(entry.timestamp)}`) || [];
      if (!items.length) {
        // Nothing to deduct means the allocation rows are missing. Leave it
        // PENDING so the admin sees it and can cancel and redo the ORD.
        console.warn(`processDueOrderAllocations: no allocation rows for ${ordId}`);
        return;
      }

      // A Lot changed during the hold must never be overwritten. Treat the
      // whole ORD as an exception so no subset is deducted silently.
      let conflictMessage = '';
      items.forEach(item => {
        if (conflictMessage) return;
        const found = state.rowsById.get(item.locationId);
        if (!found || !isActiveLocationRow(found.row, state.columns)) {
          conflictMessage = `${item.productCode} พิกัด ${item.location} ไม่อยู่ในสถานะใช้งาน`;
          return;
        }
        const currentLot = String(found.row[lotColumn] || '').trim();
        const pendingLot = String(item.lotNo || '').trim();
        if (!pendingLot && !currentLot) {
          conflictMessage = `${item.productCode} พิกัด ${item.location} ไม่มี Lot ที่ยืนยันไว้`;
        } else if (currentLot && pendingLot && currentLot !== pendingLot) {
          conflictMessage = `${item.productCode} พิกัด ${item.location} เปลี่ยนเป็น Lot ${currentLot} แล้ว`;
        }
      });
      if (conflictMessage) {
        statusSheet.getRange(entry.sheetRow, statusColumns.STATUS + 1).setValue(ORD_STATUS.EXCEPTION);
        if (statusColumns.MESSAGE !== undefined) {
          statusSheet.getRange(entry.sheetRow, statusColumns.MESSAGE + 1).setValue(conflictMessage);
        }
        console.warn(`processDueOrderAllocations: ${ordId} exception: ${conflictMessage}`);
        return;
      }

      // Plan every quantity and Lot change in memory first.
      const changes = [];
      const logRows = [];
      const affectedLotPairs = new Map();
      items.forEach(item => {
        const found = state.rowsById.get(item.locationId);
        const currentQty = Number(found.row[qtyColumn]) || 0;
        const currentLot = String(found.row[lotColumn] || '').trim();
        const effectiveLot = currentLot || String(item.lotNo || '').trim();
        const deducted = Math.min(item.amount, Math.max(currentQty, 0));
        const shortfall = item.amount - deducted;
        const newQty = roundQty(currentQty - deducted);

        // Keep the in-memory row current in case two due ORDs share a location.
        found.row[qtyColumn] = newQty;
        found.row[lotColumn] = effectiveLot;
        changes.push({
          sheetRow: found.index + 1,
          newQty: newQty,
          assignedLot: currentLot ? '' : effectiveLot,
          becameEmpty: newQty === 0
        });
        affectedLotPairs.set(lotReconciliationKey(item.productCode, effectiveLot), {
          productCode: item.productCode,
          lotNo: effectiveLot
        });

        const reference = `${ordId} AUTO` + (shortfall > 0 ? ` (ขาด ${shortfall} จากที่เลือก ${item.amount})` : '');
        logRows.push([
          Utilities.getUuid().substring(0, 8),
          new Date(),
          entry.user,
          'เบิกตาม ORD (ORD_PICK)',
          item.productCode,
          -deducted,
          item.location,
          '-',
          reference
        ]);
      });

      // Mark COMPLETED before touching stock: if a later write fails, the ORD
      // is under-deducted (visible in the log) instead of deducted twice by
      // the next trigger run.
      statusSheet.getRange(entry.sheetRow, statusColumns.STATUS + 1).setValue(ORD_STATUS.COMPLETED);
      if (statusColumns.MESSAGE !== undefined) statusSheet.getRange(entry.sheetRow, statusColumns.MESSAGE + 1).setValue('');
      SpreadsheetApp.flush();

      changes.forEach(change => {
        // Option A: a confirmed Lot applies to the entire previously blank row,
        // while only the ORD allocation quantity is deducted.
        if (change.assignedLot) {
          stateSheet.getRange(change.sheetRow, lotColumn + 1).setValue(change.assignedLot);
        }
        stateSheet.getRange(change.sheetRow, qtyColumn + 1).setValue(change.newQty);
        if (change.becameEmpty) {
          setLocationLifecycle(stateSheet, change.sheetRow, LOCATION_STATUS.INACTIVE_EMPTY, entry.user, `เบิกตาม ${ordId} จนหมดพิกัด`);
        }
      });
      appendLocationLogRows(ss, logRows);
      SpreadsheetApp.flush();
      affectedLotPairs.forEach(pair => reconcileLotPair(ss, pair.productCode, pair.lotNo));
    });
  } finally {
    lock.releaseLock();
  }
}

// Run once from the Apps Script editor after deployment. Creates the
// 15-minute trigger for processDueOrderAllocations and removes any duplicate.
// Not exposed through doPost.
function installOrderDeductionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'processDueOrderAllocations')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('processDueOrderAllocations')
    .timeBased()
    .everyMinutes(15)
    .create();
  return 'Installed processDueOrderAllocations every 15 minutes';
}
