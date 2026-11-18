// --- 1. CONFIGURATION ---
const CONFIG = {
  SS_URL: "https://docs.google.com/spreadsheets/d/13WHZ_2FOI1lKgla9vZT5uy0oF2wbObbI3XmzMgyNlf4/edit?gid=698384415#gid=698384415",
  SHEET_STATE: 'MAIN : ตำแหน่งสินค้าทั้งหมด',
  SHEET_STOCK: 'DATA : Current Stock',
  STOCK_HEADER_ROW: 6,
  SHEET_LOT: 'DATA : Stock By Lot',
  LOT_HEADER_ROW: 6,
  GOOGLE_CLIENT_ID: '457054725392-m4mrkfmceleivpg8a9f60oqgmg9ufeds.apps.googleusercontent.com',
  ALLOWED_EMAIL_DOMAIN: '@aesen.co.th',
  ALLOWED_EXCEPTION_EMAILS: [
    'fmygoal@gmail.com'
  ]
};

function doGet() {
  return HtmlService.createHtmlOutput("AES Warehouse API Backend is running.");
}

let activeRequestUserEmail = null;

function getCurrentUserEmail() {
  return activeRequestUserEmail || Session.getActiveUser().getEmail() || 'anonymous@mail';
}

function verifyGoogleIdToken(idToken) {
  if (!idToken) return '';

  try {
    const response = UrlFetchApp.fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { muteHttpExceptions: true }
    );

    if (response.getResponseCode() !== 200) return '';

    const claims = JSON.parse(response.getContentText());
    const issuer = String(claims.iss || '');
    const email = String(claims.email || '').trim().toLowerCase();
    const expiresAt = Number(claims.exp || 0);
    const emailVerified = String(claims.email_verified).toLowerCase() === 'true';

    const validIssuer = issuer === 'accounts.google.com' || issuer === 'https://accounts.google.com';
    const validAudience = String(claims.aud || '') === CONFIG.GOOGLE_CLIENT_ID;
    const notExpired = expiresAt > Math.floor(Date.now() / 1000);

    return validIssuer && validAudience && emailVerified && notExpired ? email : '';
  } catch (error) {
    console.error(`Google ID token verification failed: ${error}`);
    return '';
  }
}

// Run this once from the Apps Script editor after deployment to authorize
// UrlFetchApp for Google ID-token verification. It is not exposed by doPost.
function authorizeGoogleTokenVerification() {
  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=invalid',
    { muteHttpExceptions: true }
  );
  return `Google token endpoint responded with HTTP ${response.getResponseCode()}`;
}

function isAllowedUser(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedDomain = CONFIG.ALLOWED_EMAIL_DOMAIN.toLowerCase();
  const exceptionEmails = CONFIG.ALLOWED_EXCEPTION_EMAILS.map(item => String(item).toLowerCase());

  return normalizedEmail.endsWith(normalizedDomain) || exceptionEmails.includes(normalizedEmail);
}

function accessDeniedResponse(email) {
  console.warn(`Blocked unauthorized request from: ${email || 'unknown user'}`);
  return createJsonResponse({
    success: false,
    message: 'ไม่มีสิทธิ์ใช้งานระบบนี้'
  }, 403);
}

// --- 2. CORE LOGIC ---

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

function appendRowAtRealLastRow(sheet, rowValues) {
  const colA = sheet.getRange("A:A").getValues();
  let nextRow = 2; // Default to row 2 if empty
  for (let i = colA.length - 1; i >= 0; i--) {
    if (colA[i][0] !== "" && colA[i][0] !== null && colA[i][0] !== undefined) {
      nextRow = i + 2; // +1 for 0-index offset, +1 for target empty row
      break;
    }
  }
  sheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
  return nextRow;
}

