import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createEvolutionGeometry, updateEvolutionGeometry } from 'ribbon/evolution';

const $ = selector => document.querySelector(selector);
const DEFAULTS = { turns: 5, length: 9.5, width: .58, endRadius: .05, taper: 2.2, neck: .25, pitch: 1, tipWidth: .3, segments: 360 };
const FORM_PRESETS = {
  cone: { turns: 3, length: 7, width: .6, endRadius: .02, taper: 1, neck: 0, pitch: 1, tipWidth: .3 },
  horn: { turns: 6.5, length: 11, width: .64, endRadius: .08, taper: 3.4, neck: .4, pitch: 1, tipWidth: .55 },
  tornado: { ...DEFAULTS },
};
const options = { ...DEFAULTS };
const stages = [
  { at: 0, title: 'The loop, in space.', copy: 'Begin with the original Möbius ribbon: a broad surface, a half turn, and a continuous loop.' },
  { at: .28, title: 'Release the seam.', copy: 'Open one junction of the loop. The same three-dimensional ribbon now has room to extend.' },
  { at: .64, title: 'Carry the turn forward.', copy: 'Extend the open ribbon along an axis. Each revolution travels around the outside of the growing funnel.' },
  { at: 1, title: 'Shape the flow.', copy: 'A flared mouth narrows into a winding tail. Change the end radius, funnel curve, and tail length to find the final mark.' },
];
const viewDirections = {
  original: new THREE.Vector3(-4.4, 11, -2.7).normalize(),
  sketch: new THREE.Vector3(-12, .4, 6.93).normalize(),
  perspective: new THREE.Vector3(-8, 6, 9).normalize(),
  upright: new THREE.Vector3(-6, 3, 11).normalize(),
};
let progress = 0, playing = false, followCamera = true, dirtyGeometry = false, exportBusy = false;
let lastFrame = 0, activeStage = -1, seekMotion, toastTimer;
let renderer, camera, scene, controls, mesh, surfaceMaterial, depthMaterial, floor, environment, pmrem;
let boundaryMeshes = [], boundaryGroup;
const clamp = (value, a = 0, b = 1) => Math.max(a, Math.min(b, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function syncOptions() {
  document.querySelectorAll('[data-option]').forEach(input => {
    const name = input.dataset.option;
    input.value = options[name];
    input.style.setProperty('--range-progress', `${(options[name] - +input.min) / (+input.max - +input.min) * 100}%`);
    const output = document.querySelector(`[data-option-value="${name}"]`);
    if (output) output.textContent = ['width', 'neck', 'tipWidth'].includes(name) ? `${Math.round(options[name] * 100)}%` : Number(options[name].toFixed(2)).toString();
  });
  document.querySelectorAll('[data-form-preset]').forEach(button => {
    const preset = FORM_PRESETS[button.dataset.formPreset];
    const active = preset && Object.keys(preset).filter(name => name !== 'segments').every(name => Math.abs(options[name] - preset[name]) < .0001);
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

function syncProgress() {
  const percentage = Math.round(progress * 100);
  $('#progress').value = Math.round(progress * 1000);
  $('#progress').style.setProperty('--progress', `${percentage}%`);
  $('#percentage').textContent = `${percentage}%`;
  $('#play').textContent = playing ? 'Pause evolution' : progress >= .999 ? 'Replay evolution' : 'Play evolution';
  $('#play').setAttribute('aria-pressed', String(playing));
  const index = progress < .14 ? 0 : progress < .46 ? 1 : progress < .84 ? 2 : 3;
  if (index !== activeStage) {
    activeStage = index;
    $('#phase-title').textContent = stages[index].title;
    $('#phase-copy').textContent = stages[index].copy;
    document.querySelectorAll('[data-stage]').forEach(button => {
      const active = +button.dataset.stage === index;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  $('#progress').setAttribute('aria-valuetext', `${stages[index].title} ${percentage} percent`);
}

function setFollowCamera(value) {
  followCamera = Boolean(value);
  $('#follow-camera').classList.toggle('active', followCamera);
  $('#follow-camera').setAttribute('aria-pressed', String(followCamera));
  if (followCamera) { controls.autoRotate = false; syncOrbit(); updateGuidedCamera(); }
}

function syncOrbit() {
  $('#auto-orbit').classList.toggle('active', controls.autoRotate);
  $('#auto-orbit').setAttribute('aria-pressed', String(controls.autoRotate));
}

function frameCamera(direction, targetCamera = camera, targetControls = controls, margin = 1.14) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const ray = direction.clone().normalize();
  targetCamera.position.copy(center).add(ray);
  targetCamera.lookAt(center); targetCamera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(targetCamera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(targetCamera.matrixWorld, 1);
  const viewportHeight = $('#viewport').clientHeight;
  const safeTop = innerWidth <= 540 ? 115 : 36;
  const footer = document.querySelector('.viewport-footer');
  const safeBottom = footer ? viewportHeight - footer.offsetTop + 20 : 36;
  const usableFraction = Math.max(.3, (viewportHeight - safeTop - safeBottom) / viewportHeight);
  const tanV = Math.tan(THREE.MathUtils.degToRad(targetCamera.fov * .5)), tanH = tanV * targetCamera.aspect;
  let distance = 2;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(center), depth = relative.dot(ray);
    distance = Math.max(distance, depth + margin * Math.abs(relative.dot(right)) / tanH, depth + margin * Math.abs(relative.dot(up)) / (tanV * usableFraction));
  }
  const aim = center.clone().addScaledVector(up, (safeTop - safeBottom) / viewportHeight * distance * tanV);
  targetCamera.position.copy(aim).addScaledVector(ray, distance);
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  targetCamera.near = Math.max(.05, distance - radius * 2.2);
  targetCamera.far = Math.max(50, distance + radius * 4);
  targetCamera.lookAt(aim); targetCamera.updateProjectionMatrix();
  if (targetControls) { targetControls.target.copy(aim); targetControls.update(); }
}

function updateGuidedCamera() {
  if (!camera || !mesh || !followCamera) return;
  const blend = smooth(clamp((progress - .06) / .88));
  orientShape(-Math.PI / 2 * blend);
  camera.fov = THREE.MathUtils.lerp(34, 28, blend);
  const direction = viewDirections.original.clone().lerp(viewDirections.upright, blend).normalize();
  frameCamera(direction);
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = progress < .001 ? button.dataset.view === 'original' : progress > .999 ? button.dataset.view === 'upright' : false;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

function setView(name) {
  if (dirtyGeometry) updateShape();
  setFollowCamera(false);
  controls.autoRotate = false; syncOrbit();
  orientShape(name === 'upright' ? -Math.PI / 2 : 0);
  camera.fov = name === 'sketch' ? 18 : 34;
  frameCamera(viewDirections[name] || viewDirections.perspective);
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

function orientShape(angle) {
  mesh.rotation.z = angle;
  if (boundaryGroup) boundaryGroup.rotation.z = angle;
  mesh.updateMatrixWorld(true);
  if (floor) floor.position.y = new THREE.Box3().setFromObject(mesh).min.y - .12;
}

// A small tube makes a ribbon boundary a real 3D curve, with depth-tested
// occlusion, rather than a flat outline painted over the camera image.
function updateTube(mesh, points, radius = .012) {
  const count = points.length / 3, sides = 6;
  if (!mesh.geometry.getAttribute('position') || mesh.geometry.getAttribute('position').count !== count * sides) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * sides * 3), 3));
    const indices = [];
    for (let i = 0; i < count - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      indices.push(a, b, c, b, d, c);
    }
    geometry.setIndex(indices); mesh.geometry.dispose(); mesh.geometry = geometry;
  }
  const positions = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3(), tangent = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    point.fromArray(points, i * 3);
    const before = Math.max(0, i - 1) * 3, after = Math.min(count - 1, i + 1) * 3;
    tangent.set(points[after] - points[before], points[after + 1] - points[before + 1], points[after + 2] - points[before + 2]).normalize();
    n.set(0, 1, 0); if (Math.abs(tangent.dot(n)) > .9) n.set(0, 0, 1);
    n.addScaledVector(tangent, -n.dot(tangent)).normalize(); b.crossVectors(tangent, n).normalize();
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2, cos = Math.cos(angle) * radius, sin = Math.sin(angle) * radius;
      positions.setXYZ(i * sides + j, point.x + n.x * cos + b.x * sin, point.y + n.y * cos + b.y * sin, point.z + n.z * cos + b.z * sin);
    }
  }
  positions.needsUpdate = true; mesh.geometry.computeBoundingSphere();
}

function boundaryArrays() {
  const data = mesh.geometry.userData.boundaries;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return [data.edgeA, data.edgeB, data.start, data.end].filter(value => value && value.length >= 6);
}

function updateBoundaries() {
  const arrays = boundaryArrays();
  arrays.forEach((points, index) => {
    if (!boundaryMeshes[index]) {
      const line = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#009fea', depthTest: true }));
      line.renderOrder = 2; boundaryMeshes[index] = line; boundaryGroup.add(line);
    }
    updateTube(boundaryMeshes[index], points);
    boundaryMeshes[index].visible = true;
  });
  boundaryMeshes.forEach((line, index) => { if (index >= arrays.length) line.visible = false; });
}

function updateShape() {
  updateEvolutionGeometry(mesh.geometry, progress, options);
  mesh.updateMatrixWorld(true);
  floor.position.y = new THREE.Box3().setFromObject(mesh).min.y - .12;
  if ($('#display-mode').value !== 'solid') updateBoundaries();
  updateGuidedCamera();
  dirtyGeometry = false;
}

function setDisplayMode() {
  const mode = $('#display-mode').value;
  mesh.material = mode === 'edges' ? depthMaterial : surfaceMaterial;
  mesh.castShadow = mode !== 'edges';
  floor.visible = mode !== 'edges';
  boundaryGroup.visible = mode !== 'solid';
  if (boundaryGroup.visible) updateBoundaries();
}

function setMaterial() {
  const type = $('#material').value;
  const finishes = { satin: { metalness: .04, roughness: .32, clearcoat: .35 }, chrome: { metalness: .93, roughness: .2, clearcoat: .45 }, ink: { metalness: 0, roughness: .7, clearcoat: 0 } };
  Object.assign(surfaceMaterial, finishes[type] || finishes.satin);
  surfaceMaterial.color.set($('#ribbon-color').value);
  surfaceMaterial.needsUpdate = true;
}

function setProgress(value) {
  progress = clamp(value); dirtyGeometry = true; syncProgress();
}

function stop() { playing = false; seekMotion = undefined; syncProgress(); }
function play() {
  if (playing) { stop(); return; }
  seekMotion = undefined;
  if (progress >= .999) setProgress(0);
  playing = true; syncProgress();
}
function seek(value, animated = true) {
  stop();
  if (!animated || reducedMotion) { setProgress(value); return; }
  seekMotion = { from: progress, to: clamp(value), time: performance.now() };
}

async function exportPNG() {
  if (exportBusy) return;
  stop(); if (dirtyGeometry) updateShape();
  exportBusy = true;
  const button = $('#save-png'), label = button.textContent;
  button.disabled = true; button.textContent = 'Rendering…'; $('#export-status').textContent = 'Preparing 3D image…';
  const saved = { background: scene.background, environment: scene.environment, floor: floor.visible };
  let output, outputPmrem, outputEnvironment;
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const longEdge = +$('#export-size').value || 2400, aspect = camera.aspect;
    const width = Math.round(aspect >= 1 ? longEdge : longEdge * aspect), height = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
    output = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    output.setPixelRatio(1); output.setSize(width, height, false);
    output.outputColorSpace = THREE.SRGBColorSpace; output.toneMapping = THREE.ACESFilmicToneMapping; output.toneMappingExposure = renderer.toneMappingExposure;
    output.shadowMap.enabled = true; output.shadowMap.type = THREE.PCFSoftShadowMap;
    outputPmrem = new THREE.PMREMGenerator(output);
    const room = new RoomEnvironment(); outputEnvironment = outputPmrem.fromScene(room, .04); room.dispose(); scene.environment = outputEnvironment.texture;
    const transparent = $('#transparent').checked;
    if (transparent) { scene.background = null; floor.visible = false; output.setClearColor(0x000000, 0); }
    const outputCamera = camera.clone(); outputCamera.aspect = width / height; outputCamera.updateProjectionMatrix();
    output.render(scene, outputCamera);
    const blob = await new Promise(resolve => output.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create the image. Try a smaller resolution.');
    download(blob, `one-mount-3d-evolution-${Math.round(progress * 100)}-${width}x${height}.png`);
    $('#export-status').textContent = `Saved ${width} × ${height} PNG${transparent ? ' · Transparent' : ''}`; toast('3D frame saved');
  } catch (error) { $('#export-status').textContent = error.message; console.error(error); }
  finally {
    scene.background = saved.background; scene.environment = saved.environment; floor.visible = saved.floor;
    outputEnvironment?.dispose(); outputPmrem?.dispose(); output?.dispose(); output?.forceContextLoss();
    exportBusy = false; button.disabled = false; button.textContent = label;
  }
}

function saveHTML() {
  stop();
  const clone = document.documentElement.cloneNode(true);
  clone.querySelector('body').dataset.initialProgress = progress;
  clone.querySelector('body').dataset.helixOptions = JSON.stringify(options);
  clone.querySelector('body').dataset.displayMode = $('#display-mode').value;
  clone.querySelector('body').dataset.ribbonColor = $('#ribbon-color').value;
  clone.querySelector('body').dataset.material = $('#material').value;
  clone.querySelector('body').dataset.cameraView = JSON.stringify({
    position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov,
    rotation: mesh.rotation.z, follow: followCamera, orbit: controls.autoRotate,
    name: document.querySelector('[data-view].active')?.dataset.view,
  });
  clone.querySelector('#reference-dialog').removeAttribute('open'); clone.querySelector('#toast').classList.remove('visible');
  download(new Blob(['<!doctype html>\n' + clone.outerHTML], { type: 'text/html;charset=utf-8' }), 'one-mount-spatial-evolution.html');
  toast('Standalone 3D HTML saved');
}

function init() {
  scene = new THREE.Scene(); scene.background = new THREE.Color('#e9edf0');
  renderer = new THREE.WebGLRenderer({ canvas: $('#evolution-canvas'), antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.14;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  camera = new THREE.PerspectiveCamera(34, 1, .05, 180); camera.position.copy(viewDirections.original).multiplyScalar(12);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.minDistance = 2; controls.maxDistance = 150; controls.autoRotateSpeed = .7;
  controls.addEventListener('start', () => { stop(); setFollowCamera(false); document.querySelectorAll('[data-view]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); }); });
  pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment(); environment = pmrem.fromScene(room, .04); room.dispose(); scene.environment = environment.texture; scene.environmentIntensity = .8;
  const key = new THREE.DirectionalLight('#ffffff', 3.3); key.position.set(-5, 9, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10; key.shadow.normalBias = .025; key.shadow.bias = -.00015; key.shadow.radius = 4; scene.add(key);
  const fill = new THREE.DirectionalLight('#e0ecff', 1.5); fill.position.set(6, 2, -6); scene.add(fill); scene.add(new THREE.AmbientLight('#ffffff', .15));
  surfaceMaterial = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: '#eb6047', metalness: .04, roughness: .32, clearcoat: .35, clearcoatRoughness: .2 });
  depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  try {
    const stored = JSON.parse(document.body.dataset.helixOptions || '{}');
    document.querySelectorAll('[data-option]').forEach(input => { const value = stored[input.dataset.option]; if (Number.isFinite(value)) options[input.dataset.option] = clamp(value, +input.min, +input.max); });
  } catch { /* Use the sculptural defaults. */ }
  const query = new URLSearchParams(location.search);
  progress = query.get('stage') === 'helix' ? 1 : clamp(Number(document.body.dataset.initialProgress) || 0);
  mesh = new THREE.Mesh(createEvolutionGeometry(progress, options), surfaceMaterial); mesh.castShadow = true; mesh.receiveShadow = false; scene.add(mesh);
  floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .13, depthWrite: false })); floor.rotation.x = -Math.PI * .5; floor.receiveShadow = true; scene.add(floor);
  boundaryGroup = new THREE.Group(); scene.add(boundaryGroup); boundaryGroup.visible = false;
  const resize = () => { const rect = $('#viewport').getBoundingClientRect(); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false); if (followCamera) updateGuidedCamera(); };
  resize(); new ResizeObserver(resize).observe($('#viewport'));
  document.querySelectorAll('[data-option]').forEach(input => input.addEventListener('input', () => { options[input.dataset.option] = clamp(+input.value, +input.min, +input.max); syncOptions(); dirtyGeometry = true; }));
  document.querySelectorAll('[data-form-preset]').forEach(button => button.addEventListener('click', () => {
    Object.assign(options, FORM_PRESETS[button.dataset.formPreset] || DEFAULTS);
    syncOptions(); dirtyGeometry = true;
    toast(`${button.textContent.trim()} form applied`);
  }));
  document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => seek(stages[+button.dataset.stage].at)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#progress').addEventListener('input', event => { const value = +event.target.value / 1000; stop(); setProgress(value); });
  $('#play').addEventListener('click', play);
  $('#fit-view').addEventListener('click', () => { if (dirtyGeometry) updateShape(); frameCamera(camera.position.clone().sub(controls.target)); });
  $('#follow-camera').addEventListener('click', () => setFollowCamera(!followCamera));
  $('#auto-orbit').addEventListener('click', () => { setFollowCamera(false); controls.autoRotate = !controls.autoRotate; syncOrbit(); });
  $('#display-mode').addEventListener('change', setDisplayMode);
  $('#material').addEventListener('change', setMaterial); $('#ribbon-color').addEventListener('input', setMaterial);
  $('#reset-form').addEventListener('click', () => { Object.assign(options, DEFAULTS); syncOptions(); dirtyGeometry = true; toast('Helix form reset'); });
  $('#save-png').addEventListener('click', exportPNG); $('#save-html').addEventListener('click', saveHTML);
  $('#reference').addEventListener('click', () => { stop(); $('#reference-dialog').showModal(); });
  $('#close-reference').addEventListener('click', () => $('#reference-dialog').close());
  $('#reference-dialog').addEventListener('click', event => { if (event.target === $('#reference-dialog')) $('#reference-dialog').close(); });
  $('#present').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Use your browser’s full-screen command'); } });
  document.addEventListener('fullscreenchange', () => $('#present').textContent = document.fullscreenElement ? 'Exit present' : 'Present');
  document.addEventListener('keydown', event => { if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || $('#reference-dialog').open) return; if (event.code === 'Space') { event.preventDefault(); play(); } else if (event.key === 'ArrowRight') { event.preventDefault(); seek(progress + .02, false); } else if (event.key === 'ArrowLeft') { event.preventDefault(); seek(progress - .02, false); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  if (['solid', 'edges', 'solid-edges'].includes(document.body.dataset.displayMode)) $('#display-mode').value = document.body.dataset.displayMode;
  if (/^#[0-9a-f]{6}$/i.test(document.body.dataset.ribbonColor)) $('#ribbon-color').value = document.body.dataset.ribbonColor;
  if (['satin', 'chrome', 'ink'].includes(document.body.dataset.material)) $('#material').value = document.body.dataset.material;
  setMaterial(); syncOptions(); syncProgress(); updateShape(); setDisplayMode(); setFollowCamera(true);
  try {
    const view = JSON.parse(document.body.dataset.cameraView || '{}');
    const validVector = vector => Array.isArray(vector) && vector.length === 3 && vector.every(value => Number.isFinite(value) && Math.abs(value) < 1000);
    if (view.follow === false && validVector(view.position) && validVector(view.target)) {
      setFollowCamera(false); orientShape(Number.isFinite(view.rotation) ? view.rotation : 0);
      camera.position.fromArray(view.position); controls.target.fromArray(view.target);
      camera.fov = clamp(Number(view.fov) || 34, 8, 80); camera.updateProjectionMatrix(); controls.update();
      controls.autoRotate = view.orbit === true; syncOrbit();
      document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === view.name; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    }
  } catch { /* A saved view is optional. */ }
  $('#loading').hidden = true;
  renderer.setAnimationLoop(now => {
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0; lastFrame = now;
    if (exportBusy) return;
    if (seekMotion) {
      const t = clamp((now - seekMotion.time) / 1600); setProgress(THREE.MathUtils.lerp(seekMotion.from, seekMotion.to, smooth(t)));
      if (t >= 1) seekMotion = undefined;
    } else if (playing) { setProgress(progress + dt / 15); if (progress >= 1) { playing = false; syncProgress(); } }
    if (dirtyGeometry) updateShape();
    controls.update(dt);
    const distance = camera.position.distanceTo(controls.target), radius = mesh.geometry.boundingSphere.radius;
    const near = Math.max(.05, distance - radius * 2.2), far = Math.max(50, distance + radius * 4);
    if (Math.abs(camera.near - near) > .01 || Math.abs(camera.far - far) > .01) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  });
  window.evolution3D = { get progress() { return progress; }, get playing() { return playing; }, get options() { return { ...options }; }, get mesh() { return mesh; }, get camera() { return camera; }, get controls() { return controls; }, get renderer() { return renderer; }, get boundaries() { return boundaryMeshes; }, seek: value => seek(value, false), stop, play, setView, setFollowCamera, exportPNG, setOptions: value => { for (const name of Object.keys(DEFAULTS)) if (name in value && name !== 'segments') options[name] = value[name]; syncOptions(); dirtyGeometry = true; updateShape(); } };
}

try { init(); } catch (error) { console.error(error); $('#loading').hidden = false; $('#loading').textContent = 'The 3D renderer could not start. Open this HTML in a browser with WebGL 2 enabled.'; }
