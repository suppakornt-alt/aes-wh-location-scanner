// ==========================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================
let masterStaffItems = [], masterAuditItems = [], masterCatalog = [];
let currentTheme = APP_CONFIG.defaultTheme, currentView = 'scanner';
const currentUserEmail = APP_CONFIG.currentUserEmail;
const { tileSize: TILE_SIZE, levelHeight: LEVEL_HEIGHT, gap: GAP } = WAREHOUSE_CONFIG;
const DESKTOP_MIN = APP_CONFIG.desktopMinWidth;

// ==========================================
// 2. UTILITY & HELPER FUNCTIONS
// ==========================================
const icon = (name, cls = 'ic ic-sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
function esc(value) { 
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); 
}
const isDesktop = () => window.innerWidth >= DESKTOP_MIN;

function openSidebar() { 
  document.getElementById('sidebar').classList.add('open'); 
  document.getElementById('scrim').classList.add('show'); 
}
function closeSidebar() { 
  document.getElementById('sidebar').classList.remove('open'); 
  document.getElementById('scrim').classList.remove('show'); 
}
function closeSidebarIfMobile() { if (!isDesktop()) closeSidebar(); }
function toggleAccordion(contentId, arrowId) { 
  document.getElementById(contentId)?.classList.toggle('collapsed'); 
  document.getElementById(arrowId)?.classList.toggle('collapsed'); 
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  Warehouse3D.setTheme(currentTheme);
}

async function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  ['scanner', '3d', 'ops', 'audit'].forEach(v => document.getElementById(`view-${v}`).style.display = v === viewName ? 'block' : 'none');
  document.getElementById('page-title').innerText = VIEW_TITLES[viewName];
  document.getElementById('tools-3d').style.display = viewName === '3d' ? 'block' : 'none';
  hideDetail();

  if (viewName === '3d') resizeRenderer();
  else if (viewName === 'audit' && masterAuditItems.length === 0) await loadAuditData();
  
  if (viewName !== 'scanner') stopScanner(); 
  closeSidebarIfMobile();
}

// ==========================================
// 3. 3D VISUALIZATION ENGINE (THREE.JS)
// ==========================================
// ==========================================
// 4. THREE.JS MODULE ADAPTERS
// app.js keeps these small wrappers so existing HTML handlers continue to work.
// ==========================================
function toggleHeatmapMode() { Warehouse3D.toggleHeatmapMode(); }
function filterByCriteria(key) { Warehouse3D.filterByCriteria(key); }
function filterByType(type) { Warehouse3D.filterByType(type); }
function initThree() { Warehouse3D.init(currentTheme); }
function resizeRenderer() { Warehouse3D.resize(); }
function renderWarehouse(sheetData) { Warehouse3D.render(sheetData); }
function hideDetail() { Warehouse3D.hideDetail(); }
function searchSKU() {
  Warehouse3D.search(document.getElementById('search-input')?.value || '');
}
function resetSearch() { Warehouse3D.resetSearch(); }

// ==========================================
// 5. COMMON UI BUILDERS & LIST RENDERERS
// ==========================================
function locRowHTML(loc, sku, unit) {
  const currentLot = loc.lotNo ? esc(loc.lotNo) : '';
  const lotLabel = currentLot ? `LOT: ${currentLot}` : `+ ระบุ Lot`;
  const emptyClass = currentLot ? '' : 'lot-pill-empty';

  const attrs = `data-loc="${esc(loc.locId)}" data-sku="${esc(sku)}" data-qty="${esc(loc.qty)}" data-unit="${esc(unit)}" data-lot="${currentLot}"`;

  return `
    <div class="loc-pill-item">
      <div class="loc-info" style="display:flex; flex-direction:column; align-items:flex-start; gap:2px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="loc-pill-text">${icon('pin')} ${esc(loc.displayLoc || loc.code)}</span>
          <span class="loc-pill-qty">${esc(loc.qty)} ${esc(unit)}</span>
        </div>
        <div class="loc-meta-sub">
          <button type="button" class="lot-pill-editable ${emptyClass}" data-act="edit-lot" ${attrs} title="แตะเพื่อแก้ไข Lot (ไม่เกิน 7 หลัก)">
            <svg class="ic" style="width:12px; height:12px;"><use href="#i-edit"/></svg>
            <span class="lot-val">${lotLabel}</span>
          </button>
        </div>
      </div>
      <div class="action-btn-group">
        <button class="btn-op btn-in" data-act="in" ${attrs}>${icon('plus')} เติม</button>
        <button class="btn-op btn-out" data-act="out" ${attrs}>${icon('minus')} เบิก</button>
        <button class="btn-op btn-relocate" data-act="move" ${attrs}>${icon('swap')} ย้าย</button>
      </div>
    </div>
  `;
}

