// ==========================================
// office.js : ทีมออฟฟิศโกดัง — ORD location allocation
// ==========================================
// Replaces the old test-mode Lot form (see docs/OFFICE_WAREHOUSE.md).
//
// Flow:
//   ORD list -> open one full ORD -> choose location(s) + amount per SKU
//   -> ยืนยันการเบิก -> ORD becomes PENDING (stock NOT deducted yet)
//   -> backend trigger deducts stock after the hold (4 hours).
//
// The browser only collects choices. The backend re-checks every value under
// a lock, so nothing here is trusted for stock or identity.

// ------------------------------------------
// 1. STATE
// ------------------------------------------
let currentTheme = APP_CONFIG.defaultTheme;
let currentUserEmail = '';

let orders = [];        // ORDs available for allocation (from getOfficeOrders)
let pending = [];       // PENDING ORDs waiting for the timed deduction
let holdHours = 4;

// The ORD being allocated: { ordId, orderDate, customer, skus: [...] }
// sku = { productCode, productName, unit, requiredQty, rows: [{ id, locationId, amount }] }
let current = null;
let choices = {};       // productCode -> [{ locationId, location, lotNo, qty }]
let productMeta = {};   // productCode -> { unit, brand, type } for the add-location form
let addLocSku = null;   // SKU the add-location modal is open for
let submitting = false;

let uid = 0;
const nextId = () => ++uid;
const newRow = () => ({ id: nextId(), locationId: '', amount: '' });

// Quantities are compared after rounding so decimal units (e.g. litres)
// do not fail exact-total checks because of floating-point noise.
const roundQty = (n) => Math.round(Number(n) * 10000) / 10000;

// ------------------------------------------
// 2. SMALL HELPERS
// ------------------------------------------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const icon = (name, cls = 'ic ic-sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const fmtQty = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 4 });
const swalTheme = () => currentTheme === 'dark'
  ? { background: '#161b22', color: '#e6edf3' }
  : { background: '#ffffff', color: '#1f2328' };

function showLoading(title) {
  Swal.fire({ title, allowOutsideClick: false, didOpen: () => Swal.showLoading(), ...swalTheme() });
}

