import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createRibbonGeometry } from './geometry.js';

const $ = (selector) => document.querySelector(selector);
const defaults = { growth: .56, turns: 2.4, pitch: 1.85, radius: 1.65, width: 1.08, thickness: .07, twist: .5, taper: .22, asymmetry: .18 };
const params = { ...defaults };
const presets = {
  loop: { ...defaults, growth: 0, width: 1.5, taper: .3, asymmetry: .25 },
  growth: { ...defaults },
  helix: { ...defaults, growth: 1, turns: 2.65, pitch: 1.95, width: 1.15, taper: .16 },
};
const backgrounds = { light: '#e9ecef', dark: '#161b20', coral: '#f5c6b9', white: '#ffffff' };
let background = 'light';
let scene, camera, renderer, controls, mesh, material, floor, pmrem, environment;
let pendingGeometry = false;
let exportBusy = false;
let toastTimeout;
const rotation = { x: 0, y: 0, z: 0 };
const tabGrowth = { loop: 0, growth: defaults.growth, helix: 1 };
const STORAGE_KEY = 'one-mount-helix-studio-v2';
let activePreset = 'growth';
let objectDragMode = false;
let persistEnabled = false;
let saveTimer;

function saveState() {
  if (!persistEnabled || !camera || !mesh) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const state = {
    params: { ...params }, tabGrowth: { ...tabGrowth }, activePreset,
    rotation: { ...rotation }, objectDragMode,
    color: $('#object-color').value, material: $('#material').value, background,
    exportSize: $('#export-size').value, exportRatio: $('#export-ratio').value,
    transparent: $('#transparent').checked,
    autoOrbit: controls.autoRotate,
    camera: { position: camera.position.toArray(), target: controls.target.toArray(), view: $('#view-name').textContent },
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Editing still works when storage is disabled. */ }
}

function scheduleSave() {
  if (persistEnabled && saveTimer === undefined) saveTimer = setTimeout(saveState, 200);
}

function readSavedState() {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch { return null; }
}

function updateFloor() {
  mesh.updateMatrixWorld(true);
  floor.position.y = new THREE.Box3().setFromObject(mesh).min.y - .1;
}

function syncRotationInputs() {
  document.querySelectorAll('[data-rotation]').forEach(input => {
    const value = rotation[input.dataset.rotation];
    input.value = value;
    input.style.setProperty('--range-progress', `${(value + 180) / 3.6}%`);
    document.querySelector(`[data-rotation-value="${input.dataset.rotation}"]`).textContent = `${Math.round(value)}°`;
  });
}

function applyRotation() {
  mesh.rotation.set(...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(rotation[axis])));
  updateFloor();
  syncRotationInputs();
  scheduleSave();
}

function setObjectDragMode(enabled) {
  objectDragMode = Boolean(enabled);
  controls.enableRotate = !objectDragMode;
  $('#toggle-object-drag').setAttribute('aria-pressed', String(objectDragMode));
  $('#toggle-object-drag').classList.toggle('active', objectDragMode);
  renderer.domElement.style.cursor = objectDragMode ? 'grab' : '';
  $('.orbit-hint').innerHTML = `${objectDragMode ? 'Drag to rotate shape' : 'Drag to orbit'} <span>·</span> Scroll to zoom <span>·</span> Right-drag to pan`;
  if (objectDragMode) {
    controls.autoRotate = false;
    $('#toggle-rotate').setAttribute('aria-pressed', 'false');
    $('#toggle-rotate').classList.remove('active');
  }
  scheduleSave();
}

