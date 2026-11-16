/* Warehouse 3D visualization module. */
const Warehouse3D = (() => {
  const items = [];
  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let gridHelper = null;
  let floorMesh = null;
  let currentTheme = APP_CONFIG.defaultTheme;
  let isHeatmapMode = false;
  let activeTypeFilter = null;
  let activeCriteriaFilter = null;

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

  function updateGridAndFloor() {
    if (!scene) return;
    if (gridHelper) scene.remove(gridHelper);
    if (floorMesh) scene.remove(floorMesh);
    const isDark = currentTheme === 'dark';
    gridHelper = new THREE.GridHelper(60, 60, isDark ? 0x58a6ff : 0x1a6fe0, isDark ? 0x30363d : 0xdde1e6);
    gridHelper.position.set(30, 0, 10);
    gridHelper.scale.set(1, 1, 20 / 60);
    scene.add(gridHelper);
    floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 20),
      new THREE.MeshBasicMaterial({ color: isDark ? 0x161b22 : 0xeceff2, side: THREE.DoubleSide })
    );
    floorMesh.rotation.x = Math.PI / 2;
    floorMesh.position.set(30, -0.01, 10);
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