function renderStaffList(list) {
  const c = document.getElementById('stock-list-container'); 
  if (!c) return;
  c.innerHTML = '';
  if (!list || !list.length) { 
    c.innerHTML = '<div class="empty-state">ไม่พบรายการสินค้า</div>'; 
    return; 
  }
  const grouped = {}; 
  list.forEach(i => { 
    const t = i.type || 'อื่นๆ', k = i.name || i.sku; 
    if (!grouped[t]) grouped[t] = {}; 
    if (!grouped[t][k]) grouped[t][k] = { name: k, sku: i.sku, locations: [], unit: i.unit }; 
    grouped[t][k].locations.push(i); 
  });

  Object.keys(grouped).sort().forEach(t => {
    const b = document.createElement('div'); 
    b.className = 'type-group-block'; 
    b.innerHTML = `<div class="type-group-header"><div class="type-title-badge">${esc(t)}</div></div>`;
    Object.values(grouped[t]).forEach(p => {
      const pCard = document.createElement('div'); 
      pCard.className = 'prod-name-card';
      pCard.innerHTML = `
        <div class="prod-top"><div class="prod-name-title">${esc(p.name)}</div></div>
        <div class="prod-meta-subtitle"><span>SKU: ${esc(p.sku)}</span></div>
        <div class="loc-pills-container">${p.locations.map(l => locRowHTML(l, p.sku, p.unit)).join('')}</div>
      `;
      b.appendChild(pCard);
    });
    c.appendChild(b);
  });
}

function filterOpsList() {
  const q = (document.getElementById('ops-filter')?.value || '').trim().toLowerCase();
  if (!q) { renderStaffList(masterStaffItems); return; }
  const filtered = masterStaffItems.filter(i => 
    String(i.name || '').toLowerCase().includes(q) || 
    String(i.sku || '').toLowerCase().includes(q) ||
    String(i.lotNo || '').toLowerCase().includes(q)
  );
  renderStaffList(filtered);
}

function renderAuditList(data) {
  const c = document.getElementById('audit-list-container'); 
  if (!c) return;
  c.innerHTML = '';
  let un=0, un_q=0, ov=0;
  data.forEach(i => { 
    if (i.status.includes('UNASSIGNED')) un++; 
    else if (i.status.includes('UNDER')) un_q++; 
    else if (i.status.includes('OVER')) ov++; 
  });
  
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setTxt('kpi-unassigned', un); 
  setTxt('kpi-under', un_q); 
  setTxt('kpi-over', ov);
  
  const summaryBadge = document.getElementById('audit-summary-badge');
  if (summaryBadge) summaryBadge.innerText = `พบข้อมูลไม่ตรงกัน ${data.length} รายการ`;

  if (!data.length) { 
    c.innerHTML = `<div class="empty-state ok">สต็อกตรง 100% (ไม่มีรายการคลาดเคลื่อน)</div>`; 
    return; 
  }
  const b = document.createElement('div'); 
  b.className = 'type-group-block';
  data.forEach(i => {
    const pCard = document.createElement('div'); 
    pCard.className = 'prod-name-card';
    pCard.innerHTML = `
      <div class="prod-top">
        <div class="prod-name-title">${esc(i.name)}</div>
        <span class="audit-badge ${i.status.includes('UNASSIGNED') ? 'badge-unassigned' : 'badge-under'}">${esc(i.status)}</span>
      </div>
      <div class="prod-meta-subtitle">
        <span>SKU: ${esc(i.sku)}</span>
        <span>หมวด: ${esc(i.type)}</span>
        <span>แบรนด์: ${esc(i.brand)}</span>
      </div>
      <div class="audit-summary-line">
        <div class="diff-stats">
          <span><strong>${i.erpQty}</strong><small>ERP</small></span>
          <span><strong>${i.physicalQty}</strong><small>ในคลัง</small></span>
          <span><strong style="color:var(--accent-red)">${i.diff}</strong><small>ส่วนต่าง</small></span>
        </div>
      </div>
    `;
    b.appendChild(pCard);
  });
  c.appendChild(b);
}

