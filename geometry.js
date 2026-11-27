import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const RIBBON_DEFAULTS = Object.freeze({
  growth: 0.68,
  turns: 2.6,
  radius: 1.55,
  pitch: 1.8,
  width: 1.3,
  thickness: 0.07,
  twist: 0.5,
  taper: 0.25,
  asymmetry: 0.2,
  segments: 360,
});

function normalizeParams(input = {}) {
  const p = { ...RIBBON_DEFAULTS, ...input };
  p.growth = clamp(finite(p.growth, 0.68), 0, 1);
  p.turns = clamp(finite(p.turns, 2.6), 1, 6);
  p.radius = clamp(finite(p.radius, 1.55), 0.3, 6);
  p.pitch = clamp(finite(p.pitch, 1.8), 0, 5);
  p.width = clamp(finite(p.width, 1.3), 0.08, p.radius * 1.8);
  p.thickness = clamp(finite(p.thickness, 0.07), 0.008, p.width * 0.45);
  p.twist = clamp(finite(p.twist, 0.5), -3, 3);
  p.taper = clamp(finite(p.taper, 0.25), 0, 0.8);
  p.asymmetry = clamp(finite(p.asymmetry, 0.2), 0, 0.8);
  p.segments = Math.round(clamp(finite(p.segments, 360), 64, 1200));
  p.closed = p.growth <= 0.000001;
  p.effectiveTurns = 1 + (p.turns - 1) * p.growth;
  // A closed sweep can only meet with an integer number of half twists.
  // For arbitrary slider values, converge smoothly onto that valid closure.
  const closedTwist = Math.round(p.twist * 2) / 2;
  const release = Math.min(p.growth / 0.08, 1);
  p.effectiveTwist = THREE.MathUtils.lerp(closedTwist, p.twist, release);
  return p;
}

/**
 * Conceptual reconstruction, rather than a tracing of the supplied logo.
 * A slightly oval, asymmetrically weighted ribbon opens continuously into
 * a Y-up helix. At zero growth the middle surface has a genuine half twist.
 */
function centerAt(p, u) {
  const angle = TAU * p.effectiveTurns * u;
  const weight = 1 + p.asymmetry * (
    0.24 * Math.cos(angle - 0.55) + 0.12 * Math.cos(2 * angle + 0.3)
  );
  const radius = p.radius * weight;
  return new THREE.Vector3(
    radius * Math.cos(angle) * (1 + p.asymmetry * 0.14),
    p.pitch * p.growth * p.effectiveTurns * (u - 0.5)
      + (1 - p.growth) * p.radius * 0.08 * Math.sin(angle + 0.3),
    radius * Math.sin(angle) * (1 - p.asymmetry * 0.26),
  );
}

function sampleNormalized(p, u) {
  const angle = TAU * p.effectiveTurns * u;
  const center = centerAt(p, u);
  const epsilon = 0.00001;
  const tangent = centerAt(p, u + epsilon).sub(centerAt(p, u - epsilon)).normalize();

  // Project the radial vector into the normal plane. Unlike a Frenet frame,
  // this stays stable at zero pitch and at the ends of the developing loop.
  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  radial.addScaledVector(tangent, -radial.dot(tangent)).normalize();
  const upright = new THREE.Vector3().crossVectors(tangent, radial).normalize();
  const rotation = TAU * p.effectiveTwist * u + 0.28;
  const widthDirection = radial.clone().multiplyScalar(Math.cos(rotation))
    .addScaledVector(upright, Math.sin(rotation));
  const normalDirection = new THREE.Vector3().crossVectors(tangent, widthDirection).normalize();

  // The tapered shoulder gives the aperture an off-center, logo-like weight.
  const envelope = 1 + p.taper * (
    0.82 * Math.cos(angle + 1.05) + 0.18 * Math.cos(2 * angle - 0.3)
  );
  return {
    position: center,
    tangent,
    widthDirection,
    normalDirection,
    width: p.width * envelope,
    thickness: p.thickness,
  };
}

