// app.js
let scene, camera, renderer, controls, gridHelper, floorMesh;
const items = [];
let masterStaffItems = [], masterAuditItems = [], masterCatalog = [];
let currentTheme = 'dark', currentView = 'scanner';
let activeTypeFilter = null, activeCriteriaFilter = null, isHeatmapMode = false;
let currentUserEmail = 'staff@aes.co.th';

const TILE_SIZE = 1.0, LEVEL_HEIGHT = 0.85, GAP = 0.1, DESKTOP_MIN = 900;
const VIEW_TITLES = { 'scanner': 'สแกนเนอร์บาร์โค้ด', '3d': 'แผนผังคลัง 3D', 'ops': 'จัดการหยิบ / เติม / ย้าย', 'audit': 'ตรวจสอบยอด ERP' };

const CATEGORY_COLORS = { "กระทะ": { hex: 0x2f81f7, css: "#2f81f7" }, "ยางนอก": { hex: 0x238636, css: "#238636" }, "ยางนอกเรเดียล": { hex: 0x238636, css: "#238636" }, "ยางในธรรมชาติ": { hex: 0xe3b341, css: "#e3b341" }, "ยางในบิวทิล": { hex: 0xd29922, css: "#d29922" }, "ยางรอง": { hex: 0xa371f7, css: "#a371f7" }, "ฮ.น้ำมัน": { hex: 0xda3633, css: "#da3633" }, "ฮ.เบ็ดเตล็ด": { hex: 0xdb61a2, css: "#db61a2" } };
const DEFAULT_COLOR = { hex: 0x8b949e, css: "#8b949e" };
const CRITERIA_COLORS = { "FAST": { hex: 0x238636, css: "#238636", label: "FAST · ขายเร็ว" }, "MEDIUM": { hex: 0xe3b341, css: "#e3b341", label: "MEDIUM · ปานกลาง" }, "SLOW": { hex: 0xf0883e, css: "#f0883e", label: "SLOW · เริ่มช้า" }, "DEAD": { hex: 0xda3633, css: "#da3633", label: "DEAD · สต็อกนิ่ง" } };