function filterAuditList() {
  const q = (document.getElementById('audit-filter')?.value || '').trim().toLowerCase();
  if (!q) { renderAuditList(masterAuditItems); return; }
  const filtered = masterAuditItems.filter(i => 
    String(i.name || '').toLowerCase().includes(q) || 
    String(i.sku || '').toLowerCase().includes(q)
  );
  renderAuditList(filtered);
}

// ==========================================
// 5. EVENT DELEGATION & ACTION HANDLERS
// ==========================================
function handleListAction(e) {
  const btn = e.target.closest('[data-act]'); 
  if (!btn) return;
  const { act, loc, sku, qty, unit, lot } = btn.dataset;
  
  if (act === 'in' || act === 'out') {
    handleStockAction(act, loc, sku, unit, Number(qty));
  } else if (act === 'move') {
    openRelocateModal(loc, sku, Number(qty), unit);
  } else if (act === 'edit-lot') {
    promptEditLot(loc, sku, lot);
  }
}

async function handleStockAction(actionType, locId, sku, unit, maxQty = 0) {
  const isDark = currentTheme === 'dark';
  const actionLabel = actionType === 'in' ? 'เติมเข้า' : 'เบิกออก';
  
  const { value: qtyStr } = await Swal.fire({
    title: `${actionLabel}สต็อก`,
    html: `
      <div style="text-align:left; font-size:15px; line-height:1.6; color:var(--text-muted); margin-bottom:8px;">
        <strong>SKU:</strong> ${esc(sku)}<br>
        <strong>คงเหลือปัจจุบัน:</strong> ${maxQty} ${esc(unit)}
      </div>
    `,
    input: 'number',
    inputLabel: `กรอกจำนวนที่ต้องการ (${esc(unit)})`,
    inputValue: '1',
    inputAttributes: { min: 1, step: 1 },
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก',
    background: isDark ? '#161b22' : '#ffffff',
    color: isDark ? '#e6edf3' : '#1f2328',
    confirmButtonColor: actionType === 'in' ? '#238636' : '#da3633',
    cancelButtonColor: '#30363d',
    preConfirm: (val) => {
      const q = parseInt(val, 10);
      if (isNaN(q) || q <= 0) {
        Swal.showValidationMessage('กรุณากรอกจำนวนที่ถูกต้อง (มากกว่า 0)');
        return false;
      }
      if (actionType === 'out' && q > maxQty) {
        Swal.showValidationMessage(`ยอดเบิกเกินจำนวนคงเหลือ (สูงสุด ${maxQty} ${unit})`);
        return false;
      }
      return q;
    }
  });

  if (!qtyStr) return;

  Swal.fire({ 
    title: 'กำลังบันทึกข้อมูล...', 
    didOpen: () => Swal.showLoading(), 
    allowOutsideClick: false, 
    background: isDark ? '#161b22' : '#fff', 
    color: isDark ? '#e6edf3' : '#1f2328' 
  });

  const res = await safeFetch(actionType === 'in' ? 'add' : 'pick', { locId, qty: qtyStr });
  
  if (res && res.success) {
    Swal.fire({ icon: 'success', title: 'สำเร็จ', timer: 1200, showConfirmButton: false });
    loadData();
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot')?.textContent;
      if (activeLot && activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else { 
    Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res ? res.message : 'API Failed' }); 
  }
}

