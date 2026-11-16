const APP_CONFIG = {
  desktopMinWidth: 900,
  defaultTheme: 'light',
  currentUserEmail: 'staff@aes.co.th'
};

const WAREHOUSE_CONFIG = {
  tileSize: 1.0,
  levelHeight: 0.85,
  gap: 0.1
};

const VIEW_TITLES = {
  scanner: 'สแกนเนอร์บาร์โค้ด',
  '3d': 'แผนผังคลัง 3D',
  ops: 'จัดการหยิบ / เติม / ย้าย',
  audit: 'ตรวจสอบยอด ERP'
};

const CATEGORY_COLORS = {
  'กระทะ': { hex: 0x2f81f7, css: '#2f81f7' },
  'ยางนอก': { hex: 0x238636, css: '#238636' },
  'ยางนอกเรเดียล': { hex: 0x238636, css: '#238636' },
  'ยางในธรรมชาติ': { hex: 0xe3b341, css: '#e3b341' },
  'ยางในบิวทิล': { hex: 0xd29922, css: '#d29922' },
  'ยางรอง': { hex: 0xa371f7, css: '#a371f7' },
  'ฮ.น้ำมัน': { hex: 0xda3633, css: '#da3633' },
  'ฮ.เบ็ดเตล็ด': { hex: 0xdb61a2, css: '#db61a2' }
};

const DEFAULT_COLOR = { hex: 0x8b949e, css: '#8b949e' };

const CRITERIA_COLORS = {
  FAST: { hex: 0x238636, css: '#238636', label: 'FAST · ขายเร็ว' },
  MEDIUM: { hex: 0xe3b341, css: '#e3b341', label: 'MEDIUM · ปานกลาง' },
  SLOW: { hex: 0xf0883e, css: '#f0883e', label: 'SLOW · เริ่มช้า' },
  DEAD: { hex: 0xda3633, css: '#da3633', label: 'DEAD · สต็อกนิ่ง' }
};