const icon = (name, cls = 'ic ic-sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
const isDesktop = () => window.innerWidth >= DESKTOP_MIN;

// --- Sidebar & UI ---
function openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
function closeSidebarIfMobile() { if (!isDesktop()) closeSidebar(); }
function toggleAccordion(contentId, arrowId) { document.getElementById(contentId)?.classList.toggle('collapsed'); document.getElementById(arrowId)?.classList.toggle('collapsed'); }

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  if (scene) { scene.background.setHex(currentTheme === 'dark' ? 0x0d1117 : 0xf4f6f8); updateGridAndFloor(); }
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

// --- 3D Coloring & Filters ---
function getCategoryColor(type) { const t = String(type).trim(); return CATEGORY_COLORS[t] ? CATEGORY_COLORS[t].hex : DEFAULT_COLOR.hex; }
function getCriteriaColor(crit) { const key = String(crit || 'FAST').trim().toUpperCase(); return CRITERIA_COLORS[key] ? CRITERIA_COLORS[key].hex : CRITERIA_COLORS["FAST"].hex; }

function toggleHeatmapMode() {
  isHeatmapMode = !isHeatmapMode;
  document.getElementById('heatmap-toggle-btn').classList.toggle('active', isHeatmapMode);
  document.getElementById('heatmap-label').innerText = isHeatmapMode ? 'ปิด Heatmap' : 'เปิด Heatmap';
  applyCurrentColoring();
  closeSidebarIfMobile();
}
function applyCurrentColoring() {
  items.forEach(box => {
    box.material.color.setHex(isHeatmapMode ? getCriteriaColor(box.userData.criteria) : box.userData.originalColor);
    box.material.opacity = 0.85; box.userData.edgeLine.material.opacity = 0.8;
  });
}
function dimOrHighlight(box, match) {
  if (match) {
    box.material.color.setHex(isHeatmapMode ? getCriteriaColor(box.userData.criteria) : box.userData.originalColor);
    box.material.opacity = 1.0; box.userData.edgeLine.material.opacity = 1.0;
  } else {
    box.material.color.setHex(0x333333); box.material.opacity = 0.15; box.userData.edgeLine.material.opacity = 0.05;
  }
}
function filterByCriteria(key) { activeCriteriaFilter = activeCriteriaFilter === key ? null : key; activeTypeFilter = null; items.forEach(box => dimOrHighlight(box, !activeCriteriaFilter || String(box.userData.criteria).toUpperCase() === activeCriteriaFilter)); closeSidebarIfMobile(); }
function filterByType(type) { activeTypeFilter = activeTypeFilter === type ? null : type; activeCriteriaFilter = null; items.forEach(box => { const t = String(box.userData.type).trim(); dimOrHighlight(box, !activeTypeFilter || (type === 'อื่นๆ' ? !CATEGORY_COLORS[t] : t === type)); }); closeSidebarIfMobile(); }

function renderLegend() {
  const container = document.getElementById('legend-list'); container.innerHTML = '';
  const add = (label, css, fn) => { const el = document.createElement('div'); el.className = 'legend-item'; el.onclick = fn; el.innerHTML = `<span class="legend-dot" style="background-color:${css};"></span><span class="legend-name">${esc(label)}</span>`; container.appendChild(el); };
  Object.keys(CATEGORY_COLORS).forEach(t => add(t, CATEGORY_COLORS[t].css, () => filterByType(t)));
  add('อื่นๆ', DEFAULT_COLOR.css, () => filterByType('อื่นๆ'));
}
function updateVelocitySummary(sheetData) {
  const skuMap = {}; sheetData.forEach(i => { const sku = String(i.sku).trim(); if (sku && !skuMap[sku]) skuMap[sku] = String(i.criteria || 'FAST').trim().toUpperCase(); });
  const total = Object.keys(skuMap).length;
  if (!total) return;
  const counts = { FAST: 0, MEDIUM: 0, SLOW: 0, DEAD: 0 };
  Object.values(skuMap).forEach(c => { if (c in counts) counts[c]++; });
  Object.keys(counts).forEach(k => {
    const pct = Math.round((counts[k] / total) * 100), low = k.toLowerCase();
    document.getElementById(`pct-${low}`).innerText = `${pct}%`;
    document.getElementById(`bar-${low}`).style.width = `${pct}%`;
  });
  document.getElementById('velocity-total-sku-label').innerText = `คำนวณจาก ${total} SKUs ที่มีตำแหน่ง`;
}

// --- 3D Scene ---
function initThree() {
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene(); scene.background = new THREE.Color(currentTheme === 'dark' ? 0x0d1117 : 0xf4f6f8);
  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500); camera.position.set(30, 35, 45);
  renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(container.clientWidth, container.clientHeight); container.appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement); controls.target.set(30, 0, 10); controls.enableDamping = true; controls.dampingFactor = 0.08;
  updateGridAndFloor();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85)); const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(30, 40, 20); scene.add(dl);
  setupInteractions(); animate(); renderLegend();
  if (window.ResizeObserver) new ResizeObserver(resizeRenderer).observe(container); else window.addEventListener('resize', resizeRenderer);
}
function resizeRenderer() {
  const container = document.getElementById('canvas-container');
  if (!renderer || !container.clientWidth) return;
  camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight);
}
function updateGridAndFloor() {
  if (gridHelper) scene.remove(gridHelper); if (floorMesh) scene.remove(floorMesh);
  const isDark = currentTheme === 'dark';
  gridHelper = new THREE.GridHelper(60, 60, isDark ? 0x58a6ff : 0x1a6fe0, isDark ? 0x30363d : 0xdde1e6); gridHelper.position.set(30, 0, 10); gridHelper.scale.set(1, 1, 20 / 60); scene.add(gridHelper);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshBasicMaterial({ color: isDark ? 0x161b22 : 0xeceff2, side: THREE.DoubleSide })); floorMesh.rotation.x = Math.PI / 2; floorMesh.position.set(30, -0.01, 10); scene.add(floorMesh);
}
function renderWarehouse(sheetData) {
  document.getElementById('loader').style.display = 'none';
  items.forEach(box => scene.remove(box)); items.length = 0;
  if (!sheetData || !sheetData.length) return;
  sheetData.forEach(item => {
    const w = (Math.abs(item.colEnd - item.colStart) + 1) * TILE_SIZE - GAP, h = (Math.abs(item.maxLvl - item.minLvl) + 1) * LEVEL_HEIGHT, d = (Math.abs(item.rowEnd - item.rowStart) + 1) * TILE_SIZE - GAP;
    const geo = new THREE.BoxGeometry(w, h, d);
    const orig = getCategoryColor(item.type);
    const box = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: isHeatmapMode ? getCriteriaColor(item.criteria) : orig, roughness: 0.35, transparent: true, opacity: 0.85 }));
    box.position.set(((item.colStart + item.colEnd) / 2) - 0.5, (item.minLvl - 1) * LEVEL_HEIGHT + (h / 2), ((item.rowStart + item.rowEnd) / 2) - 0.5);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })); box.add(line);
    box.userData = { ...item, originalColor: orig, edgeLine: line };
    scene.add(box); items.push(box);
  });
  updateVelocitySummary(sheetData);
}

