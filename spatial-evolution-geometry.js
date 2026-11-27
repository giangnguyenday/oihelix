import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const EVOLUTION_DEFAULTS = Object.freeze({
  turns: 5, length: 9.5, width: .58, endRadius: .05,
  taper: 2.2, neck: .25, pitch: 1, tipWidth: .3,
  radius: 1.7, thickness: .065, segments: 360,
  cornerSegments: 5, widthSegments: 8,
});

function parameters(progress, options = {}) {
  const value = key => finite(options[key], EVOLUTION_DEFAULTS[key]);
  const p = clamp(finite(progress, 0), 0, 1);
  return {
    progress: p,
    turns: clamp(value('turns'), 1, 9), length: clamp(value('length'), 3, 16),
    width: clamp(value('width'), .1, .95), endRadius: clamp(value('endRadius'), 0, .8),
    taper: clamp(value('taper'), .5, 5), neck: clamp(value('neck'), 0, .7),
    pitch: clamp(value('pitch'), .4, 2.8), tipWidth: clamp(value('tipWidth'), 0, 1),
    radius: clamp(value('radius'), 1, 3), thickness: clamp(value('thickness'), .008, .14),
    segments: Math.round(clamp(value('segments'), 64, 1000)),
    cornerSegments: Math.round(clamp(value('cornerSegments'), 2, 8)),
    widthSegments: Math.round(clamp(value('widthSegments'), 4, 20)),
    angular: smooth(.015, .88, p), axial: smooth(0, .94, p),
    blend: smooth(.08, 1, p), orientation: smooth(.045, .90, p),
  };
}

function radiusAt(p, q) {
  const end = 1 - p.neck;
  if (q >= end) return { radius: p.endRadius, derivative: 0 };
  const remaining = Math.max(1e-8, 1 - q / end);
  return {
    radius: p.endRadius + (p.radius - p.endRadius) * Math.pow(remaining, p.taper),
    derivative: -(p.radius - p.endRadius) * p.taper / end * Math.pow(remaining, p.taper - 1),
  };
}

/** Radius of the construction funnel at normalized axial position q. */
export function sampleFunnelRadius(q, options = {}) {
  return radiusAt(parameters(1, options), clamp(finite(q, 0), 0, 1)).radius;
}

function layoutAt(p, u) {
  const coverage = p.width * mix(1, p.tipWidth, smooth(.5, 1, u));
  // This gives a fractional coverage of each turn, leaving a genuine gap.
  const span = coverage / (p.turns + coverage);
  const begin = (1 - span) * u;
  const turns = mix(1, p.turns, p.angular);
  const angle = TAU * turns * u - Math.PI / 2 * p.blend;
  const beta = Math.PI / 2 * (1 - p.orientation);
  return { u, span, begin, angle, c: Math.cos(angle), s: Math.sin(angle), ca: Math.cos(beta), sa: Math.sin(beta), turns };
}

// Every point across the band lies ON the funnel, rather than on a chord
// between its two edges. A regular axial neck continues to carry the spiral.
function funnelPoint(p, layout, v, out) {
  const t = clamp(layout.begin + layout.span * v, 0, 1);
  const q = Math.pow(t, p.pitch); // >1 clusters turns near the mouth; <1 near the tail.
  const radial = radiusAt(p, q);
  const x = p.length * p.axial * (q - .5), y = -radial.radius * layout.c;
  out.x = layout.ca * x - layout.sa * y;
  out.y = layout.sa * x + layout.ca * y;
  out.z = radial.radius * layout.s;
  // Inward shell normal matches the original ribbon's positive-thickness side.
  let nx = radial.derivative / Math.max(.05, p.length * p.axial), ny = layout.c, nz = -layout.s;
  const n = Math.hypot(nx, ny, nz); nx /= n; ny /= n; nz /= n;
  out.nx = layout.ca * nx - layout.sa * ny;
  out.ny = layout.sa * nx + layout.ca * ny;
  out.nz = nz;
  out.thickness = Math.min(p.thickness, radial.radius * .45);
  out.q = q;
  return out;
}

