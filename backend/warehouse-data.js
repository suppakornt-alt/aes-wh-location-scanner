// Warehouse data access, lifecycle helpers, and read models.

// Formula and lifecycle columns may move as new fields are inserted after
// DISPLAY_LOC. Resolve these columns by header name instead of fixed indexes.
function getColumnIndexMap(headerRow) {
  return headerRow.reduce((map, header, index) => {
    const key = String(header || '').trim().toUpperCase();
    if (key) map[key] = index;
    return map;
  }, {});
}

function getColumnValue(row, columnMap, headerName, fallback = '') {
  const index = columnMap[String(headerName).toUpperCase()];
  return index === undefined ? fallback : row[index];
}

const LOCATION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE_EMPTY: 'INACTIVE_EMPTY',
  CLEANUP_REQUIRED: 'CLEANUP_REQUIRED'
});

// Lot reconciliation is independent from LOCATION_STATUS and the owner's
// existing STATUS XLOOKUP column. These values describe only ACTIVE rows.
const LOT_CHECK_STATUS = Object.freeze({
  UNASSIGNED: 'LOT_UNASSIGNED',
  MATCHED: 'LOT_MATCHED',
  MISMATCHED: 'LOT_MISMATCHED',
  NOT_FOUND: 'LOT_NOT_FOUND'
});

const LOT_RECONCILIATION_HEADERS = [
  'PRODUCT_CODE',
  'LOT_NO',
  'STATE_ACTIVE_QTY',
  'STOCK_BY_LOT_REMAINING',
  'DIFFERENCE',
  'LOT_CHECK_STATUS',
  'CHECKED_AT'
];

function getLocationStatus(row, columnMap) {
  return String(getColumnValue(row, columnMap, 'LOCATION_STATUS', '') || '')
    .trim()
    .toUpperCase() || LOCATION_STATUS.ACTIVE;
}

function isActiveLocationRow(row, columnMap) {
  return getLocationStatus(row, columnMap) === LOCATION_STATUS.ACTIVE;
}

function setValueByHeader(sheet, sheetRow, columnMap, headerName, value) {
  const index = columnMap[String(headerName).toUpperCase()];
  if (index !== undefined) sheet.getRange(sheetRow, index + 1).setValue(value);
}

function setLocationLifecycle(sheet, sheetRow, status, userEmail, reason) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columns = getColumnIndexMap(headers);
  const isActive = status === LOCATION_STATUS.ACTIVE;

  setValueByHeader(sheet, sheetRow, columns, 'LOCATION_STATUS', status);
  setValueByHeader(sheet, sheetRow, columns, 'CLOSED_AT', isActive ? '' : new Date());
  setValueByHeader(sheet, sheetRow, columns, 'CLOSED_BY', isActive ? '' : userEmail);
  setValueByHeader(sheet, sheetRow, columns, 'CLOSED_REASON', isActive ? '' : String(reason || ''));
  // Non-active rows are excluded from Lot reconciliation, so their derived
  // Lot status must not remain visible as if it were current.
  if (!isActive) setValueByHeader(sheet, sheetRow, columns, 'LOT_CHECK_STATUS', '');
}

function appendActiveLocationRow(sheet, rowValues, userEmail) {
  const sheetRow = appendRowAtRealLastRow(sheet, rowValues);
  setLocationLifecycle(sheet, sheetRow, LOCATION_STATUS.ACTIVE, userEmail, '');
  // New blank-Lot rows are immediately visible as unassigned; populated Lots
  // are reconciled by the mutation that created them.
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columns = getColumnIndexMap(headers);
  if (!String(rowValues[3] || '').trim()) {
    setValueByHeader(sheet, sheetRow, columns, 'LOT_CHECK_STATUS', LOT_CHECK_STATUS.UNASSIGNED);
  }
  return sheetRow;
}