/** Return the center, local frame, and dimensions at normalized length u. */
export function sampleRibbon(params = {}, u = 0) {
  return sampleNormalized(normalizeParams(params), clamp(finite(u, 0), 0, 1));
}

/**
 * Create a closed, bevel-edged ribbon solid. Open helices include flat end
 * caps. Call geometry.dispose() when replacing it during live editing.
 */
export function createRibbonGeometry(params = {}) {
  const p = normalizeParams(params);
  const cornerSegments = 5;
  const perimeterCount = (cornerSegments + 1) * 4;
  const stationCount = p.closed ? p.segments : p.segments + 1;
  const positions = [];
  const uv = [];
  const indices = [];

  for (let i = 0; i < stationCount; i++) {
    const u = i / p.segments;
    const frame = sampleNormalized(p, u);
    const halfWidth = frame.width / 2;
    const halfThickness = frame.thickness / 2;
    const rounding = Math.min(halfThickness * 0.82, halfWidth * 0.18);

    for (let corner = 0; corner < 4; corner++) {
      const sx = corner === 0 || corner === 3 ? 1 : -1;
      const sy = corner < 2 ? 1 : -1;
      for (let j = 0; j <= cornerSegments; j++) {
        const a = corner * Math.PI / 2 + (j / cornerSegments) * Math.PI / 2;
        const widthOffset = sx * (halfWidth - rounding) + Math.cos(a) * rounding;
        const thicknessOffset = sy * (halfThickness - rounding) + Math.sin(a) * rounding;
        const point = frame.position.clone()
          .addScaledVector(frame.widthDirection, widthOffset)
          .addScaledVector(frame.normalDirection, thicknessOffset);
        positions.push(point.x, point.y, point.z);
        uv.push(u, (corner * (cornerSegments + 1) + j) / perimeterCount);
      }
    }
  }

  // A Möbius closure maps both width and thickness to their opposite signs.
  // Sharing those indices avoids the visible split of a duplicated UV seam.
  const halfTwists = Math.round(p.effectiveTwist * 2);
  const closureShift = Math.abs(halfTwists % 2) ? perimeterCount / 2 : 0;
  for (let i = 0; i < p.segments; i++) {
    const wrap = p.closed && i === p.segments - 1;
    const nextStation = wrap ? 0 : i + 1;
    const shift = wrap ? closureShift : 0;
    for (let j = 0; j < perimeterCount; j++) {
      const nextJ = (j + 1) % perimeterCount;
      const a = i * perimeterCount + j;
      const d = i * perimeterCount + nextJ;
      const b = nextStation * perimeterCount + (j + shift) % perimeterCount;
      const c = nextStation * perimeterCount + (nextJ + shift) % perimeterCount;
      indices.push(a, d, b, b, d, c);
    }
  }

  if (!p.closed) {
    for (const end of [0, 1]) {
      const station = end ? stationCount - 1 : 0;
      const capCenter = positions.length / 3;
      const frame = sampleNormalized(p, end);
      positions.push(frame.position.x, frame.position.y, frame.position.z);
      uv.push(0.5, 0.5);
      const capStart = positions.length / 3;
      // Separate cap vertices preserve a crisp end face against soft edges.
      for (let j = 0; j < perimeterCount; j++) {
        const source = (station * perimeterCount + j) * 3;
        positions.push(positions[source], positions[source + 1], positions[source + 2]);
        uv.push(j / perimeterCount, end);
      }
      for (let j = 0; j < perimeterCount; j++) {
        const a = capStart + j;
        const b = capStart + (j + 1) % perimeterCount;
        if (end) indices.push(capCenter, a, b);
        else indices.push(capCenter, b, a);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const dimensions = new THREE.Vector3();
  geometry.boundingBox.getSize(dimensions);
  geometry.userData = {
    closed: p.closed,
    effectiveTurns: p.effectiveTurns,
    effectiveTwist: p.effectiveTwist,
    dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    parameters: p,
  };
  return geometry;
}