// The source equations exactly reproduce the original 3D One Mount Möbius.
// Increasing angle/axial distance releases its seam before the band settles
// onto the curved funnel surface. No image layer or alpha transition is used.
function sourceFrame(p, u, layout, out) {
  const angle = layout.angle, c = layout.c, s = layout.s, da = TAU * layout.turns;
  const asym = .25;
  const sourceR = 1.65 * (1 + asym * (.24 * Math.cos(angle - .55) + .12 * Math.cos(2 * angle + .3)));
  const sourceDR = 1.65 * asym * (-.24 * Math.sin(angle - .55) - .24 * Math.sin(2 * angle + .3)) * da;
  const sx = 1 + asym * .14, sz = 1 - asym * .26;
  let x = sourceR * c * sx;
  let y = p.length * p.axial * (u - .5) + (1 - p.axial) * 1.65 * .08 * Math.sin(angle + .3);
  const z = sourceR * s * sz;
  let tx = sx * (sourceDR * c - sourceR * s * da);
  let ty = p.length * p.axial + (1 - p.axial) * 1.65 * .08 * Math.cos(angle + .3) * da;
  let tz = sz * (sourceDR * s + sourceR * c * da);
  let n = Math.hypot(tx, ty, tz); tx /= n; ty /= n; tz /= n;
  const dot = c * tx + s * tz;
  let rx = c - dot * tx, ry = -dot * ty, rz = s - dot * tz;
  n = Math.hypot(rx, ry, rz); rx /= n; ry /= n; rz /= n;
  const ux = ty * rz - tz * ry, uy = tz * rx - tx * rz, uz = tx * ry - ty * rx;
  const twist = Math.PI * u + .28, cr = Math.cos(twist), sr = Math.sin(twist);
  let wx = rx * cr + ux * sr, wy = ry * cr + uy * sr, wz = rz * cr + uz * sr;
  let nx = ty * wz - tz * wy, ny = tz * wx - tx * wz, nz = tx * wy - ty * wx;
  const a = -Math.PI / 2 * p.orientation, ca = Math.cos(a), sa = Math.sin(a);
  const rotate = (vx, vy) => [ca * vx - sa * vy, sa * vx + ca * vy];
  [x, y] = rotate(x, y); [tx, ty] = rotate(tx, ty); [wx, wy] = rotate(wx, wy); [nx, ny] = rotate(nx, ny);
  const aPoint = funnelPoint(p, layout, 0, {}), bPoint = funnelPoint(p, layout, 1, {});
  const targetWidth = Math.hypot(bPoint.x - aPoint.x, bPoint.y - aPoint.y, bPoint.z - aPoint.z);
  const originalWidth = 1.5 * (1 + .3 * (.82 * Math.cos(angle + 1.05) + .18 * Math.cos(2 * angle - .3)));
  const mid = funnelPoint(p, layout, .5, {});
  Object.assign(out, { x, y, z, tx, ty, tz, wx, wy, wz, nx, ny, nz,
    width: mix(originalWidth, targetWidth, p.blend), thickness: mix(.07, mid.thickness, p.blend) });
  return out;
}

function surfacePoint(p, layout, source, v, offset, out) {
  const w = (v - .5) * source.width;
  const n = offset * source.thickness / 2;
  const target = funnelPoint(p, layout, v, {});
  out.x = mix(source.x + source.wx * w + source.nx * n, target.x + target.nx * offset * target.thickness / 2, p.blend);
  out.y = mix(source.y + source.wy * w + source.ny * n, target.y + target.ny * offset * target.thickness / 2, p.blend);
  out.z = mix(source.z + source.wz * w + source.nz * n, target.z + target.nz * offset * target.thickness / 2, p.blend);
  return out;
}

/** Actual mid-surface frame. At p=0 it is the exact original Möbius frame. */
export function sampleEvolutionRibbon(progress, u, options = {}) {
  const p = parameters(progress, options); u = clamp(finite(u, 0), 0, 1);
  const layout = layoutAt(p, u), source = sourceFrame(p, u, layout, {});
  let position, tangent, widthDirection, normalDirection, width, thickness;
  if (p.progress === 0) {
    position = new THREE.Vector3(source.x, source.y, source.z);
    tangent = new THREE.Vector3(source.tx, source.ty, source.tz);
    widthDirection = new THREE.Vector3(source.wx, source.wy, source.wz);
    normalDirection = new THREE.Vector3(source.nx, source.ny, source.nz);
    width = source.width; thickness = source.thickness;
  } else {
    const center = surfacePoint(p, layout, source, .5, 0, {});
    const a = surfacePoint(p, layout, source, 0, 0, {}), b = surfacePoint(p, layout, source, 1, 0, {});
    const neighbor = value => { const l = layoutAt(p, value); return surfacePoint(p, l, sourceFrame(p, value, l, {}), .5, 0, {}); };
    const low = neighbor(Math.max(0, u - .00005)), high = neighbor(Math.min(1, u + .00005));
    position = new THREE.Vector3(center.x, center.y, center.z);
    tangent = new THREE.Vector3(high.x - low.x, high.y - low.y, high.z - low.z).normalize();
    widthDirection = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    width = widthDirection.length();
    if (width > 1e-10) widthDirection.divideScalar(width); else widthDirection.set(source.wx, source.wy, source.wz);
    normalDirection = new THREE.Vector3().crossVectors(tangent, widthDirection).normalize();
    if (normalDirection.lengthSq() < .01) { const target = funnelPoint(p, layout, .5, {}); normalDirection.set(target.nx, target.ny, target.nz); }
    thickness = mix(source.thickness, funnelPoint(p, layout, .5, {}).thickness, p.blend);
  }
  return { position, tangent, widthDirection, normalDirection, width, thickness };
}

