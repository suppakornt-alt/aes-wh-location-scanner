// Google Apps Script web-app entry point, authentication, and request router.

const CONFIG = {
  SS_URL: "https://docs.google.com/spreadsheets/d/13WHZ_2FOI1lKgla9vZT5uy0oF2wbObbI3XmzMgyNlf4/edit?gid=698384415#gid=698384415",
  SHEET_STATE: 'MAIN : ตำแหน่งสินค้าทั้งหมด',
  SHEET_STOCK: 'DATA : Current Stock',
  STOCK_HEADER_ROW: 6,
  SHEET_LOT: 'DATA : Stock By Lot',
  LOT_HEADER_ROW: 6,
  // Append-only snapshots of ACTIVE State quantity versus Stock By Lot Remaining.
  SHEET_LOT_RECONCILIATION: 'MAIN : Log เทียบ Lot สินค้าหน้างานกับในระบบ',
  // Office warehouse ORD allocation (docs/OFFICE_WAREHOUSE.md).
  // DATA : Current ORD is read-only input; its header is on physical row 6.
  SHEET_ORD: 'DATA : Current ORD',
  ORD_HEADER_ROW: 6,
  // Every valid row in this row-1-header table may prepare an office ORD.
  SHEET_AES_TEAM: 'DATA : AES Team',
  AES_TEAM_HEADER_ROW: 1,
  // One row per ord_id with its current allocation status.
  SHEET_ORD_STATUS: 'MAIN : Log ORD ที่ยืนยันพิกัดแล้ว',
  // Preserve existing ORD history when the capitalization change is deployed.
  LEGACY_SHEET_ORD_STATUS: 'MAIN : LOG ORD ที่ยืนยันพิกัดแล้ว',
  // One row per location chosen for a submitted ORD.
  SHEET_ORD_ALLOCATION: 'MAIN : Log พิกัดจาก ORD',
  // Hours a submitted ORD waits for customer cancellation before stock is cut.
  ORD_HOLD_HOURS: 4,
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

      // Office warehouse ORD allocation. Stock is deducted later by the
      // processDueOrderAllocations trigger, never by these actions.
      case 'getOfficeOrders':
        result = getOfficeOrders();
        break;

      case 'getOrderLocationChoices':
        result = getOrderLocationChoices(payload);
        break;

      case 'submitOrderAllocation':
        result = submitOrderAllocation(payload);
        break;

      case 'cancelOrderAllocation':
        result = cancelOrderAllocation(payload);
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
