// Warehouse lookup endpoints and response helpers.

function apiLookupStock(targetSku) {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const stockSheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  
  let productName = `Lot #${targetSku} (New SKU)`;
  let unit = 'เส้น';
  
  if (stockSheet) {
    const stockData = stockSheet.getDataRange().getValues();
    for (let i = CONFIG.STOCK_HEADER_ROW; i < stockData.length; i++) {
      if (String(stockData[i][0]).trim() === targetSku) {
        productName = String(stockData[i][1]);
        unit = String(stockData[i][4] || 'เส้น');
        break;
      }
    }
  }
  
  const locations = [];
  if (stateSheet) {
    const stateData = stateSheet.getDataRange().getValues();
    const stateColumns = getColumnIndexMap(stateData[0] || []);
    for (let i = 1; i < stateData.length; i++) {
      if (!isActiveLocationRow(stateData[i], stateColumns)) continue;
      if (String(stateData[i][1]).trim() === targetSku) {
        locations.push({
          locId: String(stateData[i][0]),
          code: String(stateData[i][15]), // 14 to 15
          qty: Number(stateData[i][6]), // 5 to 6
          unit: unit
        });
      }
    }
  }
  
  return {
    success: true,
    data: {
      name: productName,
      locations: locations.length > 0 ? locations : [{ locId: "RECEIVING-BAY", code: "ยังไม่ระบุพิกัด", qty: 0, unit: unit }]
    }
  };
}

function createJsonResponse(data, statusCode) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiLookupByLot(targetInput) {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const lotSheet = ss.getSheetByName(CONFIG.SHEET_LOT);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const stockSheet = ss.getSheetByName(CONFIG.SHEET_STOCK);
  
  const searchKey = String(targetInput || '').trim();
  let resolvedProductCode = '';
  let resolvedProductName = '';
  let unit = 'ชิ้น';
  let type = 'ยางนอก';
  let brand = '-';
  let productResolved = false;
  let resolvedLotNo = '';
  let resolvedFromLotSheet = false;
  
  // Phase 1: Search Lot Sheet to translate Lot -> Product Code
  if (lotSheet && searchKey) {
    const lotData = lotSheet.getDataRange().getDisplayValues(); 
    for (let i = CONFIG.LOT_HEADER_ROW; i < lotData.length; i++) {
      const rowLot = String(lotData[i][3] || '').trim();  // Col D: Lot No.
      const rowCode = String(lotData[i][0] || '').trim(); // Col A: Product Code
      
      // Match either Lot Number or direct Product Code
      if (rowLot === searchKey || rowCode === searchKey) {
        productResolved = true;
        resolvedFromLotSheet = true;
        resolvedProductCode = rowCode;
        if (rowLot === searchKey) resolvedLotNo = rowLot;
        resolvedProductName = String(lotData[i][1] || '').trim();
        unit = String(lotData[i][2] || 'ชิ้น').trim();
        type = String(lotData[i][11] || 'ยางนอก').trim(); // Col L: Type
        brand = String(lotData[i][12] || '-').trim();     // Col M: Brand
        break;
      }
    }
  }
  
  // If not found in Lot Sheet, searchKey might be a raw Product Code
  if (!resolvedProductCode) {
    resolvedProductCode = searchKey;
  }
  
  const locations = [];
  const cleanupLocations = [];
  let frontlineQty = 0;
  let cleanupQty = 0;
  let erpQty = 0;
  
  // Phase 2: Find ALL locations in State Sheet belonging to this Product Code
  if (stateSheet && resolvedProductCode) {
    const stateData = stateSheet.getDataRange().getDisplayValues(); 
    const stateColumns = getColumnIndexMap(stateData[0] || []);
    for (let i = 1; i < stateData.length; i++) {
      const rowSku = String(stateData[i][1] || '').trim();  // Col B: SKU_ID / Product Code
      const rowLot = String(stateData[i][3] || '').trim();  // Col D: LOT_NO
      const rowName = String(stateData[i][2] || '').trim(); // Col C: Name

      // Active locations remain SKU-wide. Cleanup rows are returned separately
      // only when their Lot exactly matches the scanned/manual Lot.
      const isMatch = (rowSku !== '' && rowSku === resolvedProductCode) || 
                      (searchKey !== '' && rowLot === searchKey);

      if (isMatch) {
        productResolved = true;
        if (rowLot && rowLot === searchKey) {
          resolvedLotNo = rowLot;
          // A State-only Lot must still resolve to its SKU so it can appear as
          // LOT_NOT_FOUND and show matching cleanup rows for investigation.
          if (!resolvedFromLotSheet && rowSku) resolvedProductCode = rowSku;
        }
        if (!resolvedProductName && rowName) {
          resolvedProductName = rowName;
        }

        const rowQty = Number(stateData[i][6]) || 0;
        const rowStatus = getLocationStatus(stateData[i], stateColumns);
        if (rowStatus === LOCATION_STATUS.CLEANUP_REQUIRED) {
          if (resolvedLotNo && rowSku === resolvedProductCode && rowLot === resolvedLotNo) {
            cleanupQty += rowQty;
            cleanupLocations.push({
              locId: String(getColumnValue(stateData[i], stateColumns, 'LOCATION_ID', '')),
              lotNo: rowLot,
              code: String(getColumnValue(stateData[i], stateColumns, 'DISPLAY_LOC', '-')),
              qty: rowQty,
              unit: unit,
              cleanupReason: String(getColumnValue(stateData[i], stateColumns, 'CLOSED_REASON', '') || '')
            });
          }
          continue;
        }
        if (rowStatus !== LOCATION_STATUS.ACTIVE) continue;

        frontlineQty += rowQty;
        locations.push({
          locId: String(stateData[i][0] || ''),
          lotNo: rowLot,                                 // Return Col D lot (blank or filled)
          code: String(stateData[i][15] || '-'),         // Col P: DISPLAY_LOC
          qty: rowQty,                                   // Col G: QTY
          unit: unit,
          displayLoc: String(stateData[i][15] || '-'),
          colNameStart: String(stateData[i][7] || ''),
          colNameEnd: String(stateData[i][8] || ''),
          rowStart: Number(stateData[i][11]) || 0,
          rowEnd: Number(stateData[i][12]) || 0,
          minLvl: Number(stateData[i][13]) || 1,
          maxLvl: Number(stateData[i][14]) || 1,
          lotCheckStatus: String(getColumnValue(stateData[i], stateColumns, 'LOT_CHECK_STATUS', '') || '')
        });
      }
    }
  }

  if (stockSheet && resolvedProductCode) {
    const stockData = stockSheet.getDataRange().getDisplayValues();
    for (let i = CONFIG.STOCK_HEADER_ROW; i < stockData.length; i++) {
      if (String(stockData[i][0] || '').trim() === resolvedProductCode) {
        productResolved = true;
        erpQty += Number(String(stockData[i][2] || '0').replace(/,/g, '')) || 0;
        if (!resolvedProductName) resolvedProductName = String(stockData[i][1] || '').trim();
        unit = String(stockData[i][4] || unit).trim();
        brand = String(stockData[i][5] || brand).trim();
        type = String(stockData[i][6] || type).trim();
      }
    }
  }

  const difference = frontlineQty - erpQty;
  // The Lot result is calculated live for the scanned Lot; persistent State
  // values are refreshed by mutations and the one-time rebuild utility.
  const lotReconciliation = resolvedLotNo && resolvedProductCode
    ? getLotReconciliationSnapshot(ss, resolvedProductCode, resolvedLotNo)
    : null;
  
  return {
    success: true,
    data: {
      lot: searchKey,
      productCode: productResolved ? resolvedProductCode : '-',
      productName: resolvedProductName || 'ไม่พบสินค้าในระบบ',
      type: type,
      brand: brand,
      unit: unit,
      locations: locations,
      cleanupLocations: cleanupLocations,
      lotReconciliation: lotReconciliation,
      reconciliation: {
        frontlineQty: frontlineQty,
        erpQty: erpQty,
        cleanupQty: cleanupQty,
        difference: difference,
        status: difference === 0 ? 'EQUAL' : (difference < 0 ? 'UNDER' : 'OVER')
      }
    }
  };
}