function makeBoundaries(segments) {
  return { edgeA: new Float32Array((segments + 1) * 3), edgeB: new Float32Array((segments + 1) * 3), centerline: new Float32Array((segments + 1) * 3), start: new Float32Array(17 * 3), end: new Float32Array(17 * 3) };
}
function writeBoundaries(p, layout, source, station, boundaries) {
  const point = {}, offset = station * 3;
  for (const [key, v] of [['edgeA', 1], ['edgeB', 0], ['centerline', .5]]) {
    surfacePoint(p, layout, source, v, 0, point);
    boundaries[key][offset] = point.x; boundaries[key][offset + 1] = point.y; boundaries[key][offset + 2] = point.z;
  }
}
function finishBoundaries(p, boundaries) {
  // Cross-band boundaries curve along the meridian too; a straight two-point
  // chord would falsely suggest the surface cuts through the funnel interior.
  for (const end of [0, 1]) {
    const layout = layoutAt(p, end), source = sourceFrame(p, end, layout, {});
    const output = end ? boundaries.end : boundaries.start, point = {};
    for (let i = 0; i < 17; i++) {
      surfacePoint(p, layout, source, 1 - i / 16, 0, point);
      output[i * 3] = point.x; output[i * 3 + 1] = point.y; output[i * 3 + 2] = point.z;
    }
  }
}
export function getEvolutionBoundaries(progress, options = {}) {
  const p = parameters(progress, options), boundaries = makeBoundaries(p.segments);
  for (let i = 0; i <= p.segments; i++) { const layout = layoutAt(p, i / p.segments); writeBoundaries(p, layout, sourceFrame(p, i / p.segments, layout, {}), i, boundaries); }
  finishBoundaries(p, boundaries); return boundaries;
}

// Retain the original rounded rectangular boundary and insert extra width
// samples along both faces. These interior columns follow the funnel curve.
function perimeterProfile(p, halfWidth, halfThickness) {
  const rounding = Math.min(halfThickness * .82, halfWidth * .18), result = [];
  for (let corner = 0; corner < 4; corner++) {
    const sx = corner === 0 || corner === 3 ? 1 : -1, sy = corner < 2 ? 1 : -1;
    for (let j = 0; j <= p.cornerSegments; j++) {
      const a = corner * Math.PI / 2 + j / p.cornerSegments * Math.PI / 2;
      result.push({ w: sx * (halfWidth - rounding) + Math.cos(a) * rounding, n: sy * (halfThickness - rounding) + Math.sin(a) * rounding });
    }
    if (corner === 0 || corner === 2) for (let j = 1; j < p.widthSegments; j++) {
      result.push({ w: (halfWidth - rounding) * (corner === 0 ? 1 - 2 * j / p.widthSegments : -1 + 2 * j / p.widthSegments), n: (corner === 0 ? 1 : -1) * halfThickness });
    }
  }
  return result;
}

