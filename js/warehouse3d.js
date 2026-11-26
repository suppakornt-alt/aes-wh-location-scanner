/* Warehouse 3D visualization module. */
const Warehouse3D = (() => {
  const items = [];
  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let gridHelper = null;
  let floorMesh = null;
  let axisLabelGroup = null;
  let currentTheme = APP_CONFIG.defaultTheme;
  let isHeatmapMode = false;
  let activeTypeFilter = null;
  let activeCriteriaFilter = null;

  // Keep the floor dimensions and coordinate labels on the same 60 x 20 model.
  const WAREHOUSE_LENGTH = 60;
  const WAREHOUSE_WIDTH = 20;
  const AXIS_LABEL_Y = 0.22;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const icon = (name, cls = 'ic ic-sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

  function getCategoryColor(type) {
    const key = String(type ?? '').trim();
    return CATEGORY_COLORS[key] ? CATEGORY_COLORS[key].hex : DEFAULT_COLOR.hex;
  }

  function getCriteriaColor(criteria) {
    const key = String(criteria || 'FAST').trim().toUpperCase();
    return CRITERIA_COLORS[key] ? CRITERIA_COLORS[key].hex : CRITERIA_COLORS.FAST.hex;
  }

  function applyCurrentColoring() {
    items.forEach(box => {
      box.material.color.setHex(isHeatmapMode ? getCriteriaColor(box.userData.criteria) : box.userData.originalColor);
      box.material.opacity = 0.85;
      box.userData.edgeLine.material.opacity = 0.8;
    });
  }

  function dimOrHighlight(box, match) {
    if (match) {
      box.material.color.setHex(isHeatmapMode ? getCriteriaColor(box.userData.criteria) : box.userData.originalColor);
      box.material.opacity = 1.0;
      box.userData.edgeLine.material.opacity = 1.0;
    } else {
      box.material.color.setHex(0x333333);
      box.material.opacity = 0.15;
      box.userData.edgeLine.material.opacity = 0.05;
    }
  }

  function toggleHeatmapMode() {
    isHeatmapMode = !isHeatmapMode;
    document.getElementById('heatmap-toggle-btn')?.classList.toggle('active', isHeatmapMode);
    const label = document.getElementById('heatmap-label');
    if (label) label.innerText = isHeatmapMode ? 'ปิด Heatmap' : 'เปิด Heatmap';
    applyCurrentColoring();
    closeSidebarIfMobile();
  }

  function filterByCriteria(key) {
    activeCriteriaFilter = activeCriteriaFilter === key ? null : key;
    activeTypeFilter = null;
    items.forEach(box => dimOrHighlight(box, !activeCriteriaFilter || String(box.userData.criteria).toUpperCase() === activeCriteriaFilter));
    closeSidebarIfMobile();
  }

  function filterByType(type) {
    activeTypeFilter = activeTypeFilter === type ? null : type;
    activeCriteriaFilter = null;
    items.forEach(box => {
      const itemType = String(box.userData.type ?? '').trim();
      dimOrHighlight(box, !activeTypeFilter || (type === 'อื่นๆ' ? !CATEGORY_COLORS[itemType] : itemType === type));
    });
    closeSidebarIfMobile();
  }

  function renderLegend() {
    const container = document.getElementById('legend-list');
    if (!container) return;
    container.innerHTML = '';
    const add = (label, css, handler) => {
      const element = document.createElement('div');
      element.className = 'legend-item';
      element.onclick = handler;
      element.innerHTML = `<span class="legend-dot" style="background-color:${css};"></span><span class="legend-name">${escapeHtml(label)}</span>`;
      container.appendChild(element);
    };
    Object.keys(CATEGORY_COLORS).forEach(type => add(type, CATEGORY_COLORS[type].css, () => filterByType(type)));
    add('อื่นๆ', DEFAULT_COLOR.css, () => filterByType('อื่นๆ'));
  }

  function updateVelocitySummary(sheetData) {
    const skuMap = {};
    sheetData.forEach(item => {
      const sku = String(item.sku ?? '').trim();
      if (sku && !skuMap[sku]) skuMap[sku] = String(item.criteria || 'FAST').trim().toUpperCase();
    });
    const total = Object.keys(skuMap).length;
    if (!total) return;
    const counts = { FAST: 0, MEDIUM: 0, SLOW: 0, DEAD: 0 };
    Object.values(skuMap).forEach(criteria => { if (criteria in counts) counts[criteria]++; });
    Object.keys(counts).forEach(key => {
      const percent = Math.round((counts[key] / total) * 100);
      const suffix = key.toLowerCase();
      const percentElement = document.getElementById(`pct-${suffix}`);
      const barElement = document.getElementById(`bar-${suffix}`);
      if (percentElement) percentElement.innerText = `${percent}%`;
      if (barElement) barElement.style.width = `${percent}%`;
    });
    const totalLabel = document.getElementById('velocity-total-sku-label');
    if (totalLabel) totalLabel.innerText = `คำนวณจาก ${total} SKUs ที่มีตำแหน่ง`;
  }

  function columnNumberToName(columnNumber) {
    // Match spreadsheet-style warehouse columns so X=1 is A and X=60 is BH.
    let value = columnNumber;
    let name = '';
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function getAxisLabelColor() {
    // Use theme-aware gray shades so labels remain readable on both floor colors.
    return currentTheme === 'dark' ? 0xb8bec8 : 0x6b7280;
  }

  function createAxisLabel(text) {
    // Canvas-backed sprites keep coordinate text facing the camera during orbiting.
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '600 36px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.fillText(String(text), canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: getAxisLabelColor(),
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const label = new THREE.Sprite(material);
    const isWideLabel = String(text).length > 1;
    label.scale.set(isWideLabel ? 0.82 : 0.56, 0.42, 1);
    label.renderOrder = 10;
    return label;
  }

  function updateAxisLabelColors() {
    if (!axisLabelGroup) return;
    const color = getAxisLabelColor();
    axisLabelGroup.children.forEach(label => label.material.color.setHex(color));
  }

  function addAxisLabels() {
    if (!scene) return;
    if (axisLabelGroup) scene.remove(axisLabelGroup);
    axisLabelGroup = new THREE.Group();

    // Center X labels on columns 1-60 and offset the line slightly to avoid the axis crossing.
    for (let x = 1; x <= WAREHOUSE_LENGTH; x++) {
      const label = createAxisLabel(columnNumberToName(x));
      label.position.set(x - 0.5, AXIS_LABEL_Y, (WAREHOUSE_WIDTH / 2) - 0.3);
      axisLabelGroup.add(label);
    }

    // Center Z labels on rows 1-20 with a matching offset on the perpendicular center line.
    for (let z = 1; z <= WAREHOUSE_WIDTH; z++) {
      const label = createAxisLabel(z);
      label.position.set((WAREHOUSE_LENGTH / 2) + 0.3, AXIS_LABEL_Y, z - 0.5);
      axisLabelGroup.add(label);
    }

    scene.add(axisLabelGroup);
  }

  function updateGridAndFloor() {
    if (!scene) return;
    if (gridHelper) scene.remove(gridHelper);
    if (floorMesh) scene.remove(floorMesh);
    const isDark = currentTheme === 'dark';
    gridHelper = new THREE.GridHelper(WAREHOUSE_LENGTH, WAREHOUSE_LENGTH, isDark ? 0x58a6ff : 0x1a6fe0, isDark ? 0x30363d : 0xdde1e6);
    gridHelper.position.set(WAREHOUSE_LENGTH / 2, 0, WAREHOUSE_WIDTH / 2);
    gridHelper.scale.set(1, 1, WAREHOUSE_WIDTH / WAREHOUSE_LENGTH);
    scene.add(gridHelper);
    floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WAREHOUSE_LENGTH, WAREHOUSE_WIDTH),
      new THREE.MeshBasicMaterial({ color: isDark ? 0x161b22 : 0xeceff2, side: THREE.DoubleSide })
    );
    floorMesh.rotation.x = Math.PI / 2;
    floorMesh.position.set(WAREHOUSE_LENGTH / 2, -0.01, WAREHOUSE_WIDTH / 2);
    scene.add(floorMesh);
  }

  function showDetail(detail) {
    const card = document.getElementById('detail-card');
    if (!card) return;
    card.innerHTML = `
      <div class="dc-head">
        <div class="dc-title">${escapeHtml(detail.name)}</div>
        <button class="icon-btn" onclick="hideDetail()">${icon('close')}</button>
      </div>
      <div class="dc-grid">
        <span>SKU</span><span>${escapeHtml(detail.sku)}</span>
        <span>ประเภท</span><span>${escapeHtml(detail.type)}</span>
        <span>จำนวน</span><span>${escapeHtml(detail.qty)} ${escapeHtml(detail.unit || 'เส้น')}</span>
        <span>พิกัด</span><span>${escapeHtml(detail.displayLoc)}</span>
      </div>
    `;
    card.style.display = 'block';
  }

  function hideDetail() {
    const card = document.getElementById('detail-card');
    if (card) card.style.display = 'none';
  }

  function setupInteractions() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dom = renderer.domElement;
    let downPosition = null;
    const hitAt = event => {
      const rect = dom.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(items);
      return hits.length ? hits[0].object.userData : null;
    };
    dom.addEventListener('pointerdown', event => { downPosition = { x: event.clientX, y: event.clientY }; });
    dom.addEventListener('pointerup', event => {
      if (!downPosition || Math.hypot(event.clientX - downPosition.x, event.clientY - downPosition.y) > 6) return;
      const detail = hitAt(event);
      detail ? showDetail(detail) : hideDetail();
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function init(theme = 'dark') {
    const container = document.getElementById('canvas-container');
    if (!container || !window.THREE) return;
    currentTheme = theme;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(currentTheme === 'dark' ? 0x0d1117 : 0xf4f6f8);
    camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500);
    camera.position.set(30, 35, 45);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(30, 0, 10);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    updateGridAndFloor();
    addAxisLabels();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.55);
    directionalLight.position.set(30, 40, 20);
    scene.add(directionalLight);
    setupInteractions();
    animate();
    renderLegend();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    else window.addEventListener('resize', resize);
  }

  function resize() {
    const container = document.getElementById('canvas-container');
    if (!renderer || !camera || !container || !container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  function render(sheetData) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    items.forEach(box => scene?.remove(box));
    items.length = 0;
    if (!scene || !sheetData?.length) return;
    sheetData.forEach(item => {
      const width = (Math.abs(item.colEnd - item.colStart) + 1) * WAREHOUSE_CONFIG.tileSize - WAREHOUSE_CONFIG.gap;
      const height = (Math.abs(item.maxLvl - item.minLvl) + 1) * WAREHOUSE_CONFIG.levelHeight;
      const depth = (Math.abs(item.rowEnd - item.rowStart) + 1) * WAREHOUSE_CONFIG.tileSize - WAREHOUSE_CONFIG.gap;
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const originalColor = getCategoryColor(item.type);
      const box = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: isHeatmapMode ? getCriteriaColor(item.criteria) : originalColor,
        roughness: 0.35,
        transparent: true,
        opacity: 0.85
      }));
      box.position.set(
        ((item.colStart + item.colEnd) / 2) - 0.5,
        (item.minLvl - 1) * WAREHOUSE_CONFIG.levelHeight + (height / 2),
        ((item.rowStart + item.rowEnd) / 2) - 0.5
      );
      const edgeLine = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
      );
      box.add(edgeLine);
      box.userData = { ...item, originalColor, edgeLine };
      scene.add(box);
      items.push(box);
    });
    updateVelocitySummary(sheetData);
  }

  function setTheme(theme) {
    currentTheme = theme;
    if (scene) {
      scene.background.setHex(currentTheme === 'dark' ? 0x0d1117 : 0xf4f6f8);
      updateGridAndFloor();
      updateAxisLabelColors();
    }
  }

  function search(query) {
    const normalized = String(query ?? '').trim().toUpperCase();
    if (!normalized) return resetSearch();
    items.forEach(box => {
      const match = String(box.userData.sku).toUpperCase().includes(normalized) || String(box.userData.name).toUpperCase().includes(normalized);
      dimOrHighlight(box, match);
    });
  }

  function resetSearch() {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    applyCurrentColoring();
  }

  return { init, resize, render, setTheme, toggleHeatmapMode, filterByCriteria, filterByType, search, resetSearch, hideDetail };
})();