function showDetail(d) {
  const card = document.getElementById('detail-card');
  card.innerHTML = `<div class="dc-head"><div class="dc-title">${esc(d.name)}</div><button class="icon-btn" onclick="hideDetail()">${icon('close')}</button></div><div class="dc-grid"><span>SKU</span><span>${esc(d.sku)}</span><span>ประเภท</span><span>${esc(d.type)}</span><span>จำนวน</span><span>${esc(d.qty)} ${esc(d.unit || 'เส้น')}</span><span>พิกัด</span><span>${esc(d.displayLoc)}</span></div>`;
  card.style.display = 'block';
}
function hideDetail() { const c = document.getElementById('detail-card'); if (c) c.style.display = 'none'; }
function setupInteractions() {
  const rc = new THREE.Raycaster(), mouse = new THREE.Vector2(), dom = renderer.domElement; let downPos = null;
  const hitAt = (e) => { const rect = dom.getBoundingClientRect(); mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; rc.setFromCamera(mouse, camera); const hits = rc.intersectObjects(items); return hits.length ? hits[0].object.userData : null; };
  dom.addEventListener('pointerdown', e => downPos = { x: e.clientX, y: e.clientY });
  dom.addEventListener('pointerup', e => { if (!downPos || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return; const d = hitAt(e); d ? showDetail(d) : hideDetail(); });
}
function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }

// --- List Renderers ---
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
          <button type="button" class="lot-pill-editable ${emptyClass}" data-act="edit-lot" ${attrs} title="แตะเพื่อแก้ไข Lot">
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
  const c = document.getElementById('stock-list-container'); c.innerHTML = '';
  if (!list || !list.length) { c.innerHTML = '<div class="empty-state">ไม่พบรายการสินค้า</div>'; return; }
  const grouped = {}; list.forEach(i => { const t = i.type || 'อื่นๆ', k = i.name || i.sku; if (!grouped[t]) grouped[t] = {}; if (!grouped[t][k]) grouped[t][k] = { name: k, sku: i.sku, locations: [], unit: i.unit }; grouped[t][k].locations.push(i); });
  Object.keys(grouped).sort().forEach(t => {
    const b = document.createElement('div'); b.className = 'type-group-block'; b.innerHTML = `<div class="type-group-header"><div class="type-title-badge">${esc(t)}</div></div>`;
    Object.values(grouped[t]).forEach(p => {
      const pCard = document.createElement('div'); pCard.className = 'prod-name-card';
      pCard.innerHTML = `<div class="prod-top"><div class="prod-name-title">${esc(p.name)}</div></div><div class="prod-meta-subtitle"><span>SKU: ${esc(p.sku)}</span></div><div class="loc-pills-container">${p.locations.map(l => locRowHTML(l, p.sku, p.unit)).join('')}</div>`;
      b.appendChild(pCard);
    });
    c.appendChild(b);
  });
}
function renderAuditList(data) {
  const c = document.getElementById('audit-list-container'); c.innerHTML = '';
  let un=0, un_q=0, ov=0;
  data.forEach(i => { if (i.status.includes('UNASSIGNED')) un++; else if (i.status.includes('UNDER')) un_q++; else if (i.status.includes('OVER')) ov++; });
  document.getElementById('kpi-unassigned').innerText = un; document.getElementById('kpi-under').innerText = un_q; document.getElementById('kpi-over').innerText = ov;
  if (!data.length) { c.innerHTML = `<div class="empty-state ok">สต็อกตรง 100%</div>`; return; }
  const b = document.createElement('div'); b.className = 'type-group-block';
  data.forEach(i => {
    const pCard = document.createElement('div'); pCard.className = 'prod-name-card';
    pCard.innerHTML = `<div class="prod-top"><div class="prod-name-title">${esc(i.name)}</div><span class="audit-badge ${i.status.includes('UNASSIGNED') ? 'badge-unassigned' : 'badge-under'}">${esc(i.status)}</span></div><div class="audit-summary-line"><div class="diff-stats"><span><strong>${i.erpQty}</strong><small>ERP</small></span><span><strong>${i.physicalQty}</strong><small>ในคลัง</small></span></div></div>`;
    b.appendChild(pCard);
  });
  c.appendChild(b);
}

function handleListAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, loc, sku, qty, unit } = btn.dataset;
  
  if (act === 'in' || act === 'out') {
    handleStockAction(act, loc, sku, unit, Number(qty));
  } else if (act === 'move') {
    openRelocateModal(loc, sku, Number(qty), unit);
  }
}

// --- Fetch Actions ---
async function handleStockAction(actionType, locId, sku, unit, maxQty = 0) {
  const qtyStr = prompt(`กรอกจำนวนที่ต้องการ ${actionType === 'in' ? 'เติมเข้า' : 'เบิกออก'} (${unit}):`, "1");
  if (!qtyStr) return; const qty = parseInt(qtyStr, 10);
  if (isNaN(qty) || qty <= 0 || (actionType === 'out' && qty > maxQty)) { alert("จำนวนไม่ถูกต้อง"); return; }
  
  Swal.fire({ title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, background: currentTheme === 'dark' ? '#161b22' : '#fff', color: currentTheme === 'dark' ? '#e6edf3' : '#1f2328' });
  const res = await safeFetch(actionType === 'in' ? 'add' : 'pick', { locId, qty });
  if (res && res.success) {
    Swal.fire({ icon: 'success', title: 'สำเร็จ', timer: 1200, showConfirmButton: false });
    loadData();
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot').textContent;
      if (activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else { Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res ? res.message : 'API Failed' }); }
}

async function loadAuditData() {
  const res = await safeFetch('audit');
  if (res && res.success) { masterAuditItems = res.data; renderAuditList(res.data); }
}

async function loadData() {
  const res3d = await safeFetch('get3D'); if (res3d && res3d.success) renderWarehouse(res3d.data);
  const resOps = await safeFetch('getOps'); if (resOps && resOps.success) { masterStaffItems = resOps.data; renderStaffList(resOps.data); }
}

// --- Scanner Logic ---
const video = document.getElementById('video'), toggleBtn = document.getElementById('toggle-btn'), statusEl = document.getElementById('status'), resultLotEl = document.getElementById('result-lot');
let stream = null, running = false, timerId = null, sampleBuffer = [];
const REQUIRED_SAMPLES = 5, LOT_PATTERN = /^\d{7}$/;

function processRawScan(code, format) {
  const clean = code.trim();
  if (!LOT_PATTERN.test(clean)) { statusEl.textContent = 'ข้ามรหัสที่ผิดรูปแบบ (ต้อง 7 หลัก)'; return; }
  sampleBuffer.push({ code: clean, format }); statusEl.textContent = `กำลังยืนยัน... (${sampleBuffer.length}/${REQUIRED_SAMPLES})`;
  if (sampleBuffer.length >= REQUIRED_SAMPLES) {
    const freq = {}; let max = 0, winner = sampleBuffer[0];
    sampleBuffer.forEach(i => { freq[i.code] = (freq[i.code] || 0) + 1; if (freq[i.code] > max) { max = freq[i.code]; winner = i; }});
    onCodeConfirmed(winner.code, winner.format); sampleBuffer = [];
  }
}

function onCodeConfirmed(code, format) {
  resultLotEl.textContent = code;
  statusEl.textContent = 'ยืนยันรหัสสำเร็จ!';
  if (navigator.vibrate) navigator.vibrate(100);
  handleScannerLookup(code);
}