function roundWarehouseQty(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function parseWarehouseQty(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function lotReconciliationKey(productCode, lotNo) {
  return `${String(productCode || '').trim()}\u0001${String(lotNo || '').trim()}`;
}

// Stock By Lot may contain repeated rows for one product/Lot. The office
// dropdown and reconciliation use their summed current Remaining quantity.
function readStockByLotRemainingMap(ss, requestedProductCodes) {
  const result = new Map();
  const sheet = ss.getSheetByName(CONFIG.SHEET_LOT);
  if (!sheet) return result;

  const values = sheet.getDataRange().getDisplayValues();
  const headerIndex = CONFIG.LOT_HEADER_ROW - 1;
  const columns = getColumnIndexMap(values[headerIndex] || []);
  ['PRODUCT CODE', 'LOT NO.', 'REMAINING'].forEach(header => {
    if (columns[header] === undefined) {
      throw new Error(`ชีต ${CONFIG.SHEET_LOT} ไม่มีคอลัมน์ ${header}`);
    }
  });

  for (let i = headerIndex + 1; i < values.length; i++) {
    const productCode = String(getColumnValue(values[i], columns, 'PRODUCT CODE', '')).trim();
    const lotNo = String(getColumnValue(values[i], columns, 'LOT NO.', '')).trim();
    if (!productCode || !lotNo) continue;
    if (requestedProductCodes && !requestedProductCodes.has(productCode)) continue;

    const key = lotReconciliationKey(productCode, lotNo);
    const existing = result.get(key) || { productCode: productCode, lotNo: lotNo, remaining: 0 };
    existing.remaining = roundWarehouseQty(existing.remaining + parseWarehouseQty(
      getColumnValue(values[i], columns, 'REMAINING', 0)
    ));
    result.set(key, existing);
  }
  return result;
}

// Only positive Remaining Lots are valid choices for assigning a blank State
// row from the office page. Values stay as strings to preserve leading zeroes.
function getPositiveLotChoicesByProduct(ss, productCodes) {
  const grouped = {};
  productCodes.forEach(code => { grouped[code] = []; });
  readStockByLotRemainingMap(ss, productCodes).forEach(entry => {
    if (entry.remaining > 0 && grouped[entry.productCode]) {
      grouped[entry.productCode].push({ lotNo: entry.lotNo, remaining: entry.remaining });
    }
  });
  Object.keys(grouped).forEach(code => {
    grouped[code].sort((a, b) => a.lotNo.localeCompare(b.lotNo, undefined, { numeric: true }));
  });
  return grouped;
}

// Calculates the current Lot result without mutating Sheets. CLEANUP_REQUIRED
// and INACTIVE_EMPTY rows are intentionally excluded from STATE_ACTIVE_QTY.
function getLotReconciliationSnapshot(ss, productCode, lotNo) {
  const cleanProductCode = String(productCode || '').trim();
  const cleanLotNo = String(lotNo || '').trim();
  if (!cleanLotNo) {
    return {
      productCode: cleanProductCode,
      lotNo: '',
      stateActiveQty: 0,
      stockByLotRemaining: 0,
      difference: 0,
      status: LOT_CHECK_STATUS.UNASSIGNED
    };
  }

  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!stateSheet) throw new Error(`ไม่พบชีต ${CONFIG.SHEET_STATE}`);
  const stateValues = stateSheet.getDataRange().getValues();
  const stateColumns = getColumnIndexMap(stateValues[0] || []);
  let stateActiveQty = 0;
  for (let i = 1; i < stateValues.length; i++) {
    const row = stateValues[i];
    if (!isActiveLocationRow(row, stateColumns)) continue;
    if (String(getColumnValue(row, stateColumns, 'SKU_ID', '')).trim() !== cleanProductCode) continue;
    if (String(getColumnValue(row, stateColumns, 'LOT_NO', '')).trim() !== cleanLotNo) continue;
    stateActiveQty += Number(getColumnValue(row, stateColumns, 'QTY', 0)) || 0;
  }
  stateActiveQty = roundWarehouseQty(stateActiveQty);

  const remainingEntry = readStockByLotRemainingMap(ss, new Set([cleanProductCode]))
    .get(lotReconciliationKey(cleanProductCode, cleanLotNo));
  const stockByLotRemaining = remainingEntry ? roundWarehouseQty(remainingEntry.remaining) : 0;
  const difference = roundWarehouseQty(stateActiveQty - stockByLotRemaining);
  const status = !remainingEntry
    ? LOT_CHECK_STATUS.NOT_FOUND
    : difference === 0 ? LOT_CHECK_STATUS.MATCHED : LOT_CHECK_STATUS.MISMATCHED;

  return {
    productCode: cleanProductCode,
    lotNo: cleanLotNo,
    stateActiveQty: stateActiveQty,
    stockByLotRemaining: stockByLotRemaining,
    difference: difference,
    status: status
  };
}

function getLotReconciliationLogSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_LOT_RECONCILIATION);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_LOT_RECONCILIATION);
    sheet.getRange(1, 1, 1, LOT_RECONCILIATION_HEADERS.length).setValues([LOT_RECONCILIATION_HEADERS]);
  }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), LOT_RECONCILIATION_HEADERS.length))
    .getValues()[0];
  const columns = getColumnIndexMap(headers);
  const missing = LOT_RECONCILIATION_HEADERS.filter(header => columns[header] === undefined);
  if (missing.length) {
    throw new Error(`ชีต ${CONFIG.SHEET_LOT_RECONCILIATION} ไม่มีคอลัมน์: ${missing.join(', ')}`);
  }
  return { sheet: sheet, columns: columns, width: headers.length };
}

