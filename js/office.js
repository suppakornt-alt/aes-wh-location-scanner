// ==========================================
// office.js : ทีมออฟฟิศโกดัง (order form, UI only)
// ==========================================

// ------------------------------------------
// 1. SAMPLE DATA (TEMPORARY)
// ------------------------------------------
// Rows copied from sheet "DATA : Stock By Lot" (header is row 6).
// Columns used: A Product Code, B Product Name, C Unit, D Lot No., I Remaining.
// NOTE: product codes are TEXT with leading zeros ("000001"), never numbers.
// TODO (backend step): replace these two blocks with real data.
//   MOCK_PRODUCTS -> safeFetch('getProducts')
//   MOCK_LOTS     -> safeFetch('getLots', { sku })
const MOCK_PRODUCTS = [
  { code: '000001', name: 'แม่แรงตะเข้ 3.5 ตัน JOYACHI', unit: 'PC.' },
  { code: '000210', name: 'ลูกบล็อก  1" IMPACT เบอร์ 21  FLAG Tools', unit: 'PC.' },
  { code: '009030', name: 'PN55-420 Rust Proof Penetrating Oil ICHINEN 420ml', unit: 'กระป๋อง' },
  { code: '400232', name: 'EP GREASE#1 (15KG)', unit: 'ถัง' },
  { code: '401095', name: 'SUPER LONGLIFE COOLANT PREMIXED (4/4) (น้ำยารักษาหม้อน้ำแบบผสม 50:50)', unit: 'ลัง' },
  { code: '401096', name: 'SUPER LONGLIFE COOLANT PREMIXED (10/1) (น้ำยารักษาหม้อน้ำแบบผสม 50:50', unit: 'ลัง' },
  { code: '401250', name: 'AUTOMAT ATF 1A (10/1L)+2Bot', unit: 'ลัง' },
  { code: '401256', name: 'AUTOMAT CVT  (10/1L)', unit: 'ลัง' },
  { code: 'MI15P-0022', name: 'กระทะล้อ 7.0J X 15 P (6H) ET-15 EL/ GIANT VHD สีเงิน (133)', unit: 'วง' }
];

// lot = column D, qty = column I (Remaining), created = column E
const MOCK_LOTS = {
  '000001': [{ lot: '2410069', qty: 1, created: '29/10/2024' }],
  '000210': [{ lot: '2200350', qty: 3, created: '05/04/2022' }],
  '009030': [{ lot: '2101294', qty: 38, created: '18/10/2021' }],
  '400232': [{ lot: '2100739', qty: 10, created: '12/05/2021' }],
  '401095': [{ lot: '2400171', qty: 1, created: '17/02/2024' }],
  '401096': [{ lot: '2400172', qty: 1, created: '17/02/2024' }],
  '401250': [{ lot: '2200893', qty: 1, created: '12/09/2022' }],
  '401256': [{ lot: '2101073', qty: 3, created: '24/08/2021' }],
  // 27 real lots, 11 digits each, 1 wheel per lot (24110110015 ... 24110110041)
  'MI15P-0022': Array.from({ length: 27 }, (_, i) => ({ lot: String(24110110015 + i), qty: 1, created: '07/11/2024' }))
};

// Valid lot lengths. Older lots are 7 digits, some lots since 2024 are 11 digits.
// If another length appears, add it here and the whole form follows.
const LOT_LENGTHS = [7, 11];
const MAX_LOT_LEN = Math.max(...LOT_LENGTHS);
const LOT_RULE_TEXT = LOT_LENGTHS.join(' หรือ ') + ' หลัก';
const isValidLot = (v) => /^\d+$/.test(v) && LOT_LENGTHS.includes(v.length);

// The office types ONLY the number; the prefix is added automatically.
// If your real ORD format differs (no dash, different prefix) change these two lines.
const ORD_PREFIX = 'ORD';
const ORD_SEPARATOR = '';
const buildOrd = (digits) => `${ORD_PREFIX}${ORD_SEPARATOR}${digits}`;

// TODO (login step): replace with the email from Google sign-in.
const currentUserEmail = 'staff@aes.co.th';