function safeParseInt(val, fallback = 1) {
  if (typeof val === 'number' && !isNaN(val)) return Math.floor(val);
  const clean = String(val || '').replace(/\D/g, '');
  const parsed = parseInt(clean, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function addNewLocation(payload) {
  const { sku, name, brand, type, lotNo, colStartStr, rowStartNum, colEndStr, rowEndNum, levelsArray, qty } = payload;
  const userEmail = getCurrentUserEmail();

  if (!String(sku || '').trim()) return { success: false, message: 'ไม่พบรหัสสินค้า' };
  if (String(lotNo || '').trim() && !/^\d{1,20}$/.test(String(lotNo).trim())) {
    return { success: false, message: 'Lot Number ต้องเป็นตัวเลขไม่เกิน 20 หลัก' };
  }
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
    return { success: false, message: 'จำนวนสินค้าต้องมากกว่า 0' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {

  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);

  const colStartNum = colLetterToNum(colStartStr);
  const colEndNum = colLetterToNum(colEndStr);
  const colMin = Math.min(colStartNum, colEndNum);
  const colMax = Math.max(colStartNum, colEndNum);

  // Strip and sanitize row indices so NaN is structurally impossible
  const rStart = safeParseInt(rowStartNum, 1);
  const rEnd = safeParseInt(rowEndNum, rStart);
  const rowMin = Math.min(rStart, rEnd);
  const rowMax = Math.max(rStart, rEnd);

  const clusters = parseLevelClusters(levelsArray);
  const totalLevels = clusters.reduce((sum, c) => sum + c.span, 0);

  clusters.forEach(cluster => {
    const clusterQty = totalLevels > 0 ? Math.round((Number(qty) * cluster.span) / totalLevels) : Number(qty);
    const displayLevel = cluster.min === cluster.max ? `ชั้น ${cluster.min}` : `ชั้น ${cluster.min}-${cluster.max}`;
    const displayLoc = `${colStartStr}${rowMin}:${colEndStr}${rowMax} (${displayLevel})`;

    const rowData = [
      Utilities.getUuid().substring(0, 8),
      sku,
      name,
      String(lotNo || '').trim(), // Index 3 (Col D): LOT_NO
      type || 'ยางนอก',           // Index 4 (Col E): CATEGORY
      brand || '-',               // Index 5 (Col F): BRAND
      clusterQty,                 // Index 6 (Col G): QTY
      colStartStr,
      colEndStr,
      colMin,
      colMax,
      rowMin,                     // Pure integer (Col L)
      rowMax,                     // Pure integer (Col M)
      cluster.min,
      cluster.max,
      displayLoc
    ];

    appendActiveLocationRow(stateSheet, rowData, userEmail);
  });

  const locSummary = `${colStartStr}${rowMin}:${colEndStr}${rowMax}`;
  logTransaction(userEmail, 'รับเข้า (RECEIVE)', sku, qty, '-', locSummary, `เพิ่มพิกัดใหม่ (Lot: ${lotNo || '-'})`);
  return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function pickStock(locId, qtyToPick) {
  const pickQty = Number(qtyToPick);
  if (!Number.isFinite(pickQty) || pickQty <= 0) return { success: false, message: 'จำนวนเบิกไม่ถูกต้อง' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const userEmail = getCurrentUserEmail();
    const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
    const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    const data = sheet.getDataRange().getValues();
    const columns = getColumnIndexMap(data[0] || []);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(locId)) {
        if (!isActiveLocationRow(data[i], columns)) return { success: false, message: 'พิกัดนี้ไม่ได้เปิดใช้งาน' };
        const currentQty = Number(data[i][6]) || 0;
        if (pickQty > currentQty) return { success: false, message: 'จำนวนเบิกมากกว่ายอดคงเหลือ' };
        const newQty = currentQty - pickQty;

        sheet.getRange(i + 1, 7).setValue(newQty);
        if (newQty === 0) {
          setLocationLifecycle(sheet, i + 1, LOCATION_STATUS.INACTIVE_EMPTY, userEmail, 'เบิกสินค้าจนหมดพิกัด');
        }

        logTransaction(userEmail, 'เบิกออก (PICK)', data[i][1], -pickQty, data[i][15], '-', 'เบิกด่วน');
        return { success: true, remaining: newQty };
      }
    }
    return { success: false, message: 'ไม่พบ ID พิกัดนี้' };
  } finally {
    lock.releaseLock();
  }
}

function addStockIn(locId, qtyToAdd) {
  const addQty = Number(qtyToAdd);
  if (!Number.isFinite(addQty) || addQty <= 0) return { success: false, message: 'จำนวนเติมไม่ถูกต้อง' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const userEmail = getCurrentUserEmail();
    const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
    const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    const data = sheet.getDataRange().getValues();
    const columns = getColumnIndexMap(data[0] || []);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(locId)) {
        if (!isActiveLocationRow(data[i], columns)) return { success: false, message: 'พิกัดนี้ไม่ได้เปิดใช้งาน' };
        const currentQty = Number(data[i][6]) || 0;
        const newQty = currentQty + addQty;
        sheet.getRange(i + 1, 7).setValue(newQty);

        logTransaction(userEmail, 'เติมเข้า (IN)', data[i][1], addQty, '-', data[i][15], 'เติมสต็อกเดิม');
        return { success: true, remaining: newQty };
      }
    }
    return { success: false, message: 'ไม่พบ ID พิกัดนี้' };
  } finally {
    lock.releaseLock();
  }
}