function updateLocationLot(locId, newLot) {
  const cleanLot = String(newLot || '').trim();
  if (cleanLot && !/^\d{1,20}$/.test(cleanLot)) {
    return { success: false, message: 'Lot Number ต้องเป็นตัวเลขไม่เกิน 20 หลัก' };
  }

  const userEmail = getCurrentUserEmail();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
    const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    if (!sheet) return { success: false, message: 'ไม่พบชีตพิกัด' };

    const data = sheet.getDataRange().getValues();
    const columns = getColumnIndexMap(data[0] || []);
    for (let i = 1; i < data.length; i++) {
      if (String(getColumnValue(data[i], columns, 'LOCATION_ID', '')).trim() === String(locId).trim()) {
        const oldLot = String(getColumnValue(data[i], columns, 'LOT_NO', '')).trim();
        const sku = String(getColumnValue(data[i], columns, 'SKU_ID', '')).trim();
        const displayLoc = String(getColumnValue(data[i], columns, 'DISPLAY_LOC', '')).trim();
        const lotColumn = columns.LOT_NO;
        if (lotColumn === undefined) return { success: false, message: 'ชีตพิกัดไม่มีคอลัมน์ LOT_NO' };

        sheet.getRange(i + 1, lotColumn + 1).setValue(cleanLot);
        if (!cleanLot) setValueByHeader(sheet, i + 1, columns, 'LOT_CHECK_STATUS', LOT_CHECK_STATUS.UNASSIGNED);
        SpreadsheetApp.flush();

        logTransaction(
          userEmail,
          'แก้ไข LOT',
          sku,
          0,
          displayLoc,
          displayLoc,
          `เปลี่ยน Lot จาก [${oldLot}] เป็น [${cleanLot}]`
        );

        // Both pairs may have changed totals when a Lot is replaced.
        if (oldLot && oldLot !== cleanLot) reconcileLotPair(ss, sku, oldLot);
        if (cleanLot) reconcileLotPair(ss, sku, cleanLot);
        return { success: true, newLot: cleanLot };
      }
    }
    return { success: false, message: 'ไม่พบ ID พิกัดที่ต้องการแก้ไข' };
  } finally {
    lock.releaseLock();
  }
}