function restoreState(saved) {
  for (const input of document.querySelectorAll('[data-param]')) {
    const value = saved.params?.[input.dataset.param];
    if (Number.isFinite(value)) params[input.dataset.param] = THREE.MathUtils.clamp(value, +input.min, +input.max);
  }
  params.thickness = Math.min(params.thickness, params.width * .45);
  for (const name of Object.keys(tabGrowth)) {
    if (Number.isFinite(saved.tabGrowth?.[name])) tabGrowth[name] = THREE.MathUtils.clamp(saved.tabGrowth[name], 0, 1);
  }
  activePreset = Object.hasOwn(presets, saved.activePreset) ? saved.activePreset : 'growth';
  tabGrowth[activePreset] = params.growth;
  for (const axis of Object.keys(rotation)) {
    if (Number.isFinite(saved.rotation?.[axis])) rotation[axis] = THREE.MathUtils.clamp(saved.rotation[axis], -180, 180);
  }
  if (/^#[0-9a-f]{6}$/i.test(saved.color)) $('#object-color').value = saved.color;
  if (['ceramic', 'chrome', 'ink'].includes(saved.material)) $('#material').value = saved.material;
  if (['1200', '2400', '4096'].includes(saved.exportSize)) $('#export-size').value = saved.exportSize;
  if (['viewport', 'square', 'landscape', 'portrait'].includes(saved.exportRatio)) $('#export-ratio').value = saved.exportRatio;
  $('#transparent').checked = saved.transparent === true;
  setMaterial();
  setBackground(saved.background);
  selectPreset(activePreset, true);
  applyRotation();
  setObjectDragMode(saved.objectDragMode === true);
  controls.autoRotate = saved.autoOrbit === true && !objectDragMode;
  $('#toggle-rotate').setAttribute('aria-pressed', String(controls.autoRotate));
  $('#toggle-rotate').classList.toggle('active', controls.autoRotate);
  const validVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (validVector(saved.camera?.position) && validVector(saved.camera?.target)) {
    const position = new THREE.Vector3().fromArray(saved.camera.position);
    const target = new THREE.Vector3().fromArray(saved.camera.target);
    if (position.distanceTo(target) >= controls.minDistance && position.distanceTo(target) <= controls.maxDistance) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      const views = { Perspective: 'perspective', 'One Mount logo angle': 'logo', Front: 'front', Side: 'side', Top: 'top' };
      const view = views[saved.camera.view];
      $('#view-name').textContent = view ? saved.camera.view : 'Custom orbit';
      document.querySelectorAll('[data-view]').forEach(button => {
        const active = button.dataset.view === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
  }
}

function toast(message) {
  const target = $('#toast');
  if (!target) return;
  target.textContent = message;
  target.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => target.classList.remove('visible'), 3400);
}

function displayValue(name, value) {
  if (name === 'growth') return `${Math.round(value * 100)}%`;
  if (name === 'twist') return `${Math.round(value * 360)}°`;
  if (name === 'taper' || name === 'asymmetry') return `${Math.round(value * 100)}%`;
  if (name === 'turns') return value.toFixed(2).replace(/0$/, '');
  return value.toFixed(name === 'thickness' ? 3 : 2).replace(/0$/, '');
}

function syncInputs() {
  document.querySelectorAll('[data-param]').forEach(input => {
    const name = input.dataset.param;
    input.value = params[name];
    input.style.setProperty('--range-progress', `${(params[name] - +input.min) / (+input.max - +input.min) * 100}%`);
    const output = document.querySelector(`[data-value="${name}"]`);
    if (output) output.textContent = displayValue(name, params[name]);
  });
}

function rebuild() {
  const geometry = createRibbonGeometry({ ...params, segments: 420 });
  if (mesh) { mesh.geometry.dispose(); mesh.geometry = geometry; }
  else {
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  updateFloor();
  const mobius = Math.abs(Math.round(geometry.userData.effectiveTwist * 2) % 2) === 1;
  $('#geometry-info').textContent = params.growth < .001 ? (mobius ? 'Closed Möbius ribbon' : 'Closed ribbon') : `${geometry.userData.effectiveTurns.toFixed(2)} turns · Continuous ribbon`;
  document.querySelector('[data-value="twist"]').textContent = displayValue('twist', geometry.userData.effectiveTwist);
  pendingGeometry = false;
}

function setBackground(name) {
  background = backgrounds[name] ? name : 'light';
  scene.background = new THREE.Color(backgrounds[background]);
  $('#viewport').dataset.theme = background === 'dark' ? 'dark' : 'light';
  $('#viewport').classList.toggle('dark-background', background === 'dark');
  document.querySelectorAll('[data-background]').forEach(button => {
    const active = button.dataset.background === background;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  floor.material.opacity = background === 'dark' ? .24 : .1;
  scheduleSave();
}

function setMaterial() {
  const finish = $('#material').value;
  material.color.set($('#object-color').value);
  const finishes = {
    ceramic: { metalness: .02, roughness: .32, clearcoat: .3, clearcoatRoughness: .24 },
    chrome: { metalness: 1, roughness: .19, clearcoat: .45, clearcoatRoughness: .1 },
    ink: { metalness: 0, roughness: .74, clearcoat: 0, clearcoatRoughness: .5 },
  };
  Object.assign(material, finishes[finish] || finishes.ceramic);
  material.needsUpdate = true;
  scheduleSave();
}

// Frame the mesh from its current orbit direction, accounting for the viewport's aspect ratio.
function fit(targetCamera = camera, targetControls = controls, margin = 1.24) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const oldTarget = targetControls?.target || controls.target;
  const direction = targetCamera.position.clone().sub(oldTarget).normalize();
  if (direction.lengthSq() < .01) direction.set(1, .7, 1).normalize();
  targetCamera.position.copy(center).add(direction);
  targetCamera.lookAt(center);
  targetCamera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(targetCamera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(targetCamera.matrixWorld, 1);
  const tanV = Math.tan(THREE.MathUtils.degToRad(targetCamera.fov / 2));
  const tanH = tanV * targetCamera.aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(center);
    const depth = relative.dot(direction);
    distance = Math.max(distance, depth + margin * Math.abs(relative.dot(right)) / tanH, depth + margin * Math.abs(relative.dot(up)) / tanV);
  }
  targetCamera.position.copy(center).addScaledVector(direction, Math.max(distance, 2));
  targetCamera.near = .05;
  targetCamera.far = 150;
  targetCamera.lookAt(center);
  targetCamera.updateProjectionMatrix();
  if (targetControls) { targetControls.target.copy(center); targetControls.update(); }
}

function setView(name, refit = true) {
  const directions = {
    perspective: [6, 4.3, 7.5], logo: [-4.4, 11, -2.7], front: [0, .05, 10], side: [10, .05, 0], top: [0, 10, .001],
  };
  const values = directions[name] || directions.perspective;
  camera.position.copy(controls.target).add(new THREE.Vector3(...values));
  if (refit) fit();
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#view-name').textContent = name === 'logo' ? 'One Mount logo angle' : name === 'perspective' ? 'Perspective' : name.charAt(0).toUpperCase() + name.slice(1);
  scheduleSave();
}

function selectPreset(name, initial = false) {
  if (!Object.hasOwn(presets, name)) return;
  if (!initial && name === activePreset) return;
  if (!initial) tabGrowth[activePreset] = params.growth;
  activePreset = name;
  params.growth = tabGrowth[name];
  syncInputs();
  rebuild();
  if (initial) setView(name === 'loop' ? 'logo' : 'perspective');
  document.querySelectorAll('[data-preset]').forEach(button => {
    const active = button.dataset.preset === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  scheduleSave();
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportPNG() {
  if (exportBusy) return;
  exportBusy = true;
  const button = $('#export-png');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Rendering…';
  $('#export-status').textContent = 'Preparing your image…';
  let outputRenderer, outputPmrem, outputEnvironment;
  const savedBackground = scene.background;
  const savedEnvironment = scene.environment;
  const savedFloorVisible = floor.visible;
  try {
    // Allow the progress state to paint before the high-resolution synchronous render.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (pendingGeometry) rebuild();
    const longEdge = Math.min(4096, Math.max(1200, +$('#export-size').value || 2400));
    const ratio = $('#export-ratio').value;
    const aspect = { square: 1, landscape: 4 / 3, portrait: 3 / 4 }[ratio] || camera.aspect;
    const width = Math.round(aspect >= 1 ? longEdge : longEdge * aspect);
    const height = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
    const transparent = $('#transparent').checked;
    outputRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    outputRenderer.setPixelRatio(1);
    outputRenderer.setSize(width, height, false);
    outputRenderer.outputColorSpace = THREE.SRGBColorSpace;
    outputRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    outputRenderer.toneMappingExposure = renderer.toneMappingExposure;
    outputRenderer.shadowMap.enabled = true;
    outputRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Render-target textures belong to a WebGL context. Build this renderer's
    // own studio environment so exported metals match the live viewport.
    outputPmrem = new THREE.PMREMGenerator(outputRenderer);
    const outputRoom = new RoomEnvironment();
    outputEnvironment = outputPmrem.fromScene(outputRoom, .04);
    outputRoom.dispose();
    scene.environment = outputEnvironment.texture;
    const outputCamera = camera.clone();
    outputCamera.aspect = width / height;
    // Maintain the current view for viewport exports; reframe the same orbit for a new ratio.
    if (ratio !== 'viewport') fit(outputCamera, null);
    outputCamera.updateProjectionMatrix();
    if (transparent) { scene.background = null; floor.visible = false; outputRenderer.setClearColor(0x000000, 0); }
    outputRenderer.render(scene, outputCamera);
    const blob = await new Promise(resolve => outputRenderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not create this image. Try a smaller resolution.');
    const label = params.growth < .001 ? 'mobius' : 'helix';
    download(blob, `one-mount-${label}-${width}x${height}${transparent ? '-transparent' : ''}.png`);
    $('#export-status').textContent = `Saved ${width} × ${height} PNG${transparent ? ' · Transparent' : ''}`;
    toast('Image exported');
  } catch (error) {
    $('#export-status').textContent = error.message || 'Export failed. Try a smaller resolution.';
    console.error(error);
  } finally {
    scene.background = savedBackground;
    scene.environment = savedEnvironment;
    floor.visible = savedFloorVisible;
    outputEnvironment?.dispose();
    outputPmrem?.dispose();
    outputRenderer?.dispose();
    outputRenderer?.forceContextLoss();
    exportBusy = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function wireControls() {
  document.querySelectorAll('[data-param]').forEach(input => input.addEventListener('input', () => {
    const value = Number(input.value);
    params[input.dataset.param] = THREE.MathUtils.clamp(value, +input.min, +input.max);
    params.thickness = Math.min(params.thickness, params.width * .45);
    syncInputs();
    pendingGeometry = true;
    tabGrowth[activePreset] = params.growth;
    scheduleSave();
  }));
  document.querySelectorAll('[data-rotation]').forEach(input => input.addEventListener('input', () => {
    rotation[input.dataset.rotation] = THREE.MathUtils.clamp(+input.value, -180, 180);
    applyRotation();
  }));
  $('#reset-rotation').addEventListener('click', () => {
    Object.assign(rotation, { x: 0, y: 0, z: 0 });
    applyRotation();
  });
  $('#toggle-object-drag').addEventListener('click', () => setObjectDragMode(!objectDragMode));
  let drag;
  const wrapDegrees = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!objectDragMode || event.button !== 0 || drag || exportBusy) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rotation: { ...rotation } };
    event.preventDefault();
    event.stopImmediatePropagation();
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  }, true);
  renderer.domElement.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    rotation.x = wrapDegrees(drag.rotation.x + (event.clientY - drag.y) * .45);
    rotation.y = wrapDegrees(drag.rotation.y + (event.clientX - drag.x) * .45);
    applyRotation();
  }, true);
  const finishDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    drag = undefined;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    renderer.domElement.style.cursor = objectDragMode ? 'grab' : '';
    scheduleSave();
  };
  renderer.domElement.addEventListener('pointerup', finishDrag, true);
  renderer.domElement.addEventListener('pointercancel', finishDrag, true);
  renderer.domElement.addEventListener('lostpointercapture', finishDrag, true);
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => selectPreset(button.dataset.preset)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-background]').forEach(button => button.addEventListener('click', () => setBackground(button.dataset.background)));
  $('#material').addEventListener('change', setMaterial);
  $('#object-color').addEventListener('input', setMaterial);
  $('#fit-view').addEventListener('click', () => { if (pendingGeometry) rebuild(); fit(); });
  $('#toggle-rotate').addEventListener('click', () => {
    if (objectDragMode) setObjectDragMode(false);
    controls.autoRotate = !controls.autoRotate;
    $('#toggle-rotate').setAttribute('aria-pressed', String(controls.autoRotate));
    $('#toggle-rotate').classList.toggle('active', controls.autoRotate);
    scheduleSave();
  });
  for (const selector of ['#export-size', '#export-ratio', '#transparent']) $(selector).addEventListener('change', scheduleSave);
  $('#export-png').addEventListener('click', exportPNG);
  $('#reset-all').addEventListener('click', () => {
    Object.assign(params, defaults);
    Object.assign(tabGrowth, { loop: 0, growth: defaults.growth, helix: 1 });
    Object.assign(rotation, { x: 0, y: 0, z: 0 });
    applyRotation();
    setObjectDragMode(false);
    $('#material').value = 'ceramic';
    $('#object-color').value = '#ed513a';
    setMaterial();
    setBackground('light');
    controls.autoRotate = false;
    $('#toggle-rotate').setAttribute('aria-pressed', 'false');
    $('#toggle-rotate').classList.remove('active');
    $('#export-size').value = '2400';
    $('#export-ratio').value = 'viewport';
    $('#transparent').checked = false;
    selectPreset('growth', true);
    toast('Studio reset');
  });
  $('#copy-settings')?.addEventListener('click', async () => {
    const settings = { ...params, rotation: { ...rotation }, color: $('#object-color').value, material: $('#material').value, background };
    try { await navigator.clipboard.writeText(JSON.stringify(settings, null, 2)); toast('Parameters copied'); }
    catch { download(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), 'one-mount-helix-settings.json'); toast('Parameters saved'); }
  });
  $('#controls')?.addEventListener('submit', event => event.preventDefault());
  controls.addEventListener('change', scheduleSave);
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  window.addEventListener('keydown', event => {
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.key.toLowerCase() === 'f') fit();
    if (event.key.toLowerCase() === 'l') setView('logo');
  });
}