// Writes the latest status back to every matching ACTIVE State row and appends
// a snapshot to the owner's Lot-comparison log for later investigation.
function reconcileLotPair(ss, productCode, lotNo) {
  const snapshot = getLotReconciliationSnapshot(ss, productCode, lotNo);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const values = stateSheet.getDataRange().getValues();
  const columns = getColumnIndexMap(values[0] || []);
  const statusColumn = columns.LOT_CHECK_STATUS;
  if (statusColumn === undefined) {
    throw new Error(`ชีต ${CONFIG.SHEET_STATE} ไม่มีคอลัมน์ LOT_CHECK_STATUS`);
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const sameProduct = String(getColumnValue(row, columns, 'SKU_ID', '')).trim() === snapshot.productCode;
    const sameLot = String(getColumnValue(row, columns, 'LOT_NO', '')).trim() === snapshot.lotNo;
    if (sameProduct && sameLot && isActiveLocationRow(row, columns)) {
      stateSheet.getRange(i + 1, statusColumn + 1).setValue(snapshot.status);
    }
  }

  if (snapshot.lotNo) {
    const log = getLotReconciliationLogSheet(ss);
    const record = {
      PRODUCT_CODE: snapshot.productCode,
      LOT_NO: snapshot.lotNo,
      STATE_ACTIVE_QTY: snapshot.stateActiveQty,
      STOCK_BY_LOT_REMAINING: snapshot.stockByLotRemaining,
      DIFFERENCE: snapshot.difference,
      LOT_CHECK_STATUS: snapshot.status,
      CHECKED_AT: new Date()
    };
    const output = new Array(log.width).fill('');
    Object.keys(record).forEach(header => { output[log.columns[header]] = record[header]; });
    log.sheet.getRange(log.sheet.getLastRow() + 1, 1, 1, log.width).setValues([output]);
  }
  return snapshot;
}

// Run once after deploying this feature to initialize current State statuses
// and create baseline reconciliation snapshots for every ACTIVE SKU/Lot pair.
function rebuildLotReconciliation() {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) throw new Error(`ไม่พบชีต ${CONFIG.SHEET_STATE}`);
  const values = sheet.getDataRange().getValues();
  const columns = getColumnIndexMap(values[0] || []);
  const statusColumn = columns.LOT_CHECK_STATUS;
  if (statusColumn === undefined) throw new Error(`ชีต ${CONFIG.SHEET_STATE} ไม่มีคอลัมน์ LOT_CHECK_STATUS`);

  // Build every pair and its ACTIVE quantity from one State read so the
  // one-time initializer remains practical for a large warehouse sheet.
  const pairs = new Map();
  const statusValues = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!isActiveLocationRow(row, columns)) {
      statusValues.push(['']);
      continue;
    }
    const productCode = String(getColumnValue(row, columns, 'SKU_ID', '')).trim();
    const lotNo = String(getColumnValue(row, columns, 'LOT_NO', '')).trim();
    if (!lotNo) {
      statusValues.push([LOT_CHECK_STATUS.UNASSIGNED]);
      continue;
    }
    const key = lotReconciliationKey(productCode, lotNo);
    const pair = pairs.get(key) || { productCode: productCode, lotNo: lotNo, stateActiveQty: 0 };
    pair.stateActiveQty = roundWarehouseQty(
      pair.stateActiveQty + parseWarehouseQty(getColumnValue(row, columns, 'QTY', 0))
    );
    pairs.set(key, pair);
    statusValues.push(['']);
  }

  // Compare every pair against one Stock By Lot map, then prepare State and
  // append-only log output in memory before issuing the two batch writes.
  const stockMap = readStockByLotRemainingMap(ss, new Set(Array.from(pairs.values()).map(pair => pair.productCode)));
  const snapshots = new Map();
  pairs.forEach((pair, key) => {
    const remainingEntry = stockMap.get(key);
    const stockByLotRemaining = remainingEntry ? roundWarehouseQty(remainingEntry.remaining) : 0;
    const difference = roundWarehouseQty(pair.stateActiveQty - stockByLotRemaining);
    snapshots.set(key, {
      productCode: pair.productCode,
      lotNo: pair.lotNo,
      stateActiveQty: pair.stateActiveQty,
      stockByLotRemaining: stockByLotRemaining,
      difference: difference,
      status: !remainingEntry
        ? LOT_CHECK_STATUS.NOT_FOUND
        : difference === 0 ? LOT_CHECK_STATUS.MATCHED : LOT_CHECK_STATUS.MISMATCHED
    });
  });

  for (let i = 1; i < values.length; i++) {
    if (!isActiveLocationRow(values[i], columns)) continue;
    const productCode = String(getColumnValue(values[i], columns, 'SKU_ID', '')).trim();
    const lotNo = String(getColumnValue(values[i], columns, 'LOT_NO', '')).trim();
    if (!lotNo) continue;
    statusValues[i - 1][0] = snapshots.get(lotReconciliationKey(productCode, lotNo)).status;
  }
  if (statusValues.length) {
    sheet.getRange(2, statusColumn + 1, statusValues.length, 1).setValues(statusValues);
  }

  if (snapshots.size) {
    const log = getLotReconciliationLogSheet(ss);
    const checkedAt = new Date();
    const logRows = Array.from(snapshots.values()).map(snapshot => {
      const record = {
        PRODUCT_CODE: snapshot.productCode,
        LOT_NO: snapshot.lotNo,
        STATE_ACTIVE_QTY: snapshot.stateActiveQty,
        STOCK_BY_LOT_REMAINING: snapshot.stockByLotRemaining,
        DIFFERENCE: snapshot.difference,
        LOT_CHECK_STATUS: snapshot.status,
        CHECKED_AT: checkedAt
      };
      const output = new Array(log.width).fill('');
      Object.keys(record).forEach(header => { output[log.columns[header]] = record[header]; });
      return output;
    });
    log.sheet.getRange(log.sheet.getLastRow() + 1, 1, logRows.length, log.width).setValues(logRows);
  }
  return { success: true, reconciledPairs: pairs.size };
}

