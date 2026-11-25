// Warehouse write operations and shared mutation helpers.

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

    // Resolve columns by header name: the office page now also uses this
    // action, and header-based access survives column moves in the sheet.
    const qtyColumn = columns.QTY;
    if (qtyColumn === undefined) return { success: false, message: 'ชีตตำแหน่งสินค้าไม่มีคอลัมน์ QTY' };

    for (let i = 1; i < data.length; i++) {
      if (String(getColumnValue(data[i], columns, 'LOCATION_ID', '')).trim() === String(locId).trim()) {
        if (!isActiveLocationRow(data[i], columns)) return { success: false, message: 'พิกัดนี้ไม่ได้เปิดใช้งาน' };
        const currentQty = Number(data[i][qtyColumn]) || 0;
        const newQty = currentQty + addQty;
        sheet.getRange(i + 1, qtyColumn + 1).setValue(newQty);

        logTransaction(
          userEmail,
          'เติมเข้า (IN)',
          getColumnValue(data[i], columns, 'SKU_ID', ''),
          addQty,
          '-',
          getColumnValue(data[i], columns, 'DISPLAY_LOC', ''),
          'เติมสต็อกเดิม'
        );
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