// Inline Lot Edit with <= 7 Digits Rule
async function promptEditLot(locId, sku, currentLot) {
  const isDark = currentTheme === 'dark';
  const { value: newLot } = await Swal.fire({
    title: 'แก้ไข Lot Number',
    html: `
      <div style="text-align:left; font-size:15px; line-height:1.6; color:var(--text-muted); margin-bottom:8px;">
        <strong>SKU:</strong> ${esc(sku)}<br>
        <strong>Lot เดิม:</strong> ${currentLot ? esc(currentLot) : '<em>(ยังไม่ระบุ)</em>'}
      </div>
    `,
    input: 'text',
    inputLabel: 'ระบุ Lot Number ใหม่ (ความยาวไม่เกิน 7 หลัก)',
    inputValue: currentLot || '',
    inputPlaceholder: 'เช่น 2410069',
    inputAttributes: {
      maxlength: 15,
      autocapitalize: 'off',
      autocorrect: 'off'
    },
    showCancelButton: true,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก',
    background: isDark ? '#161b22' : '#ffffff',
    color: isDark ? '#e6edf3' : '#1f2328',
    confirmButtonColor: '#238636',
    cancelButtonColor: '#30363d',
    preConfirm: (val) => {
      const clean = (val || '').trim();
      if (clean.length > 7) {
        Swal.showValidationMessage(`Lot Number ห้ามเกิน 7 หลัก (ปัจจุบัน ${clean.length} หลัก)`);
        return false;
      }
      return clean;
    }
  });

  if (newLot === undefined) return;

  Swal.fire({
    title: 'กำลังอัปเดต Lot...',
    didOpen: () => Swal.showLoading(),
    allowOutsideClick: false,
    background: isDark ? '#161b22' : '#ffffff',
    color: isDark ? '#e6edf3' : '#1f2328'
  });

  const res = await safeFetch('updateLot', { locId, newLot });

  if (res && res.success) {
    Swal.fire({
      icon: 'success',
      title: 'อัปเดต Lot สำเร็จ',
      timer: 1200,
      showConfirmButton: false,
      background: isDark ? '#161b22' : '#ffffff',
      color: isDark ? '#e6edf3' : '#1f2328'
    });

    loadData();
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot')?.textContent;
      if (activeLot && activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: res ? res.message : 'API Failed',
      background: isDark ? '#161b22' : '#ffffff',
      color: isDark ? '#e6edf3' : '#1f2328'
    });
  }
}

// ==========================================
// 6. COORDINATE DROPDOWNS & RELOCATE MODAL
// ==========================================
function initCoordDropdowns() {
  const cols = [];
  for (let i = 1; i <= 60; i++) {
    let num = i, s = "";
    while (num > 0) {
      const rem = (num - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      num = Math.floor((num - 1) / 26);
    }
    cols.push(s);
  }

  ['relocate-col-start', 'relocate-col-end', 'add-col-start', 'add-col-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = cols.map(c => `<option value="${c}">เสา ${c}</option>`).join('');
  });

  const rowOptions = Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  ['relocate-row-start', 'relocate-row-end', 'add-row-start', 'add-row-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = rowOptions;
  });

  const link = (startId, endId) => {
    const startEl = document.getElementById(startId);
    if (startEl) {
      startEl.onchange = (e) => {
        const endEl = document.getElementById(endId);
        if (endEl) endEl.value = e.target.value;
      };
    }
  };
  link('relocate-col-start', 'relocate-col-end');
  link('relocate-row-start', 'relocate-row-end');
  link('add-col-start', 'add-col-end');
  link('add-row-start', 'add-row-end');
}