async function handleScannerLookup(lotCode) {
  document.getElementById('scanner-result-card').style.display = 'flex';
  document.getElementById('scanner-inventory-details').style.display = 'none';
  statusEl.textContent = 'กำลังค้นหาฐานข้อมูล...';
  
  const res = await safeFetch('lookup', { lot: lotCode }); 
  
  if (res && res.success) {
    const data = res.data;
    
    if (data.productCode) {
      document.getElementById('scanner-product-header').textContent = `${data.productCode} | ${data.productName}`;
    } else {
      document.getElementById('scanner-product-header').textContent = `[ไม่พบรหัสสินค้า] | ${data.productName}`;
    }
    
    if (data.locations.length > 0) {
      document.getElementById('scanner-locations-list').innerHTML = data.locations.map(l => locRowHTML(l, data.productCode, l.unit)).join('');
    } else {
      document.getElementById('scanner-locations-list').innerHTML = '<div class="empty-state" style="padding: 20px;">ไม่พบพิกัดจัดเก็บสำหรับสินค้านี้</div>';
    }
    
    document.getElementById('scanner-inventory-details').style.display = 'block';
    statusEl.textContent = 'โหลดข้อมูลเสร็จสิ้น';
  } else { 
    statusEl.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ'; 
  }
}

async function openCamera() {
  const attempts = [{ video: { facingMode: { ideal: 'environment' } }, audio: false }, { video: true, audio: false }];
  let err; for (const c of attempts) { try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { err = e; } } throw err;
}
async function startScanner() {
  try {
    stopScanner(); statusEl.textContent = 'กำลังเปิดกล้อง...'; sampleBuffer = [];
    stream = await openCamera(); video.srcObject = stream; await video.play();
    running = true; toggleBtn.textContent = 'ปิดกล้องสแกน'; statusEl.textContent = 'หันกล้องไปที่บาร์โค้ด...';
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector(); const tick = async () => { if (!running) return; try { const f = await det.detect(video); if (f.length) processRawScan(f[0].rawValue, f[0].format); } catch (e) {} timerId = setTimeout(tick, 80); }; tick();
    } else {
      const r = new ZXing.MultiFormatReader(), hints = new Map(); hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.QR_CODE]); r.setHints(hints);
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => { if (!running) return; if (video.videoWidth > 0) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0, canvas.width, canvas.height); try { const res = r.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)))); processRawScan(res.getText(), ZXing.BarcodeFormat[res.getBarcodeFormat()]); } catch (e) {} } timerId = setTimeout(tick, 100); }; tick();
    }
  } catch (err) { statusEl.textContent = 'ไม่สามารถเข้าถึงกล้องได้'; stopScanner(); }
}
function stopScanner() {
  running = false; clearTimeout(timerId); sampleBuffer = [];
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null; toggleBtn.textContent = 'เปิดกล้องสแกน';
}

// --- Handle and dropdown population
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

  ['relocate-col-start', 'relocate-col-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = cols.map(c => `<option value="${c}">เสา ${c}</option>`).join('');
  });

  const rowOptions = Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">แถว ${i + 1}</option>`).join('');
  ['relocate-row-start', 'relocate-row-end'].forEach(id => {
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
  modal.style.display = 'flex';
  document.getElementById('relocate-loc-id').value = locId;
  document.getElementById('relocate-sku-title').innerText = `${sku} · คงเหลือ ${currentQty} ${unitText}`;
  document.getElementById('relocate-qty').value = currentQty;
  document.getElementById('relocate-qty').setAttribute('max', currentQty);
}

function closeRelocateModal() {
  document.getElementById('modal-relocate').style.display = 'none';
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
    newRowStart: Number(document.getElementById('relocate-row-start').value),
    newColEnd: document.getElementById('relocate-col-end').value,
    newRowEnd: Number(document.getElementById('relocate-row-end').value),
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
    
    // Refresh scanner results if currently on scanner view
    if (currentView === 'scanner') {
      const activeLot = document.getElementById('result-lot').textContent;
      if (activeLot && activeLot !== '-') handleScannerLookup(activeLot);
    }
  } else {
    Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res ? res.message : 'API Failed' });
  }
}

// --- Init ---
window.onload = () => {
  initCoordDropdowns();
  initThree();
  document.getElementById('stock-list-container').addEventListener('click', handleListAction);
  document.getElementById('audit-list-container').addEventListener('click', handleListAction);
  document.getElementById('scanner-locations-list').addEventListener('click', handleListAction);
  toggleBtn.addEventListener('click', () => (running ? stopScanner() : startScanner()));
  loadData();
};