function showError(text, title = 'เกิดข้อผิดพลาด') {
  return Swal.fire({ icon: 'error', title, text: text || 'ไม่สามารถเชื่อมต่อระบบได้', confirmButtonText: 'ตกลง', ...swalTheme() });
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('scrim').classList.add('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('scrim').classList.remove('show');
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Two sidebar views: ORD allocation and the PENDING list.
function switchView(view) {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('view-orders').hidden = view !== 'orders';
  document.getElementById('view-pending').hidden = view !== 'pending';
  document.getElementById('page-title').textContent = view === 'pending' ? 'รอตัดสต็อก' : 'เบิกสินค้าตาม ORD';
  closeSidebar();
}

// ------------------------------------------
// 3. LOADING ORDs
// ------------------------------------------
async function loadOrders() {
  document.getElementById('orders-summary').textContent = 'กำลังโหลด ORD...';
  const res = await safeFetch('getOfficeOrders');
  if (!res?.success) {
    document.getElementById('orders-summary').textContent = 'โหลด ORD ไม่สำเร็จ';
    showError(res?.message);
    return;
  }
  orders = res.data.orders || [];
  pending = res.data.pending || [];
  holdHours = res.data.holdHours || holdHours;
  renderOrderList();
  renderPendingList();
}

function orderMatchesSearch(order, query) {
  if (!query) return true;
  const haystack = [order.ordId, order.customer, ...order.lines.map(l => `${l.productCode} ${l.productName}`)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function renderOrderList() {
  const query = document.getElementById('ord-search').value.trim().toLowerCase();
  const visible = orders.filter(o => orderMatchesSearch(o, query));
  document.getElementById('orders-summary').textContent = query
    ? `พบ ${visible.length} จาก ${orders.length} ORD ที่รอเลือกพิกัด`
    : `${orders.length} ORD ที่รอเลือกพิกัด`;

  const host = document.getElementById('ord-list');
  if (!visible.length) {
    host.innerHTML = `<div class="empty-state">${orders.length ? 'ไม่พบ ORD ที่ค้นหา' : 'ไม่มี ORD ที่รอเลือกพิกัด'}</div>`;
    return;
  }

  host.innerHTML = visible.map(order => `
    <div class="of-card of-ord-card">
      <div class="of-ord-main">
        <div class="of-ord-title">${esc(order.ordId)}</div>
        <div class="of-ord-meta">${esc(order.orderDate || '-')} · ${esc(order.customer || '-')}</div>
        <div class="of-ord-skus">${order.lines.map(l => `<span class="chip">${esc(l.productCode)} × ${esc(fmtQty(l.requiredQty))}</span>`).join('')}</div>
      </div>
      <button type="button" class="btn btn-primary" data-act="open-order" data-ord="${esc(order.ordId)}">เบิกรายการ</button>
    </div>
  `).join('');
}

// ------------------------------------------
// 4. ALLOCATION SCREEN
// ------------------------------------------
async function openOrder(ordId) {
  const order = orders.find(o => o.ordId === ordId);
  if (!order) return;

  current = {
    ordId: order.ordId,
    orderDate: order.orderDate,
    customer: order.customer,
    skus: order.lines.map(line => ({ ...line, rows: [newRow()] }))
  };
  choices = {};
  productMeta = {};

  showLoading('กำลังโหลดพิกัด...');
  const ok = await loadChoices(current.skus.map(s => s.productCode));
  Swal.close();
  if (!ok) {
    current = null;
    return;
  }

  // A SKU with exactly one location is pre-selected to save taps; the admin
  // still confirms the amount.
  current.skus.forEach(sku => {
    const list = choices[sku.productCode] || [];
    if (list.length === 1) sku.rows[0].locationId = list[0].locationId;
  });

  document.getElementById('orders-panel').hidden = true;
  document.getElementById('alloc-panel').hidden = false;
  document.getElementById('alloc-ord-id').textContent = current.ordId;
  document.getElementById('alloc-ord-meta').textContent = `${current.orderDate || '-'} · ${current.customer || '-'}`;
  renderAllocation();
  document.getElementById('view-orders').scrollTo({ top: 0 });
}

function closeOrder() {
  current = null;
  document.getElementById('alloc-panel').hidden = true;
  document.getElementById('orders-panel').hidden = false;
  renderOrderList();
}

// Loads (or reloads) the location choices for the given SKUs.
async function loadChoices(productCodes) {
  const res = await safeFetch('getOrderLocationChoices', { productCodes });
  if (!res?.success) {
    showError(res?.message, 'โหลดพิกัดไม่สำเร็จ');
    return false;
  }
  Object.assign(choices, res.data.choices || {});
  Object.assign(productMeta, res.data.meta || {});
  return true;
}

const findSku = (code) => current?.skus.find(s => s.productCode === code);
const findChoice = (code, locationId) => (choices[code] || []).find(c => c.locationId === locationId);
const isBlankRow = (row) => !row.locationId && !row.amount;

// Per-row validation. Returns '' when the row is valid or completely blank.
function rowError(sku, row) {
  if (isBlankRow(row)) return '';
  if (!row.locationId) return 'กรุณาเลือกพิกัด';
  const choice = findChoice(sku.productCode, row.locationId);
  if (!choice) return 'พิกัดนี้ไม่พร้อมใช้งานแล้ว กรุณาเลือกใหม่';
  const amount = Number(row.amount);
  if (!row.amount || !(amount > 0)) return 'กรุณากรอกจำนวนที่เบิก';
  // Admin must not pick more than the location shows; fix the location first.
  if (amount > choice.qty) return `พิกัดนี้มีเพียง ${fmtQty(choice.qty)} ${sku.unit} — กด "เติม" หากของจริงมีมากกว่านี้`;
  return '';
}

function skuAllocated(sku) {
  return roundQty(sku.rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
}

function skuIsComplete(sku) {
  return skuAllocated(sku) === roundQty(sku.requiredQty) &&
    sku.rows.some(row => !isBlankRow(row)) &&
    sku.rows.every(row => !rowError(sku, row));
}

function locationOptionsHTML(sku, row) {
  const list = choices[sku.productCode] || [];
  // The same location may be used only once per SKU.
  const usedElsewhere = new Set(sku.rows.filter(r => r.id !== row.id && r.locationId).map(r => r.locationId));
  const options = list.map(c => `
    <option value="${esc(c.locationId)}" ${c.locationId === row.locationId ? 'selected' : ''} ${usedElsewhere.has(c.locationId) ? 'disabled' : ''}>
      ${esc(c.location || c.locationId)} · Lot ${esc(c.lotNo || '-')} · มี ${esc(fmtQty(c.qty))}
    </option>`).join('');
  // Keep a vanished selection visible so the admin sees it must be changed.
  const missing = row.locationId && !findChoice(sku.productCode, row.locationId)
    ? `<option value="${esc(row.locationId)}" selected>พิกัดเดิมไม่พร้อมใช้งาน</option>`
    : '';
  return `<option value="">— เลือกพิกัด —</option>${missing}${options}`;
}

function rowHTML(sku, row) {
  const error = rowError(sku, row);
  const canTopUp = Boolean(findChoice(sku.productCode, row.locationId));
  return `
    <div class="of-alloc-row">
      <select class="of-input ${error && !row.locationId ? 'invalid' : ''}" data-field="location" data-sku="${esc(sku.productCode)}" data-row="${row.id}" aria-label="พิกัด">
        ${locationOptionsHTML(sku, row)}
      </select>
      <input type="text" class="of-input ${error && row.locationId ? 'invalid' : ''}" data-field="amount" data-sku="${esc(sku.productCode)}" data-row="${row.id}"
             value="${esc(row.amount)}" inputmode="decimal" placeholder="จำนวน" autocomplete="off" aria-label="จำนวนที่เบิก" />
      <button type="button" class="btn btn-outline btn-sm" data-act="top-up" data-sku="${esc(sku.productCode)}" data-row="${row.id}" ${canTopUp ? '' : 'disabled'} title="เติมจำนวนให้พิกัดนี้">เติม</button>
      <button type="button" class="icon-btn" data-act="remove-row" data-sku="${esc(sku.productCode)}" data-row="${row.id}" aria-label="ลบแถวนี้" ${sku.rows.length <= 1 ? 'disabled' : ''}>${icon('minus', 'ic')}</button>
      ${error ? `<div class="of-row-error" data-error-for="${row.id}">${esc(error)}</div>` : `<div class="of-row-error" data-error-for="${row.id}" hidden></div>`}
    </div>`;
}

function skuProgressHTML(sku) {
  const allocated = skuAllocated(sku);
  const remaining = roundQty(sku.requiredQty - allocated);
  const state = remaining === 0 ? 'ok' : remaining < 0 ? 'over' : 'todo';
  const label = remaining < 0 ? `เกิน ${fmtQty(-remaining)}` : `เหลือ ${fmtQty(remaining)}`;
  return `<span class="of-progress of-progress-${state}">เลือกแล้ว ${fmtQty(allocated)} / ${fmtQty(sku.requiredQty)} · ${label}</span>`;
}

function skuCardHTML(sku) {
  const list = choices[sku.productCode] || [];
  const complete = skuIsComplete(sku);
  return `
    <div class="of-card of-sku-card ${complete ? 'of-sku-done' : ''}" data-sku-card="${esc(sku.productCode)}">
      <div class="of-sku-head">
        <div>
          <div class="of-prod-line"><span class="chip of-code-chip">${esc(sku.productCode)}</span><span>${esc(sku.productName)}</span></div>
          <div class="of-sku-need">ต้องเบิก <strong>${esc(fmtQty(sku.requiredQty))}</strong> ${esc(sku.unit)}</div>
        </div>
        <div data-progress-for="${esc(sku.productCode)}">${skuProgressHTML(sku)}</div>
      </div>

      ${list.length ? '' : '<div class="of-warn">ยังไม่มีพิกัดของสินค้านี้ในระบบ — กด "เพิ่มพิกัดใหม่"</div>'}

      <div class="of-alloc-rows">
        ${sku.rows.map(row => rowHTML(sku, row)).join('')}
      </div>

      <div class="of-sku-actions">
        <button type="button" class="btn btn-outline btn-sm" data-act="add-row" data-sku="${esc(sku.productCode)}" ${list.length > sku.rows.length ? '' : 'disabled'}>
          ${icon('plus')}<span>เพิ่มพิกัด</span>
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="new-location" data-sku="${esc(sku.productCode)}">
          ${icon('plus')}<span>เพิ่มพิกัดใหม่</span>
        </button>
      </div>
    </div>`;
}

function renderAllocation() {
  if (!current) return;
  document.getElementById('alloc-skus').innerHTML = current.skus.map(skuCardHTML).join('');
  updateSubmitBar();
}

// Light update while typing an amount: keeps input focus instead of
// re-rendering the whole card.
function refreshSkuStatus(sku) {
  const card = document.querySelector(`[data-sku-card="${CSS.escape(sku.productCode)}"]`);
  if (!card) return;
  card.classList.toggle('of-sku-done', skuIsComplete(sku));
  card.querySelector('[data-progress-for]').innerHTML = skuProgressHTML(sku);
  sku.rows.forEach(row => {
    const error = rowError(sku, row);
    const box = card.querySelector(`[data-error-for="${row.id}"]`);
    if (box) {
      box.textContent = error;
      box.hidden = !error;
    }
    card.querySelector(`[data-field="amount"][data-row="${row.id}"]`)?.classList.toggle('invalid', Boolean(error && row.locationId));
  });
  updateSubmitBar();
}

function updateSubmitBar() {
  const done = current.skus.filter(skuIsComplete).length;
  const total = current.skus.length;
  document.getElementById('alloc-summary').textContent = `ครบแล้ว ${done} / ${total} สินค้า`;
  document.getElementById('btn-submit-alloc').disabled = submitting || done !== total;
}

// ------------------------------------------
// 5. ALLOCATION ACTIONS
// ------------------------------------------
function addRow(code) {
  const sku = findSku(code);
  if (!sku) return;
  sku.rows.push(newRow());
  renderAllocation();
}

function removeRow(code, rowId) {
  const sku = findSku(code);
  if (!sku || sku.rows.length <= 1) return;
  sku.rows = sku.rows.filter(r => r.id !== Number(rowId));
  renderAllocation();
}

async function reloadChoicesFor(code) {
  showLoading('กำลังโหลดพิกัดใหม่...');
  await loadChoices([code]);
  Swal.close();
  renderAllocation();
}

// Adds quantity to an existing location (existing `add` action). Used when the
// real shelf holds more than the system shows.
async function topUpLocation(code, rowId) {
  const sku = findSku(code);
  const row = sku?.rows.find(r => r.id === Number(rowId));
  const choice = row && findChoice(code, row.locationId);
  if (!choice) return;

  const { value, isConfirmed } = await Swal.fire({
    title: 'เติมจำนวนพิกัด',
    html: `<div class="of-swal-text">${esc(code)} · ${esc(choice.location)}<br>ในระบบมี ${esc(fmtQty(choice.qty))} ${esc(sku.unit)}</div>`,
    input: 'text',
    inputAttributes: { inputmode: 'numeric', autocomplete: 'off' },
    inputPlaceholder: 'จำนวนที่ต้องการเติม',
    showCancelButton: true,
    confirmButtonText: 'เติม',
    cancelButtonText: 'ยกเลิก',
    inputValidator: (v) => (Number(v) > 0 ? undefined : 'กรุณากรอกจำนวนมากกว่า 0'),
    ...swalTheme()
  });
  if (!isConfirmed) return;

  showLoading('กำลังเติมจำนวน...');
  const res = await safeFetch('add', { locId: choice.locationId, qty: Number(value) });
  if (!res?.success) {
    showError(res?.message);
    return;
  }
  await reloadChoicesFor(code);
}

// ------------------------------------------
// 6. ADD NEW LOCATION MODAL (same fields as the picker page)
// ------------------------------------------
function columnName(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function initAddLocationForm() {
  const cols = Array.from({ length: 60 }, (_, i) => columnName(i + 1));
  const colOptions = cols.map(c => `<option value="${c}">เสา ${c}</option>`).join('');
  const rowOptions = Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  ['add-loc-col-start', 'add-loc-col-end'].forEach(id => { document.getElementById(id).innerHTML = colOptions; });
  ['add-loc-row-start', 'add-loc-row-end'].forEach(id => { document.getElementById(id).innerHTML = rowOptions; });

  // Choosing a start coordinate copies it to the end, like the picker page.
  document.getElementById('add-loc-col-start').addEventListener('change', e => { document.getElementById('add-loc-col-end').value = e.target.value; });
  document.getElementById('add-loc-row-start').addEventListener('change', e => { document.getElementById('add-loc-row-end').value = e.target.value; });

  document.getElementById('add-loc-levels').innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<button type="button" class="level-sq-btn ${i === 0 ? 'active' : ''}" data-lvl="${i + 1}">${i + 1}</button>`
  ).join('');
  document.getElementById('add-loc-levels').addEventListener('click', e => {
    const btn = e.target.closest('.level-sq-btn');
    if (!btn) return;
    btn.classList.toggle('active');
    // At least one level must stay selected.
    if (!btn.parentElement.querySelector('.level-sq-btn.active')) btn.classList.add('active');
  });

  ['add-loc-lot', 'add-loc-qty'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  });
}

function openAddLocation(code) {
  const sku = findSku(code);
  if (!sku) return;
  addLocSku = sku;
  document.getElementById('add-loc-sku').textContent = sku.productCode;
  document.getElementById('add-loc-name').textContent = sku.productName;
  document.getElementById('add-loc-lot').value = '';
  document.getElementById('add-loc-qty').value = '';
  ['add-loc-col-start', 'add-loc-col-end'].forEach(id => { document.getElementById(id).value = 'A'; });
  ['add-loc-row-start', 'add-loc-row-end'].forEach(id => { document.getElementById(id).value = '1'; });
  document.querySelectorAll('#add-loc-levels .level-sq-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.getElementById('modal-add-loc').hidden = false;
}

function closeAddLocation() {
  document.getElementById('modal-add-loc').hidden = true;
  addLocSku = null;
}

// Creates the location through the existing `assign` action, then reloads the
// SKU's choices. The ORD in progress and its entries stay on screen.
async function saveAddLocation() {
  const sku = addLocSku;
  if (!sku) return;
  const lotNo = document.getElementById('add-loc-lot').value.trim();
  const qty = Number(document.getElementById('add-loc-qty').value);
  if (lotNo && !/^\d{1,20}$/.test(lotNo)) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'Lot Number ต้องเป็นตัวเลขไม่เกิน 20 หลัก', ...swalTheme() });
    return;
  }
  if (!(qty > 0)) {
    Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกจำนวนที่จัดเก็บมากกว่า 0', ...swalTheme() });
    return;
  }

  const meta = productMeta[sku.productCode] || {};
  const payload = {
    sku: sku.productCode,
    name: sku.productName,
    type: meta.type || '',
    brand: meta.brand || '',
    lotNo,
    colStartStr: document.getElementById('add-loc-col-start').value,
    rowStartNum: Number(document.getElementById('add-loc-row-start').value),
    colEndStr: document.getElementById('add-loc-col-end').value,
    rowEndNum: Number(document.getElementById('add-loc-row-end').value),
    levelsArray: Array.from(document.querySelectorAll('#add-loc-levels .level-sq-btn.active')).map(b => Number(b.dataset.lvl)),
    qty
  };

  showLoading('กำลังบันทึกพิกัดใหม่...');
  const res = await safeFetch('assign', payload);
  if (!res?.success) {
    showError(res?.message);
    return;
  }
  closeAddLocation();
  await reloadChoicesFor(sku.productCode);
}

// ------------------------------------------
// 7. SUBMIT
// ------------------------------------------
function buildSubmitPayload() {
  const lines = current.skus.map(s => ({ productCode: s.productCode, requiredQty: s.requiredQty }));
  const allocations = [];
  current.skus.forEach(sku => {
    sku.rows.filter(r => !isBlankRow(r)).forEach(r => {
      allocations.push({ productCode: sku.productCode, locationId: r.locationId, amount: Number(r.amount) });
    });
  });
  return { ordId: current.ordId, lines, allocations };
}

function confirmTableHTML() {
  const rows = current.skus.flatMap(sku => sku.rows.filter(r => !isBlankRow(r)).map(r => {
    const choice = findChoice(sku.productCode, r.locationId);
    return `<tr><td>${esc(sku.productCode)}</td><td>${esc(choice?.location || '-')}</td><td class="num">${esc(fmtQty(r.amount))} ${esc(sku.unit)}</td></tr>`;
  })).join('');
  return `
    <div class="of-swal-text">
      <div><strong>${esc(current.ordId)}</strong> · ${esc(current.customer || '-')}</div>
      <div class="of-swal-note">ระบบจะตัดสต็อกอัตโนมัติหลังยืนยัน ${esc(holdHours)} ชั่วโมง ระหว่างนี้ยกเลิกได้ที่เมนู "รอตัดสต็อก"</div>
      <table class="of-confirm-table">
        <thead><tr><th>รหัสสินค้า</th><th>พิกัด</th><th class="num">จำนวน</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function submitAllocation() {
  if (!current || submitting) return;
  if (!current.skus.every(skuIsComplete)) return;

  const { isConfirmed } = await Swal.fire({
    title: 'ยืนยันการเบิก',
    html: confirmTableHTML(),
    showCancelButton: true,
    confirmButtonText: 'ยืนยันการเบิก',
    cancelButtonText: 'กลับไปแก้ไข',
    confirmButtonColor: '#238636',
    ...swalTheme()
  });
  if (!isConfirmed) return;

  // Block double submits on the client; the backend also rejects a second
  // submit for an ORD that is already PENDING.
  submitting = true;
  updateSubmitBar();
  showLoading('กำลังบันทึก...');
  const res = await safeFetch('submitOrderAllocation', buildSubmitPayload());
  submitting = false;

  if (res?.success) {
    await Swal.fire({
      icon: 'success',
      title: 'บันทึกแล้ว',
      text: `${res.ordId} รอตัดสต็อกอัตโนมัติประมาณ ${res.dueAt}`,
      confirmButtonText: 'ตกลง',
      ...swalTheme()
    });
    closeOrder();
    await loadOrders();
    return;
  }

  // ORD changed in DATA : Current ORD, or it was already submitted (for
  // example by a retry or another admin): reload the list.
  if (res?.code === 'ORDER_CHANGED' || res?.code === 'ALREADY_SUBMITTED') {
    await Swal.fire({ icon: 'warning', title: 'กรุณาโหลดใหม่', text: res.message, confirmButtonText: 'ตกลง', ...swalTheme() });
    closeOrder();
    await loadOrders();
    return;
  }

  updateSubmitBar();
  showError(res?.message, 'บันทึกไม่สำเร็จ');
}

// ------------------------------------------
// 8. PENDING LIST + CANCEL
// ------------------------------------------
function renderPendingList() {
  const badge = document.getElementById('pending-count');
  badge.textContent = String(pending.length);
  badge.hidden = pending.length === 0;
  document.getElementById('pending-summary').textContent =
    `${pending.length} ORD รอตัดสต็อก (ตัดอัตโนมัติหลังยืนยัน ${holdHours} ชั่วโมง)`;

  const host = document.getElementById('pending-list');
  if (!pending.length) {
    host.innerHTML = '<div class="empty-state">ไม่มี ORD ที่รอตัดสต็อก</div>';
    return;
  }

  host.innerHTML = pending.map(p => `
    <div class="of-card of-ord-card">
      <div class="of-ord-main">
        <div class="of-ord-title">${esc(p.ordId)}</div>
        <div class="of-ord-meta">${esc(p.customer || '-')}</div>
        <div class="of-ord-meta">ยืนยันโดย ${esc(p.user)} · ${esc(p.submittedAt)}</div>
        <div class="of-due">${icon('clock')}<span>ตัดสต็อกประมาณ ${esc(p.dueAt)}</span></div>
      </div>
      <button type="button" class="btn btn-outline of-btn-danger" data-act="cancel-pending" data-ord="${esc(p.ordId)}">ยกเลิก</button>
    </div>
  `).join('');
}

async function cancelPending(ordId) {
  const { isConfirmed } = await Swal.fire({
    icon: 'warning',
    title: `ยกเลิก ${ordId}?`,
    text: 'สต็อกจะไม่ถูกตัด และ ORD จะกลับไปอยู่ในรายการให้เลือกพิกัดใหม่',
    showCancelButton: true,
    confirmButtonText: 'ยกเลิก ORD',
    cancelButtonText: 'ไม่ยกเลิก',
    confirmButtonColor: '#da3633',
    ...swalTheme()
  });
  if (!isConfirmed) return;

  showLoading('กำลังยกเลิก...');
  const res = await safeFetch('cancelOrderAllocation', { ordId });
  if (!res?.success) {
    showError(res?.message);
    await loadOrders();
    return;
  }
  Swal.fire({ icon: 'success', title: 'ยกเลิกแล้ว', timer: 1400, showConfirmButton: false, ...swalTheme() });
  await loadOrders();
}

// ------------------------------------------
// 9. EVENT WIRING (delegation, no inline handlers)
// ------------------------------------------
function wireEvents() {
  document.getElementById('btn-open-sidebar').addEventListener('click', openSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('scrim').addEventListener('click', closeSidebar);
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('ord-search').addEventListener('input', renderOrderList);
  document.getElementById('btn-refresh-orders').addEventListener('click', loadOrders);
  document.getElementById('btn-refresh-pending').addEventListener('click', loadOrders);
  document.getElementById('btn-back-orders').addEventListener('click', closeOrder);
  document.getElementById('btn-submit-alloc').addEventListener('click', submitAllocation);

  document.getElementById('ord-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act="open-order"]');
    if (btn) openOrder(btn.dataset.ord);
  });

  document.getElementById('pending-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act="cancel-pending"]');
    if (btn) cancelPending(btn.dataset.ord);
  });

  const skuHost = document.getElementById('alloc-skus');
  skuHost.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const { act, sku, row } = btn.dataset;
    if (act === 'add-row') addRow(sku);
    else if (act === 'remove-row') removeRow(sku, row);
    else if (act === 'top-up') topUpLocation(sku, row);
    else if (act === 'new-location') openAddLocation(sku);
  });

  // Choosing a location re-renders so the other rows' options update.
  skuHost.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.field !== 'location') return;
    const row = findSku(el.dataset.sku)?.rows.find(r => r.id === Number(el.dataset.row));
    if (!row) return;
    row.locationId = el.value;
    renderAllocation();
  });

  // Typing an amount only refreshes status so the keyboard stays open.
  skuHost.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.field !== 'amount') return;
    const sku = findSku(el.dataset.sku);
    const row = sku?.rows.find(r => r.id === Number(el.dataset.row));
    if (!row) return;
    el.value = el.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    row.amount = el.value;
    refreshSkuStatus(sku);
  });

  document.getElementById('btn-add-loc-close').addEventListener('click', closeAddLocation);
  document.getElementById('btn-add-loc-cancel').addEventListener('click', closeAddLocation);
  document.getElementById('btn-add-loc-save').addEventListener('click', saveAddLocation);
}

// ------------------------------------------
// 10. INIT
// ------------------------------------------
window.addEventListener('load', async () => {
  // Reuse the one-time session from index.html; no second login screen.
  if (!requireAuthenticatedPage('../index.html')) return;
  const authResult = await safeFetch('authCheck');
  if (!authResult?.success) {
    await Swal.fire({ icon: 'error', title: 'ไม่มีสิทธิ์ใช้งาน', text: authResult?.message || 'กรุณาเลือกบัญชีที่ได้รับอนุญาต' });
    signOutGoogle();
    return;
  }
  currentUserEmail = getGoogleProfile()?.email || '';
  document.getElementById('sidebar-user').textContent = currentUserEmail || '-';
  document.documentElement.setAttribute('data-theme', currentTheme);

  initAddLocationForm();
  wireEvents();
  await loadOrders();
});