function toggleLevelBtn(btn) {
  btn.classList.toggle('active');
  if (btn.parentElement.querySelectorAll('.level-sq-btn.active').length === 0) {
    btn.classList.add('active');
  }
}

function getSelectedLevels(containerId) {
  const btns = document.querySelectorAll(`#${containerId} .level-sq-btn.active`);
  return Array.from(btns).map(b => parseInt(b.getAttribute('data-lvl'), 10));
}

function openRelocateModal(locId, sku, currentQty, unitText) {
  const modal = document.getElementById('modal-relocate');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('relocate-loc-id').value = locId;
  document.getElementById('relocate-sku-title').innerText = `${sku} · คงเหลือ ${currentQty} ${unitText}`;
  document.getElementById('relocate-qty').value = currentQty;
  document.getElementById('relocate-qty').setAttribute('max', currentQty);
}

function closeRelocateModal() {
  const modal = document.getElementById('modal-relocate');
  if (modal) modal.style.display = 'none';
}

async function submitRelocate() {
  const locId = document.getElementById('relocate-loc-id').value;
  const qtyToMove = Number(document.getElementById('relocate-qty').value);
  const maxQty = Number(document.getElementById('relocate-qty').getAttribute('max') || Infinity);

  if (!qtyToMove || qtyToMove <= 0 || qtyToMove > maxQty) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกจำนวนที่ถูกต้อง (ไม่เกินยอดคงเหลือ)' });
    return;
  }

  const payload = {
    locId: locId,
    qtyToMove: qtyToMove,
    newColStart: document.getElementById('relocate-col-start').value,
    rowStartNum: Number(document.getElementById('relocate-row-start').value),
    newColEnd: document.getElementById('relocate-col-end').value,
    rowEndNum: Number(document.getElementById('relocate-row-end').value),
    newLevels: getSelectedLevels('level-selector-relocate')
  };

  Swal.fire({
    title: 'กำลังย้ายพิกัด...',
    didOpen: () => Swal.showLoading(),
    allowOutsideClick: false
  });

  const res = await safeFetch('relocate', payload);

  if (res && res.success) {
    closeRelocateModal();
    Swal.fire({ icon: 'success', title: 'ย้ายพิกัดสำเร็จ', timer: 1400, showConfirmButton: false });
    loadData();
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot')?.textContent;
      if (activeLot && activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res ? res.message : 'API Failed' });
  }
}

// ==========================================
// 7. TRUEMONEY-STYLE ADD LOCATION MODAL
// ==========================================
let modalScanRunning = false;
let modalScanner = null;

function switchAddMode(mode) {
  document.getElementById('seg-btn-scan')?.classList.toggle('active', mode === 'scan');
  document.getElementById('seg-btn-type')?.classList.toggle('active', mode === 'type');

  const scanView = document.getElementById('add-mode-scan');
  const typeView = document.getElementById('add-mode-type');
  if (scanView) scanView.style.display = mode === 'scan' ? 'block' : 'none';
  if (typeView) typeView.style.display = mode === 'type' ? 'block' : 'none';

  if (mode !== 'scan') {
    stopModalCamera();
  }
}

function openNewLocationModal() {
  const modal = document.getElementById('modal-add');
  if (!modal) return;
  modal.style.display = 'flex';
  switchAddMode('scan');
  resetAddForm();
}

function closeNewLocationModal() {
  stopModalCamera();
  const modal = document.getElementById('modal-add');
  if (modal) modal.style.display = 'none';
}

function resetAddForm() {
  const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  hide('add-product-preview-card');
  hide('add-lot-field-group');
  
  const submitBtn = document.getElementById('btn-submit-add');
  if (submitBtn) submitBtn.disabled = true;

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('add-manual-lot-input', '');
  setVal('add-final-lot', '');
  setVal('add-qty', '');

  const statusEl = document.getElementById('add-modal-scan-status');
  if (statusEl) statusEl.textContent = 'พร้อมสำหรับการสแกน';
}