function relocateStock(payload) {
  const {
    locId,
    qtyToMove,
    destinationMode,
    destinationLocId
  } = payload;
  let newColStart = payload.newColStart;
  let rowStartNum = payload.rowStartNum;
  let newColEnd = payload.newColEnd;
  let rowEndNum = payload.rowEndNum;
  let newLevels = payload.newLevels;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const userEmail = getCurrentUserEmail();
    const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
    const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);

    if (!sheet) {
      return {
        success: false,
        message: 'ไม่พบชีตตำแหน่งสินค้า'
      };
    }

    const data = sheet.getDataRange().getValues();
    const columns = getColumnIndexMap(data[0] || []);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(locId).trim()) {
        continue;
      }

      const sheetRow = i + 1;
      if (!isActiveLocationRow(data[i], columns)) {
        return { success: false, message: 'พิกัดต้นทางไม่อยู่ในสถานะใช้งาน' };
      }

      const currentQty = Number(data[i][6]) || 0;
      const moveQty = Number(qtyToMove);

      if (!Number.isFinite(moveQty) || moveQty <= 0) {
        return {
          success: false,
          message: 'จำนวนที่ย้ายไม่ถูกต้อง'
        };
      }

      if (moveQty > currentQty) {
        return {
          success: false,
          message: 'จำนวนที่ย้ายมากกว่าจำนวนคงเหลือ'
        };
      }

      const sku = data[i][1];
      const name = data[i][2];
      const lotNo = data[i][3];
      const type = data[i][4];
      const brand = data[i][5];
      const oldLocDisplay = data[i][15];

      let colStart = String(newColStart || '').trim().toUpperCase();
      let colEnd = String(newColEnd || '').trim().toUpperCase();
      let destinationRowIndex = -1;

      if (destinationMode === 'existing') {
        destinationRowIndex = data.findIndex((row, index) =>
          index > 0 &&
          String(row[0]).trim() === String(destinationLocId || '').trim() &&
          isActiveLocationRow(row, columns)
        );
        if (destinationRowIndex < 1) {
          return { success: false, message: 'ไม่พบพิกัดปลายทางที่เลือก' };
        }
        colStart = String(data[destinationRowIndex][7] || '').trim().toUpperCase();
        colEnd = String(data[destinationRowIndex][8] || '').trim().toUpperCase();
        rowStartNum = data[destinationRowIndex][11];
        rowEndNum = data[destinationRowIndex][12];
        newLevels = [];
        for (let level = Number(data[destinationRowIndex][13]) || 1; level <= (Number(data[destinationRowIndex][14]) || 1); level++) {
          newLevels.push(level);
        }
      } else if (destinationMode === 'same-coordinate') {
        colStart = String(data[i][7] || '').trim().toUpperCase();
        colEnd = String(data[i][8] || '').trim().toUpperCase();
        rowStartNum = data[i][11];
        rowEndNum = data[i][12];
      }

      const colStartNum = colLetterToNum(colStart);
      const colEndNum = colLetterToNum(colEnd);

      const rStart = safeParseInt(rowStartNum, 1);
      const rEnd = safeParseInt(rowEndNum, rStart);

      if (!colStartNum || !colEndNum || rStart <= 0 || rEnd <= 0) {
        return {
          success: false,
          message: 'พิกัดใหม่ไม่ถูกต้อง'
        };
      }

      const colMin = Math.min(colStartNum, colEndNum);
      const colMax = Math.max(colStartNum, colEndNum);
      const rowMin = Math.min(rStart, rEnd);
      const rowMax = Math.max(rStart, rEnd);

      const clusters = parseLevelClusters(newLevels);
      const totalLevels = clusters.reduce(
        (sum, cluster) => sum + cluster.span,
        0
      );

      const isFullMove = moveQty === currentQty;
      const destinationIsSource = colStart === String(data[i][7] || '').trim().toUpperCase() &&
        colEnd === String(data[i][8] || '').trim().toUpperCase() &&
        rowMin === Number(data[i][11]) && rowMax === Number(data[i][12]) &&
        clusters.length === 1 && clusters[0].min === Number(data[i][13]) && clusters[0].max === Number(data[i][14]);
      if (destinationIsSource) {
        return { success: false, message: 'พิกัดปลายทางต้องไม่ใช่พิกัดเดียวกับต้นทาง' };
      }

      sheet.getRange(sheetRow, 7).setValue(currentQty - moveQty);
      if (isFullMove) {
        setLocationLifecycle(sheet, sheetRow, LOCATION_STATUS.INACTIVE_EMPTY, userEmail, 'ย้ายสินค้าออกทั้งหมด');
      }

      const newLocIds = [];
      let remainingMoveQty = moveQty;

      clusters.forEach((cluster, index) => {
        let clusterQty;

        // Make sure the total moved quantity remains exact.
        if (index === clusters.length - 1) {
          clusterQty = remainingMoveQty;
        } else {
          clusterQty = Math.round(
            (moveQty * cluster.span) / totalLevels
          );
          remainingMoveQty -= clusterQty;
        }

        if (clusterQty <= 0) return;

        const displayLevel =
          cluster.min === cluster.max
            ? `ชั้น ${cluster.min}`
            : `ชั้น ${cluster.min}-${cluster.max}`;

        const displayLoc =
          `${colStart}${rowMin}:${colEnd}${rowMax} (${displayLevel})`;

        const mergeIndex = data.findIndex((row, rowIndex) =>
          rowIndex > 0 && rowIndex !== i &&
          isActiveLocationRow(row, columns) &&
          String(row[1] || '').trim() === String(sku).trim() &&
          String(row[3] || '').trim() === String(lotNo || '').trim() &&
          String(row[7] || '').trim().toUpperCase() === colStart &&
          String(row[8] || '').trim().toUpperCase() === colEnd &&
          Number(row[11]) === rowMin && Number(row[12]) === rowMax &&
          Number(row[13]) === cluster.min && Number(row[14]) === cluster.max
        );

        if (mergeIndex > 0) {
          const mergedQty = (Number(data[mergeIndex][6]) || 0) + clusterQty;
          sheet.getRange(mergeIndex + 1, 7).setValue(mergedQty);
          newLocIds.push(String(data[mergeIndex][0]));
          return;
        }

        // Partial moves or additional level clusters require new rows.
        const newLocId = Utilities.getUuid().substring(0, 8);

        const rowData = [
          newLocId,
          sku,
          name,
          lotNo,
          type,
          brand,
          clusterQty,
          colStart,
          colEnd,
          colMin,
          colMax,
          rowMin,
          rowMax,
          cluster.min,
          cluster.max,
          displayLoc
        ];

        appendActiveLocationRow(sheet, rowData, userEmail);
        newLocIds.push(newLocId);
      });

      const newLocSummary =
        `${colStart}${rowMin}:${colEnd}${rowMax}`;

      logTransaction(
        userEmail,
        'ย้ายพิกัด (RELOCATE)',
        sku,
        0,
        oldLocDisplay,
        newLocSummary,
        `${isFullMove ? 'ย้ายทั้งหมด' : 'ย้ายบางส่วน'} ${moveQty} หน่วย จาก locId ${locId}`
      );

      return {
        success: true,
        originalLocId: String(locId),
        newLocIds: newLocIds
      };
    }

    return {
      success: false,
      message: 'ไม่พบ ID พิกัดต้นทาง'
    };

  } catch (error) {
    return {
      success: false,
      message: error.toString()
    };
  } finally {
    lock.releaseLock();
  }
}