// ------------------------------------------
// 2. STATE
// ------------------------------------------
let currentTheme = 'dark';
let uid = 0;
let blocks = [];   // [{ id, product, lots: [{ id, lot, qty, errLot, errQty }], err }]
let ordErr = false;

const nextId = () => ++uid;
const newLot = () => ({ id: nextId(), lot: '', qty: '', errLot: false, errQty: false });
const newBlock = () => ({ id: nextId(), product: null, lots: [newLot()], err: false, pickOpen: false, oldestN: '' });

// dd/mm/yyyy -> yyyymmdd (sortable number)
const dateKey = (d) => { const m = String(d || '').split('/'); return m.length === 3 ? Number(m[2] + m[1].padStart(2, '0') + m[0].padStart(2, '0')) : 0; };
// Lots that exist in stock for a product, oldest first (FIFO)
const availableLots = (code) => (MOCK_LOTS[code] || []).filter(l => l.qty > 0)
  .slice().sort((a, b) => dateKey(a.created) - dateKey(b.created) || a.lot.localeCompare(b.lot));
// Only products that still have stock can be ordered
const stockedProducts = () => MOCK_PRODUCTS.filter(p => availableLots(p.code).length > 0);
const isBlankLotRow = (l) => !l.lot && !l.qty;
const ensureOneLot = (block) => { if (!block.lots.length) block.lots.push(newLot()); };

// ------------------------------------------
// 3. SMALL HELPERS
// ------------------------------------------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const icon = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const productLabel = (p) => p ? `${p.code} | ${p.name}` : '';
const findBlock = (id) => blocks.find(b => b.id === Number(id));
const swalTheme = () => currentTheme === 'dark'
  ? { background: '#161b22', color: '#e6edf3' }
  : { background: '#ffffff', color: '#1f2328' };

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

// ------------------------------------------
// 4. RENDERING
// ------------------------------------------
function lotRowHTML(block, lot) {
  const unit = block.product ? block.product.unit : '';
  return `
    <div class="of-lot-row">
      <input type="text" class="of-input ${lot.errLot ? 'invalid' : ''}"
             data-field="lot" data-block="${block.id}" data-lot="${lot.id}"
             list="lots-${block.id}" value="${esc(lot.lot)}"
             inputmode="numeric" maxlength="${MAX_LOT_LEN}" placeholder="Lot ${LOT_RULE_TEXT}" autocomplete="off" />
      <input type="text" class="of-input ${lot.errQty ? 'invalid' : ''}"
             data-field="qty" data-block="${block.id}" data-lot="${lot.id}"
             value="${esc(lot.qty)}" inputmode="numeric" placeholder="จำนวน${unit ? ' (' + esc(unit) + ')' : ''}" autocomplete="off" />
      <button type="button" class="icon-btn of-lot-del" data-act="remove-lot"
              data-block="${block.id}" data-lot="${lot.id}"
              aria-label="ลบ Lot นี้" ${block.lots.length <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
    </div>
  `;
}