function getWarehouse3DData() {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const stockSheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  if (!stateSheet) return [];

  const metaMap = {};
  if (stockSheet) {
    const stockData = stockSheet.getDataRange().getValues();
    for (let i = CONFIG.STOCK_HEADER_ROW; i < stockData.length; i++) {
      const sku = String(stockData[i][0] || '').trim();
      if (sku) {
        metaMap[sku] = {
          unit: String(stockData[i][4] || 'เส้น').trim(),
          type: String(stockData[i][6] || '').trim()
        };
      }
    }
  }

  const data = stateSheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const stateColumns = getColumnIndexMap(data[0]);

  const boxes = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!isActiveLocationRow(row, stateColumns)) continue;
    const qty = Number(row[6]) || 0; // Shifted from 5 to 6
    if (qty <= 0) continue;

    const sku = String(row[1] || '').trim();
    const meta = metaMap[sku] || { unit: 'เส้น', type: String(row[4] || 'ยางนอก') }; // 3 to 4

    const latestSalesValue = getColumnValue(row, stateColumns, 'LATEST_SALES');
    const latestSales = latestSalesValue instanceof Date ? Utilities.formatDate(latestSalesValue, "GMT+7", "dd/MM/yyyy") : String(latestSalesValue || '-');
    const diffDays = Number(getColumnValue(row, stateColumns, 'DIFF_DAYS')) || 0;
    const criteria = String(getColumnValue(row, stateColumns, 'CRITERIA', 'FAST')).trim().toUpperCase();

    boxes.push({
      locId: String(row[0]),
      sku: sku,
      name: String(row[2]),
      type: meta.type || String(row[4] || 'ยางนอก'),
      brand: String(row[5]),
      qty: qty,
      unit: meta.unit,
      colNameStart: String(row[7]),
      colNameEnd: String(row[8]),
      colStart: Number(row[9]),
      colEnd: Number(row[10]),
      rowStart: Number(row[11]),
      rowEnd: Number(row[12]),
      minLvl: Number(row[13]),
      maxLvl: Number(row[14]),
      displayLoc: String(row[15]),
      latestSales: latestSales,
      diffDays: diffDays,
      criteria: criteria 
    });
  }
  return JSON.parse(JSON.stringify(boxes));
}