function closeLocation(payload) {
  const locId = String(payload.locId || '').trim();
  const mode = String(payload.mode || '').trim();
  const reason = String(payload.reason || '').trim();
  const userEmail = getCurrentUserEmail();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
    const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    if (!sheet) return { success: false, message: 'ไม่พบชีตตำแหน่งสินค้า' };

    const data = sheet.getDataRange().getValues();
    const columns = getColumnIndexMap(data[0] || []);
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== locId) continue;

      const qty = Number(data[i][6]) || 0;
      if (mode === 'empty' && qty !== 0) {
        return { success: false, message: 'พิกัดนี้ยังมีสินค้า กรุณาย้ายทั้งหมดหรือทำเครื่องหมายตรวจสอบ' };
      }
      if (mode === 'cleanup' && !reason) {
        return { success: false, message: 'กรุณาระบุเหตุผลที่ปิดพิกัด' };
      }

      const status = qty === 0 ? LOCATION_STATUS.INACTIVE_EMPTY : LOCATION_STATUS.CLEANUP_REQUIRED;
      setLocationLifecycle(sheet, i + 1, status, userEmail, reason || 'ปิดพิกัดว่าง');
      logTransaction(userEmail, 'ปิดพิกัด (CLOSE)', data[i][1], 0, data[i][15], '-', `${status}: ${reason || 'ปิดพิกัดว่าง'}`);
      return { success: true, status: status, preservedQty: qty };
    }
    return { success: false, message: 'ไม่พบ ID พิกัดนี้' };
  } finally {
    lock.releaseLock();
  }
}