function lotPickerHTML(block) {
  const p = block.product;
  const avail = p ? availableLots(p.code) : [];
  if (!p || !avail.length) return '';
  const chosen = new Set(block.lots.map(l => l.lot));
  const chosenCount = avail.filter(a => chosen.has(a.lot)).length;

  const toggleBtn = `
    <button type="button" class="btn btn-outline btn-sm of-pick-toggle" data-act="toggle-pick" data-block="${block.id}">
      <span>${block.pickOpen ? 'ซ่อนรายการ Lot' : 'เลือก Lot จากรายการ'} (${chosenCount}/${avail.length})</span>
    </button>`;
  if (!block.pickOpen) return toggleBtn;

  return `
    ${toggleBtn}
    <div class="of-lotpick">
      <div class="of-lotpick-tools">
        <span>เลือก Lot เก่าสุด</span>
        <input type="text" class="of-input of-oldest-n" data-field="oldest-n" data-block="${block.id}"
               value="${esc(block.oldestN)}" inputmode="numeric" placeholder="กี่รายการ" autocomplete="off" />
        <button type="button" class="btn btn-primary btn-sm" data-act="pick-oldest" data-block="${block.id}">เลือก</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="clear-picked" data-block="${block.id}">ล้าง</button>
      </div>
      <div class="of-lotpick-list" data-list-block="${block.id}">
        ${avail.map(a => `
          <label class="of-lotpick-row">
            <input type="checkbox" data-act="toggle-lot" data-block="${block.id}" data-pick-lot="${esc(a.lot)}" ${chosen.has(a.lot) ? 'checked' : ''} />
            <span class="of-lp-lot">${esc(a.lot)}</span>
            <span class="of-lp-meta">คงเหลือ ${esc(a.qty)} ${esc(p.unit)} · ${esc(a.created)}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function blockHTML(block, index) {
  const p = block.product;
  const lotSuggestions = p ? (MOCK_LOTS[p.code] || []) : [];
  return `
    <div class="of-block ${block.err ? 'of-block-err' : ''}" data-block-el="${block.id}">
      <div class="of-block-head">
        <div class="of-block-title">สินค้า ${index + 1}</div>
        <button type="button" class="icon-btn" data-act="remove-block" data-block="${block.id}"
                aria-label="ลบสินค้านี้" ${blocks.length <= 1 ? 'style="display:none"' : ''}>${icon('trash')}</button>
      </div>

      <div class="of-field">
        <label class="of-label">รหัสสินค้า</label>
        <div class="of-combo">
          <input type="text" class="of-input of-combo-input ${block.err ? 'invalid' : ''}"
                 data-field="combo" data-block="${block.id}"
                 value="${esc(productLabel(p))}" placeholder="พิมพ์ค้นหารหัส หรือชื่อสินค้า" autocomplete="off" />
          <div class="of-combo-list" hidden></div>
        </div>
      </div>

      <div class="of-after" ${p ? '' : 'hidden'}>
        <div class="of-prod-line">
          <span class="chip" style="color:var(--accent-blue)">${esc(p ? p.code : '')}</span>
          <span>${esc(p ? p.name : '')}</span>
        </div>

        ${lotPickerHTML(block)}

        <div class="of-lot-head"><span>Lot Number</span><span>จำนวนที่สั่ง</span><span></span></div>
        <div class="of-lots">
          ${block.lots.map(l => lotRowHTML(block, l)).join('')}
        </div>

        <datalist id="lots-${block.id}">
          ${lotSuggestions.map(s => `<option value="${esc(s.lot)}">คงเหลือ ${esc(s.qty)} ${esc(p.unit)} · ${esc(s.created)}</option>`).join('')}
        </datalist>

        <button type="button" class="btn btn-outline btn-sm of-add-lot" data-act="add-lot" data-block="${block.id}">
          ${icon('plus', 'ic ic-sm')}<span>เพิ่ม Lot</span>
        </button>
      </div>
    </div>
  `;
}

function render() {
  const host = document.getElementById('product-blocks');
  host.innerHTML = blocks.map((b, i) => blockHTML(b, i)).join('');
  document.getElementById('ord-input').classList.toggle('invalid', ordErr);
  updateSummary();
}

function updateSummary() {
  const productCount = blocks.filter(b => b.product).length;
  const lotCount = blocks.reduce((sum, b) => sum + (b.product ? b.lots.filter(l => l.lot || l.qty).length : 0), 0);
  document.getElementById('of-summary').textContent = `${productCount} สินค้า · ${lotCount} Lot`;
}

// ------------------------------------------
// 5. PRODUCT COMBOBOX (searchable dropdown)
// ------------------------------------------
function showComboList(inputEl) {
  const list = inputEl.parentElement.querySelector('.of-combo-list');
  const block = findBlock(inputEl.dataset.block);
  // If a product is already chosen, tapping the box shows the whole list again
  const showingChosen = block && block.product && inputEl.value === productLabel(block.product);
  const q = showingChosen ? '' : inputEl.value.trim().toLowerCase();
  const matches = stockedProducts().filter(p =>
    !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  ).slice(0, 30);

  list.innerHTML = matches.length
    ? matches.map(p => `
        <div class="of-combo-item" data-pick="${esc(p.code)}" data-block="${inputEl.dataset.block}">
          <span class="of-combo-code">${esc(p.code)}</span>
          <span class="of-combo-name">${esc(p.name)}</span>
        </div>`).join('')
    : '<div class="of-combo-empty">ไม่พบสินค้า</div>';
  list.hidden = false;
}

function hideAllComboLists() {
  document.querySelectorAll('.of-combo-list').forEach(l => { l.hidden = true; });
}

function pickProduct(blockId, code) {
  const block = findBlock(blockId);
  const product = MOCK_PRODUCTS.find(p => p.code === code);
  if (!block || !product) return;
  block.product = product;
  block.err = false;
  render();
  // Jump straight to the first empty lot field of this block
  const firstLot = document.querySelector(`[data-field="lot"][data-block="${block.id}"]`);
  if (firstLot) firstLot.focus();
}

// ------------------------------------------
// 6. FORM ACTIONS
// ------------------------------------------
function addBlock() {
  blocks.push(newBlock());
  render();
  const last = document.querySelector('#product-blocks .of-block:last-child .of-combo-input');
  if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.focus(); }
}