async function triggerManualLotLookup() {
  const lotInput = (document.getElementById('add-manual-lot-input')?.value || '').trim();
  if (!lotInput) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอก Lot Number' });
    return;
  }
  if (lotInput.length > 7) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'Lot Number ต้องไม่เกิน 7 หลัก' });
    return;
  }
  await resolveLotForAdd(lotInput);
}

async function resolveLotForAdd(lotCode) {
  Swal.fire({ title: 'กำลังดึงข้อมูล Lot...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
  const res = await safeFetch('lookup', { lot: lotCode });
  Swal.close();

  if (res && res.success && res.data && res.data.productCode && res.data.productCode !== '-') {
    const data = res.data;
    
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('add-preview-name', data.productName);
    setTxt('add-preview-code', data.productCode);
    setTxt('add-preview-type', data.type || 'ยางนอก');
    setTxt('add-preview-brand', data.brand || '-');
    setTxt('add-preview-unit', data.unit || 'ชิ้น');

    const previewCard = document.getElementById('add-product-preview-card');
    if (previewCard) previewCard.style.display = 'block';

    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('add-resolved-sku', data.productCode);
    setVal('add-resolved-name', data.productName);
    setVal('add-resolved-type', data.type || 'ยางนอก');
    setVal('add-resolved-brand', data.brand || '-');
    setVal('add-final-lot', lotCode);

    const fieldGroup = document.getElementById('add-lot-field-group');
    if (fieldGroup) fieldGroup.style.display = 'block';

    const submitBtn = document.getElementById('btn-submit-add');
    if (submitBtn) submitBtn.disabled = false;

    stopModalCamera();
  } else {
    Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: 'ไม่พบรหัสสินค้าที่ตรงกับ Lot ' + lotCode });
  }
}

async function toggleModalCamera() {
  if (modalScanRunning) {
    stopModalCamera();
  } else {
    startModalCamera();
  }
}

async function startModalCamera() {
  const modalVideo = document.getElementById('add-modal-video');
  const toggleBtn = document.getElementById('add-modal-camera-toggle');
  const statusEl = document.getElementById('add-modal-scan-status');

  try {
    modalScanner = BarcodeScanner({
      video: modalVideo,
      requiredMatches: 5,
      pattern: /^\d{7}$/,
      intervalMs: 120,
      onStateChange: isRunning => {
        modalScanRunning = isRunning;
        if (toggleBtn) toggleBtn.textContent = isRunning ? 'ปิดกล้อง' : 'เปิดกล้องสแกน';
      },
      onDetection: ({ code, count, required }) => {
        if (statusEl) statusEl.textContent = `กำลังยืนยัน Lot ${code} (${count}/${required})`;
      },
      onConfirmed: ({ code }) => {
        if (statusEl) statusEl.textContent = `พบ Lot: ${code}`;
        if (navigator.vibrate) navigator.vibrate(100);
        stopModalCamera();
        resolveLotForAdd(code);
      },
      onError: () => {
        if (statusEl) statusEl.textContent = 'เปิดกล้องไม่สำเร็จ';
      }
    });
    if (statusEl) statusEl.textContent = 'หันกล้องไปที่บาร์โค้ด Lot 7 หลัก...';
    await modalScanner.start();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'เปิดกล้องไม่สำเร็จ';
    stopModalCamera();
  }
}

function stopModalCamera() {
  modalScanner?.stop();
  modalScanner = null;
  modalScanRunning = false;
  const toggleBtn = document.getElementById('add-modal-camera-toggle');
  if (toggleBtn) toggleBtn.textContent = 'เปิดกล้องสแกน';
}