function logTransaction(staffEmail, action, sku, delta, fromLoc, toLoc, docRef) {
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  let logSheet = ss.getSheetByName('MAIN : Log ข้อมูลตำแหน่ง');
  if (!logSheet) {
    logSheet = ss.insertSheet('MAIN : Log ข้อมูลตำแหน่ง');
    logSheet.appendRow(['LOG_ID', 'วันเวลา', 'อีเมลผู้บันทึก', 'ประเภทรายการ', 'รหัสสินค้า', 'จำนวนที่เปลี่ยน', 'จากพิกัด', 'ไปพิกัด', 'เอกสารอ้างอิง']);
  }
  logSheet.appendRow([
    Utilities.getUuid().substring(0, 8),
    new Date(),
    staffEmail,
    action,
    sku,
    delta,
    fromLoc,
    toLoc,
    docRef || '-'
  ]);
}

function colLetterToNum(colStr) {
  let num = 0;
  const s = String(colStr).trim().toUpperCase();
  for (let i = 0; i < s.length; i++) {
    num = num * 26 + (s.charCodeAt(i) - 64);
  }
  return num;
}

function parseLevelClusters(input) {
  let nums = [];
  if (Array.isArray(input)) {
    nums = input.map(Number).filter(n => !isNaN(n));
  } else if (typeof input === 'string') {
    nums = input.split(/[,/]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  } else if (typeof input === 'number') {
    nums = [input];
  }
  if (nums.length === 0) return [{ min: 1, max: 1, span: 1 }];

  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const clusters = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      clusters.push({ min: start, max: prev, span: prev - start + 1 });
      start = sorted[i];
      prev = sorted[i];
    }
  }
  clusters.push({ min: start, max: prev, span: prev - start + 1 });
  return clusters;
}