export function createEvolutionGeometry(progress = 0, options = {}) {
  const p = parameters(progress, options);
  const perimeter = (p.cornerSegments + 1) * 4 + 2 * (p.widthSegments - 1);
  const bodyCount = (p.segments + 1) * perimeter;
  const count = bodyCount + 2 * (perimeter + 1);
  const geometry = new THREE.BufferGeometry(), indices = [];
  const positions = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  for (let i = 0; i <= p.segments; i++) for (let j = 0; j < perimeter; j++) { const n = (i * perimeter + j) * 2; uv[n] = i / p.segments; uv[n + 1] = j / perimeter; }
  for (let i = 0; i < p.segments; i++) for (let j = 0; j < perimeter; j++) {
    const next = (j + 1) % perimeter, a = i * perimeter + j, b = (i + 1) * perimeter + j, c = (i + 1) * perimeter + next, d = i * perimeter + next;
    indices.push(a, d, b, b, d, c);
  }
  // End faces are strips across the curved cross-section, not fans spanning
  // the funnel's interior. The unused centre vertex keeps the public layout.
  for (const end of [0, 1]) {
    const start = bodyCount + end * (perimeter + 1) + 1;
    for (let j = 0; j < perimeter / 2 - 1; j++) {
      const a = start + j, b = start + j + 1, c = start + perimeter - 2 - j, d = start + perimeter - 1 - j;
      if (end) indices.push(a, b, c, a, c, d); else indices.push(a, c, b, a, d, c);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.userData = { segments: p.segments, cornerSegments: p.cornerSegments, widthSegments: p.widthSegments, perimeterCount: perimeter, bodyVertexCount: bodyCount, boundaries: makeBoundaries(p.segments) };
  updateEvolutionGeometry(geometry, progress, options);
  geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  return geometry;
}

export function updateEvolutionGeometry(geometry, progress, options = {}) {
  const data = geometry.userData;
  const p = parameters(progress, { ...options, segments: data.segments, cornerSegments: data.cornerSegments, widthSegments: data.widthSegments });
  const positions = geometry.attributes.position.array, perimeter = data.perimeterCount;
  for (let i = 0; i <= p.segments; i++) {
    const u = i / p.segments, layout = layoutAt(p, u), source = sourceFrame(p, u, layout, {});
    writeBoundaries(p, layout, source, i, data.boundaries);
    const profile = perimeterProfile(p, source.width / 2, source.thickness / 2);
    const halfWidth = source.width / 2, halfThickness = source.thickness / 2;
    const point = {};
    for (let j = 0; j < perimeter; j++) {
      const v = halfWidth > 1e-10 ? clamp(profile[j].w / source.width + .5, 0, 1) : .5;
      const normalOffset = halfThickness > 1e-10 ? profile[j].n / halfThickness : 0;
      surfacePoint(p, layout, source, v, normalOffset, point);
      const target = (i * perimeter + j) * 3;
      positions[target] = point.x; positions[target + 1] = point.y; positions[target + 2] = point.z;
    }
  }
  const release = smooth(0, .006, p.progress);
  for (const end of [0, 1]) {
    const station = end ? p.segments : 0, layout = layoutAt(p, end), source = sourceFrame(p, end, layout, {});
    const center = surfacePoint(p, layout, source, .5, 0, {});
    const cap = data.bodyVertexCount + end * (perimeter + 1);
    positions.set([center.x, center.y, center.z], cap * 3);
    for (let j = 0; j < perimeter; j++) {
      const a = (station * perimeter + j) * 3, b = (cap + 1 + j) * 3;
      positions[b] = mix(center.x, positions[a], release); positions[b + 1] = mix(center.y, positions[a + 1], release); positions[b + 2] = mix(center.z, positions[a + 2], release);
    }
  }
  finishBoundaries(p, data.boundaries);
  geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals();
  if (p.progress === 0) {
    const normals = geometry.attributes.normal.array;
    for (let j = 0; j < perimeter; j++) {
      const a = j * 3, b = (p.segments * perimeter + (j + perimeter / 2) % perimeter) * 3;
      const x = normals[a] + normals[b], y = normals[a + 1] + normals[b + 1], z = normals[a + 2] + normals[b + 2], n = Math.hypot(x, y, z) || 1;
      normals[a] = normals[b] = x / n; normals[a + 1] = normals[b + 1] = y / n; normals[a + 2] = normals[b + 2] = z / n;
    }
    geometry.attributes.normal.needsUpdate = true;
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  data.progress = p.progress; data.effectiveTurns = mix(1, p.turns, p.angular); data.closed = p.progress === 0;
  data.parameters = { turns: p.turns, length: p.length, width: p.width, endRadius: p.endRadius, taper: p.taper, neck: p.neck, pitch: p.pitch, tipWidth: p.tipWidth, radius: p.radius, thickness: p.thickness };
  data.model = 'outside-funnel-band';
  return geometry;
}