async function submitNewLocation() {
  const sku = document.getElementById('add-resolved-sku').value;
  const name = document.getElementById('add-resolved-name').value;
  const type = document.getElementById('add-resolved-type').value;
  const brand = document.getElementById('add-resolved-brand').value;
  const lotNo = (document.getElementById('add-final-lot')?.value || '').trim();
  const qty = Number(document.getElementById('add-qty').value);

  if (lotNo.length > 7) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'Lot Number ต้องมีความยาวไม่เกิน 7 หลัก' });
    return;
  }

  if (!qty || qty <= 0) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกจำนวนที่จัดเก็บมากกว่า 0' });
    return;
  }

  // --- DEFENSIVE ROW PARSER (Guarantees pure integers, never NaN) ---
  const parseSafeRow = (elementId) => {
    const raw = String(document.getElementById(elementId)?.value || '');
    const cleanDigits = raw.replace(/\D/g, ''); // Strips any "แถว", spaces, or symbols
    const parsed = parseInt(cleanDigits, 10);
    return isNaN(parsed) ? 1 : parsed;
  };

  const rStart = parseSafeRow('add-row-start');
  const rEnd = parseSafeRow('add-row-end');

  const payload = {
    sku,
    name,
    type,
    brand,
    lotNo,
    colStartStr: document.getElementById('add-col-start').value || 'A',
    rowStartNum: rStart,
    colEndStr: document.getElementById('add-col-end').value || 'A',
    rowEndNum: rEnd,
    levelsArray: getSelectedLevels('level-selector-add'),
    qty: qty
  };

  console.log("PAYLOAD DISPATCHING:", payload); // Verify in browser console that rStart and rEnd are pure numbers

  Swal.fire({ title: 'กำลังบันทึกพิกัดใหม่...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

  const res = await safeFetch('assign', payload);

  if (res && res.success) {
    closeNewLocationModal();
    Swal.fire({ icon: 'success', title: 'บันทึกพิกัดสำเร็จ', timer: 1400, showConfirmButton: false });
    loadData();
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot')?.textContent;
      if (activeLot && activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res ? res.message : 'API Failed' });
  }
}

// ==========================================
// 8. DATA LOADER ENGINE
// ==========================================
async function loadAuditData() {
  const res = await safeFetch('audit');
  if (res && res.success) { 
    masterAuditItems = res.data; 
    renderAuditList(res.data); 
  }
}

async function loadData() {
  const res3d = await safeFetch('get3D'); 
  if (res3d && res3d.success) renderWarehouse(res3d.data);
  
  const resOps = await safeFetch('getOps'); 
  if (resOps && resOps.success) { 
    masterStaffItems = resOps.data; 
    renderStaffList(resOps.data); 
  }
}

// ==========================================
// 9. PRIMARY SCANNER ENGINE (PAGE LANDING)
// ==========================================
const video = document.getElementById('video');
const toggleBtn = document.getElementById('toggle-btn');
const statusEl = document.getElementById('status');
const resultLotEl = document.getElementById('result-lot');
const manualLotInput = document.getElementById('manual-lot-input');
const manualLotStatus = document.getElementById('manual-lot-status');

let running = false;
let primaryScanner = null;
const LOT_PATTERN = /^\d{7}$/;

function switchPrimaryInputMode(mode) {
  const scanMode = document.getElementById('primary-scan-mode');
  const manualMode = document.getElementById('primary-manual-mode');
  const scanButton = document.getElementById('primary-mode-scan');
  const manualButton = document.getElementById('primary-mode-manual');
  const isScanMode = mode === 'scan';

  if (scanMode) scanMode.style.display = isScanMode ? 'block' : 'none';
  if (manualMode) manualMode.style.display = isScanMode ? 'none' : 'block';
  scanButton?.classList.toggle('active', isScanMode);
  manualButton?.classList.toggle('active', !isScanMode);
  scanButton?.setAttribute('aria-selected', String(isScanMode));
  manualButton?.setAttribute('aria-selected', String(!isScanMode));

  if (!isScanMode) {
    stopScanner();
    if (manualLotStatus) manualLotStatus.textContent = 'กรอกตัวเลข แล้วกดค้นหา';
    manualLotInput?.focus();
  }
}

