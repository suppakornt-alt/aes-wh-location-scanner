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
}

function appendActiveLocationRow(sheet, rowValues, userEmail) {
  const sheetRow = appendRowAtRealLastRow(sheet, rowValues);
  setLocationLifecycle(sheet, sheetRow, LOCATION_STATUS.ACTIVE, userEmail, '');
  return sheetRow;
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