// --- 3. API ROUTING LOGIC ---

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
  
  // Phase 1: Search Lot Sheet to translate Lot -> Product Code
  if (lotSheet && searchKey) {
    const lotData = lotSheet.getDataRange().getDisplayValues(); 
    for (let i = CONFIG.LOT_HEADER_ROW; i < lotData.length; i++) {
      const rowLot = String(lotData[i][3] || '').trim();  // Col D: Lot No.
      const rowCode = String(lotData[i][0] || '').trim(); // Col A: Product Code
      
      // Match either Lot Number or direct Product Code
      if (rowLot === searchKey || rowCode === searchKey) {
        productResolved = true;
        resolvedProductCode = rowCode;
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

      // Match condition: SKU matches the Product Code OR Row's Lot matches searchKey
      const isMatch = (rowSku !== '' && rowSku === resolvedProductCode) || 
                      (searchKey !== '' && rowLot === searchKey);

      if (isMatch) {
        productResolved = true;
        if (!resolvedProductName && rowName) {
          resolvedProductName = rowName;
        }

        const rowQty = Number(stateData[i][6]) || 0;
        const rowStatus = getLocationStatus(stateData[i], stateColumns);
        if (rowStatus === LOCATION_STATUS.CLEANUP_REQUIRED) cleanupQty += rowQty;
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
          maxLvl: Number(stateData[i][14]) || 1
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
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return { success: false, message: 'ไม่พบชีตพิกัด' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(locId).trim()) {
      const oldLot = String(data[i][3] || '');
      const sku = String(data[i][1]);
      const displayLoc = String(data[i][15]);

      sheet.getRange(i + 1, 4).setValue(cleanLot); // Col D (4)

      logTransaction(
        userEmail,
        'แก้ไข LOT',
        sku,
        0,
        displayLoc,
        displayLoc,
        `เปลี่ยน Lot จาก [${oldLot}] เป็น [${cleanLot}]`
      );

      return { success: true, newLot: cleanLot };
    }
  }
  return { success: false, message: 'ไม่พบ ID พิกัดที่ต้องการแก้ไข' };
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const userEmail = verifyGoogleIdToken(payload.idToken);
    console.log(`AUTH CHECK: ${userEmail || 'TOKEN_REJECTED'}`);
    if (!isAllowedUser(userEmail)) {
      return accessDeniedResponse(userEmail);
    }
    activeRequestUserEmail = userEmail;

    const logPayload = { ...payload };
    delete logPayload.idToken;
    console.log('PAYLOAD RECEIVED:', JSON.stringify(logPayload));

    let result;

    switch (payload.action) {
      case 'authCheck':
        result = { success: true, email: userEmail };
        break;

      case 'lookup':
        result = apiLookupByLot(payload.lot || payload.sku);
        break;

      case 'pick':
        result = pickStock(payload.locId, payload.qty);
        break;

      case 'add':
        result = addStockIn(payload.locId, payload.qty);
        break;

      case 'relocate':
        result = relocateStock(payload);
        break;

      case 'closeLocation':
        result = closeLocation(payload);
        break;

      case 'updateLot':
        result = updateLocationLot(payload.locId, payload.newLot);
        break;

      case 'assign':
        result = addNewLocation(payload);
        break;

      case 'get3D':
        result = {
          success: true,
          data: getWarehouse3DData()
        };
        break;

      case 'getOps':
        result = {
          success: true,
          data: getStaffInventoryList()
        };
        break;

      case 'audit':
        result = {
          success: true,
          data: getReconciliationData()
        };
        break;

      default:
        result = {
          success: false,
          message: 'Unknown Action'
        };
    }

    return createJsonResponse(result, 200);

  } catch (err) {
    console.error('BACKEND ERROR:', err);

    return createJsonResponse({
      success: false,
      message: err.toString()
    }, 500);
  } finally {
    activeRequestUserEmail = null;
  }
}