function removeBlock(blockId) {
  if (blocks.length <= 1) return;
  blocks = blocks.filter(b => b.id !== Number(blockId));
  render();
}

function addLot(blockId) {
  const block = findBlock(blockId);
  if (!block) return;
  const lot = newLot();
  block.lots.push(lot);
  render();
  const el = document.querySelector(`[data-field="lot"][data-lot="${lot.id}"]`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
}

function removeLot(blockId, lotId) {
  const block = findBlock(blockId);
  if (!block || block.lots.length <= 1) return;
  block.lots = block.lots.filter(l => l.id !== Number(lotId));
  render();
}

// Re-render but keep the lot list scroll position (so ticking boxes doesn't jump)
function renderKeepScroll(blockId) {
  const sel = `[data-list-block="${blockId}"]`;
  const before = document.querySelector(sel);
  const top = before ? before.scrollTop : 0;
  render();
  const after = document.querySelector(sel);
  if (after) after.scrollTop = top;
}

function togglePick(blockId) {
  const block = findBlock(blockId);
  if (!block) return;
  block.pickOpen = !block.pickOpen;
  render();
}

// Tick / untick one lot. Quantity defaults to what is left in stock (editable).
function toggleLot(blockId, lotNo, checked) {
  const block = findBlock(blockId);
  if (!block || !block.product) return;
  if (checked) {
    const info = availableLots(block.product.code).find(a => a.lot === lotNo);
    if (!info || block.lots.some(l => l.lot === lotNo)) return;
    block.lots = block.lots.filter(l => !isBlankLotRow(l));
    block.lots.push({ id: nextId(), lot: lotNo, qty: String(info.qty), errLot: false, errQty: false });
  } else {
    block.lots = block.lots.filter(l => l.lot !== lotNo);
    ensureOneLot(block);
  }
  renderKeepScroll(blockId);
}

// Replace the selection with the N oldest lots (FIFO)
function pickOldest(blockId) {
  const block = findBlock(blockId);
  if (!block || !block.product) return;
  const n = parseInt(block.oldestN, 10);
  if (!n || n <= 0) {
    Swal.fire({ icon: 'warning', title: 'ใส่จำนวนรายการ', text: 'กรอกว่าต้องการ Lot เก่าสุดกี่รายการ', confirmButtonText: 'ตกลง', ...swalTheme() });
    return;
  }
  block.lots = availableLots(block.product.code).slice(0, n)
    .map(a => ({ id: nextId(), lot: a.lot, qty: String(a.qty), errLot: false, errQty: false }));
  ensureOneLot(block);
  renderKeepScroll(blockId);
}

function clearPicked(blockId) {
  const block = findBlock(blockId);
  if (!block) return;
  block.lots = [newLot()];
  renderKeepScroll(blockId);
}

// ------------------------------------------
// 7. VALIDATE + SAVE
// ------------------------------------------
function validateForm() {
  const errors = [];
  const warnings = [];
  const rows = [];
  const seen = new Set();   // "productCode|lot" must be unique across the whole order

  const ordDigits = document.getElementById('ord-input').value.trim();
  const ord = ordDigits ? buildOrd(ordDigits) : '';
  ordErr = !ordDigits;
  if (ordErr) errors.push('กรุณากรอกเลข ORD (ตัวเลขเท่านั้น)');

  blocks.forEach((b, i) => {
    b.err = !b.product;
    if (b.err) errors.push(`สินค้า ${i + 1}: กรุณาเลือกรหัสสินค้า`);

    b.lots.forEach((l, j) => {
      l.errLot = false; l.errQty = false;
      if (!b.product) return;

      const lotOk = isValidLot(l.lot);
      const qtyNum = Number(l.qty);
      const qtyOk = Number.isInteger(qtyNum) && qtyNum > 0;

      if (!lotOk) { l.errLot = true; errors.push(`สินค้า ${i + 1} · Lot ${j + 1}: Lot ต้องเป็นตัวเลข ${LOT_RULE_TEXT}`); }
      if (!qtyOk) { l.errQty = true; errors.push(`สินค้า ${i + 1} · Lot ${j + 1}: จำนวนต้องมากกว่า 0`); }

      if (lotOk) {
        const key = `${b.product.code}|${l.lot}`;
        if (seen.has(key)) { l.errLot = true; errors.push(`สินค้า ${i + 1} · Lot ${j + 1}: Lot ${l.lot} ซ้ำในใบสั่งนี้`); }
        seen.add(key);
      }

      // Soft warnings (do not block saving)
      if (lotOk && qtyOk) {
        const known = availableLots(b.product.code);
        if (known.length) {
          const info = known.find(a => a.lot === l.lot);
          if (!info) warnings.push(`Lot ${l.lot} (${b.product.code}) ไม่พบในระบบสำหรับสินค้านี้`);
          else if (qtyNum > info.qty) warnings.push(`Lot ${l.lot}: สั่ง ${qtyNum} แต่คงเหลือ ${info.qty}`);
        }
      }

      if (lotOk && qtyOk) {
        rows.push({ ord, productCode: b.product.code, productName: b.product.name, unit: b.product.unit, lot: l.lot, qty: qtyNum });
      }
    });
  });

  return { ord, errors, warnings, rows };
}

function formatNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function saveOrder() {
  const { errors, warnings, rows } = validateForm();
  render();   // show red borders

  if (errors.length) {
    const firstBad = document.querySelector('.invalid');
    if (firstBad) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    Swal.fire({
      icon: 'warning',
      title: 'กรอกข้อมูลไม่ครบ',
      html: `<div style="text-align:left; font-size:15px; line-height:1.7;">${errors.slice(0, 6).map(e => '• ' + esc(e)).join('<br>')}${errors.length > 6 ? `<br>… และอีก ${errors.length - 6} รายการ` : ''}</div>`,
      confirmButtonText: 'ตกลง',
      ...swalTheme()
    });
    return;
  }

  const stamp = formatNow();
  const preview = rows.map(r => `
    <tr>
      <td style="padding:4px 8px;">${esc(r.productCode)}</td>
      <td style="padding:4px 8px;">${esc(r.lot)}</td>
      <td style="padding:4px 8px; text-align:right;">${esc(r.qty)} ${esc(r.unit)}</td>
    </tr>`).join('');

  const { isConfirmed } = await Swal.fire({
    title: 'ตรวจสอบก่อนบันทึก',
    html: `
      <div style="text-align:left; font-size:15px; line-height:1.7;">
        <div><strong>ORD:</strong> ${esc(rows[0].ord)}</div>
        <div><strong>เวลา:</strong> ${esc(stamp)}</div>
        <div><strong>ผู้บันทึก:</strong> ${esc(currentUserEmail)}</div>
        ${warnings.length ? `<div style="margin:8px 0; padding:8px 10px; border-radius:8px; font-size:14px; background:rgba(210,153,34,.14); color:#d29922;">⚠ ตรวจสอบอีกครั้ง:<br>${warnings.slice(0, 5).map(w => esc(w)).join('<br>')}${warnings.length > 5 ? `<br>… และอีก ${warnings.length - 5} รายการ` : ''}</div>` : ''}
        <table style="width:100%; margin-top:8px; border-collapse:collapse; font-size:14px;">
          <tr style="opacity:.7;"><td style="padding:4px 8px;">รหัสสินค้า</td><td style="padding:4px 8px;">Lot</td><td style="padding:4px 8px; text-align:right;">จำนวน</td></tr>
          ${preview}
        </table>
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'ยืนยันบันทึก',
    cancelButtonText: 'กลับไปแก้ไข',
    confirmButtonColor: '#238636',
    cancelButtonColor: '#30363d',
    ...swalTheme()
  });
  if (!isConfirmed) return;

  // TODO (backend step): replace this block with
  //   const res = await safeFetch('saveOrder', { ord, rows });
  // Each row = one line in sheet OFFICE_LOG (timestamp + email added server-side).
  const payload = rows.map(r => ({ timestamp: stamp, userEmail: currentUserEmail, ...r }));
  console.log('OFFICE_LOG rows (not sent yet):', payload);

  await Swal.fire({
    icon: 'success',
    title: 'บันทึกแล้ว (โหมดทดลอง)',
    text: `เตรียมข้อมูล ${rows.length} รายการแล้ว แต่ยังไม่ได้ส่งไปที่ Google Sheet`,
    confirmButtonText: 'ตกลง',
    ...swalTheme()
  });

  resetForm();
}

function resetForm() {
  document.getElementById('ord-input').value = '';
  ordErr = false;
  blocks = [newBlock()];
  render();
  document.getElementById('view-order').scrollTo({ top: 0, behavior: 'smooth' });
}

// ------------------------------------------
// 8. EVENT WIRING (delegation)
// ------------------------------------------
function wireEvents() {
  const host = document.getElementById('product-blocks');

  // typing
  host.addEventListener('input', (e) => {
    const el = e.target;
    const field = el.dataset.field;
    if (!field) return;
    const block = findBlock(el.dataset.block);
    if (!block) return;

    if (field === 'combo') {
      // Typing again means "I'm choosing another product"
      if (block.product && el.value !== productLabel(block.product)) {
        block.product = null;
        el.closest('.of-block').querySelector('.of-after').hidden = true;
      }
      showComboList(el);
      updateSummary();
      return;
    }

    if (field === 'oldest-n') {
      el.value = el.value.replace(/\D/g, '');
      block.oldestN = el.value;
      return;
    }

    const lot = block.lots.find(l => l.id === Number(el.dataset.lot));
    if (!lot) return;

    if (field === 'lot') {
      el.value = el.value.replace(/\D/g, '').slice(0, MAX_LOT_LEN);
      lot.lot = el.value; lot.errLot = false;
    } else if (field === 'qty') {
      el.value = el.value.replace(/\D/g, '');
      lot.qty = el.value; lot.errQty = false;
    }
    el.classList.remove('invalid');
    updateSummary();
  });

  // open the list when the product box is focused
  host.addEventListener('focusin', (e) => {
    if (e.target.dataset.field === 'combo') showComboList(e.target);
  });

  // picking a product (pointerdown so it fires before the input loses focus)
  host.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.of-combo-item');
    if (!item) return;
    e.preventDefault();
    pickProduct(item.dataset.block, item.dataset.pick);
  });

  // buttons
  document.getElementById('view-order').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add-block') addBlock();
    else if (act === 'remove-block') removeBlock(btn.dataset.block);
    else if (act === 'add-lot') addLot(btn.dataset.block);
    else if (act === 'remove-lot') removeLot(btn.dataset.block, btn.dataset.lot);
    else if (act === 'toggle-pick') togglePick(btn.dataset.block);
    else if (act === 'pick-oldest') pickOldest(btn.dataset.block);
    else if (act === 'clear-picked') clearPicked(btn.dataset.block);
    else if (act === 'toggle-lot') toggleLot(btn.dataset.block, btn.dataset.pickLot, btn.checked);
  });

  // clicking anywhere else closes the product list
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.of-combo')) hideAllComboLists();
  });

  document.getElementById('ord-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');   // digits only
    ordErr = false;
    e.target.classList.remove('invalid');
  });
}

// ------------------------------------------
// 9. INIT
// ------------------------------------------
window.onload = () => {
  document.getElementById('sidebar-user').textContent = currentUserEmail;
  document.getElementById('ord-prefix').textContent = ORD_PREFIX + ORD_SEPARATOR;
  blocks = [newBlock()];
  render();
  wireEvents();
};