function lookupManualLot() {
  const lotCode = String(manualLotInput?.value || '').trim();
  if (!/^\d+$/.test(lotCode)) {
    if (manualLotStatus) manualLotStatus.textContent = 'กรุณากรอกตัวเลขเท่านั้น';
    manualLotInput?.focus();
    return;
  }

  if (resultLotEl) resultLotEl.textContent = lotCode;
  if (manualLotStatus) manualLotStatus.textContent = `กำลังค้นหา Lot: ${lotCode}`;
  handleScannerLookup(lotCode);
}

function processRawScan(code, format) {
  onCodeConfirmed(String(code).trim(), format);
}

function onCodeConfirmed(code, format) {
  stopScanner();
  if (resultLotEl) resultLotEl.textContent = code;
  if (statusEl) statusEl.textContent = 'ยืนยันรหัสสำเร็จ!';
  if (navigator.vibrate) navigator.vibrate(100);
  handleScannerLookup(code);
}

async function handleScannerLookup(lotCode) {
  const resCard = document.getElementById('scanner-result-card');
  const invDetails = document.getElementById('scanner-inventory-details');
  if (resCard) resCard.style.display = 'flex';
  if (invDetails) invDetails.style.display = 'none';
  if (statusEl) statusEl.textContent = 'กำลังค้นหาฐานข้อมูล...';
  
  const res = await safeFetch('lookup', { lot: lotCode }); 
  
  if (res && res.success) {
    const data = res.data;
    const headerEl = document.getElementById('scanner-product-header');
    
    if (data.productCode && data.productCode !== '-') {
      if (headerEl) headerEl.textContent = `${data.productCode} | ${data.productName}`;
    } else {
      if (headerEl) headerEl.textContent = `[ไม่พบรหัสสินค้า] | ${data.productName}`;
    }
    
    const locList = document.getElementById('scanner-locations-list');
    if (locList) {
      if (data.locations && data.locations.length > 0) {
        locList.innerHTML = data.locations.map(l => locRowHTML(l, data.productCode, l.unit)).join('');
      } else {
        locList.innerHTML = '<div class="empty-state" style="padding: 20px;">ไม่พบพิกัดจัดเก็บสำหรับสินค้านี้</div>';
      }
    }
    
    if (invDetails) invDetails.style.display = 'block';
    if (statusEl) statusEl.textContent = 'โหลดข้อมูลเสร็จสิ้น';
  } else { 
    if (statusEl) statusEl.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ'; 
  }
}

async function startScanner() {
  stopScanner();
  if (statusEl) statusEl.textContent = 'กำลังเปิดกล้อง...';
  primaryScanner = BarcodeScanner({
    video,
    requiredMatches: 5,
    pattern: LOT_PATTERN,
    onStateChange: isRunning => {
      running = isRunning;
      if (toggleBtn) toggleBtn.textContent = isRunning ? 'ปิดกล้องสแกน' : 'เปิดกล้องสแกน';
    },
    onDetection: ({ count, required }) => {
      if (statusEl) statusEl.textContent = `กำลังยืนยัน... (${count}/${required})`;
    },
    onConfirmed: ({ code, format }) => onCodeConfirmed(code, format),
    onError: () => {
      if (statusEl) statusEl.textContent = 'ไม่สามารถเข้าถึงกล้องได้';
    }
  });
  try {
    await primaryScanner.start();
    if (statusEl) statusEl.textContent = 'หันกล้องไปที่บาร์โค้ด...';
  } catch (_) {}
}

function stopScanner() {
  primaryScanner?.stop();
  primaryScanner = null;
  running = false;
  if (toggleBtn) toggleBtn.textContent = 'เปิดกล้องสแกน';
}

// ==========================================
// 10. SYSTEM INITIALIZATION
// ==========================================
window.onload = () => {
  initCoordDropdowns();
  initThree();

  const bindClick = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bindClick('stock-list-container', handleListAction);
  bindClick('audit-list-container', handleListAction);
  bindClick('scanner-locations-list', handleListAction);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => (running ? stopScanner() : startScanner()));
  }

  loadData();
};