function getStaffInventoryList() {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const stockSheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  if (!stateSheet) return [];

  const metaMap = {};
  if (stockSheet) {
    const stockData = stockSheet.getDataRange().getValues();
    for (let i = CONFIG.STOCK_HEADER_ROW; i < stockData.length; i++) {
      const sku = String(stockData[i][0] || '').trim();
      if (sku) {
        metaMap[sku] = {
          unit: String(stockData[i][4] || 'เส้น').trim(),
          type: String(stockData[i][6] || '').trim()
        };
      }
    }
  }

  const data = stateSheet.getDataRange().getValues();
  const stateColumns = getColumnIndexMap(data[0] || []);
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!isActiveLocationRow(r, stateColumns)) continue;
    const qty = Number(r[6]) || 0; // 5 to 6
    if (qty <= 0) continue;

    const sku = String(r[1] || '').trim();
    const meta = metaMap[sku] || { unit: 'เส้น', type: String(r[4] || 'ยางนอก') };

    list.push({
      locId: String(r[0]),
      sku: sku,
      name: String(r[2]),
      type: meta.type || String(r[4] || 'ยางนอก'),
      brand: String(r[5]), // 4 to 5
      qty: qty,
      unit: meta.unit,
      displayLoc: String(r[15]), // 14 to 15
      lotNo: String(r[3] || ''),
      colNameStart: String(r[7] || ''),
      colNameEnd: String(r[8] || ''),
      colStart: Number(r[9]) || 0,
      colEnd: Number(r[10]) || 0,
      rowStart: Number(r[11]) || 0,
      rowEnd: Number(r[12]) || 0,
      minLvl: Number(r[13]) || 1,
      maxLvl: Number(r[14]) || 1,
      locationStatus: getLocationStatus(r, stateColumns),
      criteria: String(getColumnValue(r, stateColumns, 'CRITERIA', 'FAST')).trim().toUpperCase(),
      diffDays: Number(getColumnValue(r, stateColumns, 'DIFF_DAYS')) || 0
    });
  }
  return list;
}

function getMasterProductList() {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const list = [];

  for (let i = CONFIG.STOCK_HEADER_ROW; i < data.length; i++) {
    const row = data[i];
    const sku = String(row[0] || '').trim();
    if (!sku) continue;

    list.push({
      sku: sku,
      name: String(row[1] || '').trim(),
      stock: Number(row[2]) || 0,
      unit: String(row[4] || 'เส้น').trim(),
      brand: String(row[5] || '').trim(),
      type: String(row[6] || 'ยางนอก').trim()
    });
  }
  return list;
}

function getReconciliationData() {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return [];

  const stateMap = {};
  if (stateSheet) {
    const stateData = stateSheet.getDataRange().getValues();
    const stateColumns = getColumnIndexMap(stateData[0] || []);
    for (let i = 1; i < stateData.length; i++) {
      if (!isActiveLocationRow(stateData[i], stateColumns)) continue;
      const sSku = String(stateData[i][1] || '').trim();
      const sQty = Number(stateData[i][6]) || 0; // 5 to 6
      if (!sSku || sQty <= 0) continue;

      if (!stateMap[sSku]) stateMap[sSku] = [];
      stateMap[sSku].push({
        locId: String(stateData[i][0]),
        qty: sQty,
        displayLoc: String(stateData[i][15]) // 14 to 15
      });
    }
  }

  const data = sheet.getDataRange().getValues();
  const discrepancies = [];

  for (let i = CONFIG.STOCK_HEADER_ROW; i < data.length; i++) {
    const row = data[i];
    const sku = String(row[0] || '').trim();
    if (!sku) continue;

    const name = String(row[1] || '').trim();
    const erpQty = Number(row[2]) || 0;
    const unit = String(row[4] || 'เส้น').trim();
    const brand = String(row[5] || '').trim();
    const type = String(row[6] || 'ยางนอก').trim();
    const stateQty = (stateMap[sku] || []).reduce((sum, location) => sum + Number(location.qty || 0), 0);
    const diff = erpQty - stateQty;

    if (diff !== 0) {
      let statusType = 'ขาด (UNDER)';
      if (stateQty === 0) {
        statusType = 'ยังไม่ระบุพิกัด (UNASSIGNED)';
      } else if (diff < 0) {
        statusType = 'เกิน (OVER)';
      }

      discrepancies.push({
        sku: sku,
        name: name,
        brand: brand,
        type: type,
        unit: unit,
        erpQty: erpQty,
        physicalQty: stateQty,
        diff: Math.abs(diff),
        status: statusType,
        locations: stateMap[sku] || []
      });
    }
  }
  return discrepancies;
}