function init() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ canvas: $('#scene-canvas'), antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  camera = new THREE.PerspectiveCamera(34, 1, .05, 150);
  camera.position.set(7, 5, 9);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minDistance = 2;
  controls.maxDistance = 40;
  controls.autoRotateSpeed = .8;
  controls.addEventListener('start', () => {
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
    $('#view-name').textContent = 'Custom orbit';
  });
  pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .72;
  room.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 10; key.shadow.camera.bottom = -8;
  key.shadow.normalBias = .035;
  key.shadow.bias = -.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdde8ff, 1.4);
  fill.position.set(5, 1, -4);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, .2));
  floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .1, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  material = new THREE.MeshPhysicalMaterial({ color: '#ed513a', side: THREE.DoubleSide });
  setMaterial();
  setBackground('light');
  rebuild();
  wireControls();
  syncInputs();
  const resize = () => {
    const rect = $('#viewport').getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  };
  resize();
  new ResizeObserver(resize).observe($('#viewport'));
  const saved = readSavedState();
  if (saved) restoreState(saved);
  else {
    const initial = new URLSearchParams(location.search);
    const name = Object.hasOwn(presets, initial.get('preset')) ? initial.get('preset') : 'growth';
    Object.assign(params, presets[name]);
    tabGrowth[name] = params.growth;
    selectPreset(name, true);
    if (initial.get('view') === 'logo') setView('logo');
    syncRotationInputs();
  }
  persistEnabled = true;
  saveState();
  $('#loading').hidden = true;
  renderer.setAnimationLoop(() => {
    if (exportBusy) return;
    if (pendingGeometry) rebuild();
    controls.update();
    renderer.render(scene, camera);
  });
  // Inspection hooks for local QA; geometry stays available to designers experimenting with the source.
  window.helixStudio = { get params() { return { ...params }; }, get rotation() { return { ...rotation }; }, get activeTab() { return activePreset; }, get mesh() { return mesh; }, get camera() { return camera; }, get controls() { return controls; }, get renderer() { return renderer; }, selectPreset, fit, exportPNG, saveState };
}

try { init(); }
catch (error) {
  console.error(error);
  $('#loading').hidden = false;
  $('#loading').textContent = 'The 3D renderer could not start. Please open this studio in a browser with WebGL enabled.';
}
