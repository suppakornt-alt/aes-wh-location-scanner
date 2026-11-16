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

  const boxes = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const qty = Number(row[6]) || 0; // Shifted from 5 to 6
    if (qty <= 0) continue;

    const sku = String(row[1] || '').trim();
    const meta = metaMap[sku] || { unit: 'เส้น', type: String(row[4] || 'ยางนอก') }; // 3 to 4

    const latestSales = row[16] instanceof Date ? Utilities.formatDate(row[16], "GMT+7", "dd/MM/yyyy") : String(row[16] || '-');
    const diffDays = Number(row[17]) || 0;
    const criteria = String(row[18] || 'FAST').trim().toUpperCase();

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
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
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
      criteria: String(r[18] || 'FAST').trim().toUpperCase(),
      diffDays: Number(r[17]) || 0
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
    for (let i = 1; i < stateData.length; i++) {
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
    const stateQty = Number(row[7]) || 0; 
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

    appendRowAtRealLastRow(stateSheet, rowData);
  });

  const locSummary = `${colStartStr}${rowMin}:${colEndStr}${rowMax}`;
  logTransaction(userEmail, 'รับเข้า (RECEIVE)', sku, qty, '-', locSummary, `เพิ่มพิกัดใหม่ (Lot: ${lotNo || '-'})`);
  return { success: true };
}

function pickStock(locId, qtyToPick) {
  const userEmail = getCurrentUserEmail();
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(locId)) {
      const currentQty = Number(data[i][6]); // 5 to 6
      const newQty = Math.max(0, currentQty - Number(qtyToPick));

      if (newQty === 0) {
        sheet.deleteRow(i + 1);
      } else {
        sheet.getRange(i + 1, 7).setValue(newQty); // 6 to 7 (Column G is 7)
      }

      logTransaction(userEmail, 'เบิกออก (PICK)', data[i][1], -qtyToPick, data[i][15], '-', 'เบิกด่วน'); // 14 to 15
      return { success: true, remaining: newQty };
    }
  }
  return { success: false, message: 'ไม่พบ ID พิกัดนี้' };
}

function addStockIn(locId, qtyToAdd) {
  const userEmail = getCurrentUserEmail();
  const ss = SpreadsheetApp.openByUrl(CONFIG.SS_URL);
  const sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(locId)) {
      const currentQty = Number(data[i][6]); // 5 to 6
      const newQty = currentQty + Number(qtyToAdd);
      sheet.getRange(i + 1, 7).setValue(newQty); // 6 to 7

      logTransaction(userEmail, 'เติมเข้า (IN)', data[i][1], qtyToAdd, '-', data[i][15], 'เติมสต็อกเดิม'); // 14 to 15
      return { success: true, remaining: newQty };
    }
  }
  return { success: false, message: 'ไม่พบ ID พิกัดนี้' };
}

function relocateStock(payload) {
  const {
    locId,
    qtyToMove,
    newColStart,
    rowStartNum,
    newColEnd,
    rowEndNum,
    newLevels
  } = payload;

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

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() !== String(locId).trim()) {
        continue;
      }

      const sheetRow = i + 1;

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

      const colStart = String(newColStart || '').trim().toUpperCase();
      const colEnd = String(newColEnd || '').trim().toUpperCase();

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

      // If only part of the stock moves,
      // keep the original row at its original location.
      if (!isFullMove) {
        sheet.getRange(sheetRow, 7).setValue(currentQty - moveQty);
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

        const displayLevel =
          cluster.min === cluster.max
            ? `ชั้น ${cluster.min}`
            : `ชั้น ${cluster.min}-${cluster.max}`;

        const displayLoc =
          `${colStart}${rowMin}:${colEnd}${rowMax} (${displayLevel})`;

        // For a full move, preserve the original UUID on the first cluster.
        if (isFullMove && index === 0) {
          sheet.getRange(sheetRow, 7, 1, 10).setValues([[
            clusterQty,   // G: QTY
            colStart,     // H: COL_START
            colEnd,       // I: COL_END
            colMin,       // J: COL_START_NUM
            colMax,       // K: COL_END_NUM
            rowMin,       // L: ROW_START
            rowMax,       // M: ROW_END
            cluster.min,  // N: MIN_LEVEL
            cluster.max,  // O: MAX_LEVEL
            displayLoc    // P: DISPLAY_LOC
          ]]);

          newLocIds.push(String(locId));
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

        appendRowAtRealLastRow(sheet, rowData);
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
        `ย้ายจาก locId ${locId}`
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
    for (let i = 1; i < stateData.length; i++) {
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
  
  const searchKey = String(targetInput || '').trim();
  let resolvedProductCode = '';
  let resolvedProductName = '';
  let unit = 'ชิ้น';
  let type = 'ยางนอก';
  let brand = '-';
  
  // Phase 1: Search Lot Sheet to translate Lot -> Product Code
  if (lotSheet && searchKey) {
    const lotData = lotSheet.getDataRange().getDisplayValues(); 
    for (let i = CONFIG.LOT_HEADER_ROW; i < lotData.length; i++) {
      const rowLot = String(lotData[i][3] || '').trim();  // Col D: Lot No.
      const rowCode = String(lotData[i][0] || '').trim(); // Col A: Product Code
      
      // Match either Lot Number or direct Product Code
      if (rowLot === searchKey || rowCode === searchKey) {
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
  
  // Phase 2: Find ALL locations in State Sheet belonging to this Product Code
  if (stateSheet && resolvedProductCode) {
    const stateData = stateSheet.getDataRange().getDisplayValues(); 
    for (let i = 1; i < stateData.length; i++) {
      const rowSku = String(stateData[i][1] || '').trim();  // Col B: SKU_ID / Product Code
      const rowLot = String(stateData[i][3] || '').trim();  // Col D: LOT_NO
      const rowName = String(stateData[i][2] || '').trim(); // Col C: Name

      // Match condition: SKU matches the Product Code OR Row's Lot matches searchKey
      const isMatch = (rowSku !== '' && rowSku === resolvedProductCode) || 
                      (searchKey !== '' && rowLot === searchKey);

      if (isMatch) {
        if (!resolvedProductName && rowName) {
          resolvedProductName = rowName;
        }

        locations.push({
          locId: String(stateData[i][0] || ''),
          lotNo: rowLot,                                 // Return Col D lot (blank or filled)
          code: String(stateData[i][15] || '-'),         // Col P: DISPLAY_LOC
          qty: Number(stateData[i][6]) || 0,             // Col G: QTY
          unit: unit
        });
      }
    }
  }
  
  return {
    success: true,
    data: {
      lot: searchKey,
      productCode: resolvedProductCode || '-',
      productName: resolvedProductName || 'ไม่พบสินค้าในระบบ',
      type: type,
      brand: brand,
      unit: unit,
      locations: locations // Returns all matching locations
    }
  };
}

function updateLocationLot(locId, newLot) {
  const cleanLot = String(newLot || '').trim();
  if (cleanLot.length > 7) {
    return { success: false, message: 'Lot Number ต้องมีความยาวไม่เกิน 7 หลัก' };
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

