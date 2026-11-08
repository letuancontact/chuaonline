import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Group,
  type Material,
  type Scene,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOUNDARY, GATE, LANTERN_LOOP, PATH, PATH_LANTERNS, ROCKS, type Vec2 } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import type { Assets } from "./assets.ts";
import type { MaterialKey, Materials } from "./materials.ts";
import { GeometryBatch, disposeGroupGeometry } from "./merge.ts";
import { gardenRegionOf, type GardenRegion, type Regions } from "./regions.ts";
import { createRoofGeometry } from "./roof.ts";
import { seeded } from "./random.ts";

type Key = MaterialKey | "gravel" | "rock" | "lanternPaper" | "lotusLamp";

/** Lantern emissive: faint by day, glowing at night. */
const GLOW_DAY = 0.22;
const GLOW_NIGHT = 2.4;
/** Stone lantern light box: centre height, used for the halo. */
const STONE_LIGHT_Y = 1.04;
const LOTUS_LIGHT_Y = 0.28;
/** Path slabs sit this far proud of the ground (walkers' feet sink by as much: invisible). */
export const SLAB_TOP = 0.05;
/** Loop ribbon height above the ground; polygonOffset keeps it from z-fighting. */
const LOOP_Y = 0.02;

/** Wide-canopy ancient trees surrounding the temple courtyard (matching cothu.glb proportions). */
const ANCIENT_TREE_COUNT = 14;
const ANCIENT_RING = [1.05, 1.15] as const;
const ANCIENT_SCALE = [1.02, 1.38] as const;
/** Lush broad-canopy trees beyond the boundary: vibrant green forest edge softened by fog. */
const FAR_TREE_COUNT = 160;
const FAR_RING = [1.65, 2.55] as const;
const FAR_HEIGHT = [12, 22] as const;
/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.32;

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_PILLAR_X = 3.4;
const GATE_WALL_X = 18;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const UP = new Vector3(0, 1, 0);
const segDir = new Vector3();
const segQuat = new Quaternion();
const segPos = new Vector3();
const segScale = new Vector3(1, 1, 1);
const segMat = new Matrix4();

function box(batch: GeometryBatch<Key>, key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1, castShadow = true): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile, castShadow });
  g.dispose();
}

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromAxisAngle(UP, yaw), s3.set(sx, sy, sz));
}

/** Paint a solid vertex color onto a geometry. */
function colorGeo(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(arr, 3));
  return g;
}

/** Gnarled, fluted bark cylinder for ancient tree trunks, roots, and boughs. */
function barkCylinder(
  rTop: number,
  rBottom: number,
  height: number,
  radialSegs: number,
  seed: number,
  gnarl = 0.14,
): CylinderGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, radialSegs, 2);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    const flute =
      1 +
      gnarl * Math.sin(angle * 5 + y * 2.1 + seed) +
      gnarl * 0.48 * Math.cos(angle * 3 - y * 2.9 + seed * 1.3);
    pos.setXYZ(i, x * flute, y, z * flute);
  }
  g.computeVertexNormals();
  return g;
}

/** Appends a curved, tapering quadratic-Bézier limb made of gnarled bark segments. */
function appendCurvedLimb(
  parts: BufferGeometry[],
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  rStart: number,
  rEnd: number,
  segments: number,
  radialSegs: number,
  colorStart: number,
  colorEnd: number,
  gnarl = 0.11,
): void {
  const c0 = new Color(colorStart);
  const c1 = new Color(colorEnd);
  const cStep = new Color();

  const evalPt = (t: number, out: [number, number, number]): void => {
    const inv = 1 - t;
    out[0] = inv * inv * p0[0] + 2 * inv * t * p1[0] + t * t * p2[0];
    out[1] = inv * inv * p0[1] + 2 * inv * t * p1[1] + t * t * p2[1];
    out[2] = inv * inv * p0[2] + 2 * inv * t * p1[2] + t * t * p2[2];
  };

  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    evalPt(t0, a);
    evalPt(t1, b);

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) continue;

    const r0 = rStart + (rEnd - rStart) * Math.pow(t0, 0.82);
    const r1 = rStart + (rEnd - rStart) * Math.pow(t1, 0.82);

    const cyl = barkCylinder(r1, r0, len * 1.14, radialSegs, i * 1.9 + rStart * 11, gnarl);
    segDir.set(dx / len, dy / len, dz / len);
    segQuat.setFromUnitVectors(UP, segDir);
    segPos.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    segMat.compose(segPos, segQuat, segScale);
    cyl.applyMatrix4(segMat);

    cStep.copy(c0).lerp(c1, (t0 + t1) * 0.5);
    parts.push(colorGeo(cyl, cStep.getHex()));
  }
}

/**
 * Sculpted billowy foliage pad with 4-tone vertex-color shading (deep shaded underside ->
 * emerald mid-tone -> vibrant fresh leaf green -> sunlit golden-green crown).
 */
function foliageCloudGeometry(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  seed: number,
  goldenTip: number,
): BufferGeometry {
  const g = new SphereGeometry(1, 10, 7);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  const deepShade = new Color(0x1b5228);
  const richEmerald = new Color(0x2f853e);
  const sunlitGreen = new Color(0x5ec454);
  const crownGold = new Color(0xa8e052);
  const cTmp = new Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const lobe =
      1 +
      0.21 * Math.sin(3.5 * x + seed) * Math.cos(3.1 * z + seed * 1.3) +
      0.13 * Math.sin(4.8 * y + 2.3 * x + seed * 1.9);

    // Flattened underside like real layered banyan/bodhi leaf pads
    const flatY = y < 0 ? y * 0.54 : y;

    const wx = cx + x * rx * lobe;
    const wy = cy + flatY * ry * lobe;
    const wz = cz + z * rz * lobe;
    pos.setXYZ(i, wx, wy, wz);

    const heightNorm = Math.max(0, Math.min(1, (wy - 3.2) / 4.2));
    const localTop = Math.max(0, Math.min(1, (y + 0.65) / 1.6));
    const light = Math.max(0, Math.min(1, localTop * 0.66 + heightNorm * 0.34));

    if (light < 0.44) {
      cTmp.copy(deepShade).lerp(richEmerald, light / 0.44);
    } else {
      cTmp.copy(richEmerald).lerp(sunlitGreen, (light - 0.44) / 0.56);
    }
    if (goldenTip > 0 && light > 0.64) {
      cTmp.lerp(crownGold, goldenTip * (light - 0.64));
    }

    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Simulates the `cothu.glb` ancient banyan/bodhi tree:
 * - Wide aspect ratio (width ~8.6 m, height ~7.5 m -> ~1.14 : 1 matching `cothu.glb`).
 * - Flared buttress roots, gnarled twisted trunk, 6 sweeping primary boughs, 12 fork branches,
 *   and hanging aerial roots.
 * - 25 layered, billowy multi-lobed green foliage clouds.
 */
function createAncientTreeGeometries(): { trunk: BufferGeometry; canopy: BufferGeometry } {
  const trunkParts: BufferGeometry[] = [];
  const canopyParts: BufferGeometry[] = [];

  // 1. Massive gnarled main trunk with natural S-curve taper
  appendCurvedLimb(trunkParts, [0, -0.05, 0], [0.18, 1.65, -0.12], [-0.08, 3.35, 0.08], 0.78, 0.48, 5, 9, 0x3d2b1c, 0x573e29, 0.16);
  appendCurvedLimb(trunkParts, [-0.08, 3.15, 0.08], [0.12, 4.35, -0.06], [0.0, 5.4, 0.0], 0.44, 0.18, 4, 8, 0x573e29, 0x694c34, 0.12);

  // 2. 8 flared buttress roots gripping the earth around the base
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.16;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const twist = (i % 2 === 0 ? 1 : -1) * 0.25;
    appendCurvedLimb(
      trunkParts,
      [ca * 0.42, 1.35, sa * 0.42],
      [ca * 1.18 - sa * twist, 0.55, sa * 1.18 + ca * twist],
      [ca * 1.95, -0.04, sa * 1.95],
      0.28,
      0.08,
      4,
      6,
      0x473322,
      0x38281a,
      0.15,
    );
  }

  // 3. 6 heavy, wide-spreading primary boughs + 12 secondary fork branches + canopy clouds
  const mainBoughs = 6;
  for (let i = 0; i < mainBoughs; i++) {
    const a = (i / mainBoughs) * Math.PI * 2 + 0.24;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yStart = 2.75 + (i % 3) * 0.22;
    const midR = 1.65;
    const endR = 3.05 + (i % 2) * 0.28;
    const endY = 4.05 + (i % 3) * 0.25;

    const p0: [number, number, number] = [ca * 0.28, yStart, sa * 0.28];
    const p1: [number, number, number] = [ca * midR - sa * 0.28, yStart + 0.82, sa * midR + ca * 0.28];
    const p2: [number, number, number] = [ca * endR, endY, sa * endR];

    appendCurvedLimb(trunkParts, p0, p1, p2, 0.34, 0.13, 4, 7, 0x543b27, 0x6b4d35, 0.11);

    // Lower outer foliage pad at the end of each primary bough
    canopyParts.push(
      foliageCloudGeometry(p2[0], p2[1] + 0.35, p2[2], 1.85, 0.98, 1.85, i * 5.1 + 1.0, 0.22),
    );
    // Mid-tier inner foliage pad above the bough elbow
    canopyParts.push(
      foliageCloudGeometry(p1[0] * 0.95, p1[1] + 1.05, p1[2] * 0.95, 1.92, 1.05, 1.92, i * 5.1 + 2.3, 0.35),
    );

    // Secondary left & right fork branches reaching further out
    for (const side of [-1, 1] as const) {
      const fa = a + side * 0.44;
      const fca = Math.cos(fa);
      const fsa = Math.sin(fa);
      const forkLen = 3.55 + (side > 0 ? 0.22 : 0);
      const forkY = endY + 0.32 + (side > 0 ? 0.18 : -0.06);

      const fp0: [number, number, number] = [p1[0], p1[1] + 0.06, p1[2]];
      const fp1: [number, number, number] = [fca * 2.55, endY + 0.2, fsa * 2.55];
      const fp2: [number, number, number] = [fca * forkLen, forkY, fsa * forkLen];

      appendCurvedLimb(trunkParts, fp0, fp1, fp2, 0.18, 0.065, 3, 6, 0x5e432d, 0x73543b, 0.09);

      canopyParts.push(
        foliageCloudGeometry(
          fp2[0],
          fp2[1] + 0.25,
          fp2[2],
          1.52,
          0.84,
          1.52,
          i * 7.3 + (side > 0 ? 3.1 : 4.7),
          side > 0 ? 0.38 : 0.16,
        ),
      );
    }
  }

  // 4. 10 hanging aerial roots (rễ phụ cây đa / bồ đề cổ thụ) draping from lower boughs
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.18;
    const r = i % 2 === 0 ? 1.45 : 2.05;
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const topY = i % 2 === 0 ? 3.55 : 3.85;
    const botY = i % 3 === 0 ? 0.0 : 1.55 + (i % 2) * 0.42;
    const sway = (i % 2 === 0 ? 1 : -1) * 0.14;
    appendCurvedLimb(
      trunkParts,
      [rx, topY, rz],
      [rx + sway, (topY + botY) * 0.5, rz - sway],
      [rx * 0.96, botY, rz * 0.96],
      0.036,
      0.016,
      3,
      5,
      0x4f3825,
      0x664b33,
      0.05,
    );
  }

  // 5. Upper sunlit crown domes uniting the silhouette into a grand, lush dome
  canopyParts.push(foliageCloudGeometry(0, 6.05, 0, 2.55, 1.28, 2.55, 71.2, 0.48));
  canopyParts.push(foliageCloudGeometry(1.15, 5.75, 0.95, 1.95, 1.02, 1.95, 83.4, 0.42));
  canopyParts.push(foliageCloudGeometry(-1.18, 5.68, -0.92, 1.95, 1.02, 1.95, 95.6, 0.42));
  canopyParts.push(foliageCloudGeometry(-0.95, 5.82, 1.12, 1.85, 0.98, 1.85, 107.8, 0.45));
  canopyParts.push(foliageCloudGeometry(0.98, 5.78, -1.08, 1.85, 0.98, 1.85, 119.1, 0.45));
  canopyParts.push(foliageCloudGeometry(0, 6.65, 0, 1.95, 1.05, 1.95, 131.5, 0.58));

  const trunk = mergeGeometries(trunkParts);
  for (const g of trunkParts) g.dispose();
  if (!trunk) throw new Error("merge: ancient tree trunk");

  const canopy = mergeGeometries(canopyParts);
  for (const g of canopyParts) g.dispose();
  if (!canopy) throw new Error("merge: ancient tree canopy");

  return { trunk, canopy };
}

/** Distant broad-canopy tree (unit height) for the outer forest ring. */
function createFarCanopyTreeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = colorGeo(new CylinderGeometry(0.038, 0.062, 0.36, 6).translate(0, 0.18, 0), 0x4a3321);
  const lowL = colorGeo(new SphereGeometry(0.36, 8, 6).scale(1.22, 0.6, 1.22).translate(-0.1, 0.5, 0.06), 0x266934);
  const lowR = colorGeo(new SphereGeometry(0.36, 8, 6).scale(1.25, 0.62, 1.25).translate(0.11, 0.58, -0.05), 0x338241);
  const top = colorGeo(new SphereGeometry(0.34, 8, 6).scale(1.18, 0.66, 1.18).translate(0, 0.76, 0), 0x4ba352);
  parts.push(trunk, lowL, lowR, top);
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: far canopy trees");
  return merged;
}

/** Two columns of irregular flagstones along the stone path. */
function addPath(batch: GeometryBatch<Key>, rand: () => number): void {
  const half = PATH.width / 2;
  const gap = 0.06;
  let z = PATH.from.z;
  while (z < PATH.to.z - 0.2) {
    const len = Math.min(0.8 + rand() * 0.5, PATH.to.z - z);
    const split = (rand() - 0.5) * 0.7;
    for (const [x0, x1] of [[-half, split], [split, half]] as const) {
      const g = new BoxGeometry(x1 - x0 - gap, 0.1, len - gap);
      batch.add("stone", g, place((x0 + x1) / 2, SLAB_TOP - 0.05, z + len / 2, (rand() - 0.5) * 0.03), { worldUV: 2.6 });
      g.dispose();
    }
    z += len;
  }
}

/** A flat 2 m ribbon along LANTERN_LOOP. Indexed, with up normals and metre UVs (GeometryBatch contract). */
function loopRibbon(points: readonly Vec2[], width: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const dir = new Vector2();
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)] ?? p;
    const b = points[Math.min(points.length - 1, i + 1)] ?? p;
    dir.set(b.x - a.x, b.z - a.z).normalize();
    const ox = -dir.y * (width / 2);
    const oz = dir.x * (width / 2);
    pos.push(p.x + ox, LOOP_Y, p.z + oz, p.x - ox, LOOP_Y, p.z - oz);
    nrm.push(0, 1, 0, 0, 1, 0);
    uv.push(0, 0, 0, 0);
    if (i > 0) {
      const k = (i - 1) * 2;
      // Left/right swap with the travel direction; pick the winding whose face points up.
      const e1x = pos[(k + 1) * 3]! - pos[k * 3]!;
      const e1z = pos[(k + 1) * 3 + 2]! - pos[k * 3 + 2]!;
      const e2x = pos[(k + 2) * 3]! - pos[k * 3]!;
      const e2z = pos[(k + 2) * 3 + 2]! - pos[k * 3 + 2]!;
      const up = e1z * e2x - e1x * e2z > 0;
      if (up) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function addStoneLantern(batch: GeometryBatch<Key>, x: number, z: number): void {
  box(batch, "rock", x - 0.31, x + 0.31, 0, 0.16, z - 0.31, z + 0.31, 3);
  box(batch, "rock", x - 0.12, x + 0.12, 0.16, 0.78, z - 0.12, z + 0.12, 3);
  box(batch, "rock", x - 0.25, x + 0.25, 0.78, 0.86, z - 0.25, z + 0.25, 3);
  box(batch, "lanternPaper", x - 0.17, x + 0.17, 0.86, 1.22, z - 0.17, z + 0.17, 0.5);
  for (const dx of [-0.19, 0.19]) for (const dz of [-0.19, 0.19]) box(batch, "rock", x + dx - 0.035, x + dx + 0.035, 0.86, 1.22, z + dz - 0.035, z + dz + 0.035, 3);
  const cap = new ConeGeometry(0.42, 0.26, 4, 1);
  batch.add("rock", cap, place(x, 1.35, z, Math.PI / 4), { worldUV: 3 });
  cap.dispose();
  const knob = new SphereGeometry(0.07, 8, 6);
  batch.add("rock", knob, place(x, 1.5, z), { worldUV: 3 });
  knob.dispose();
}

/** Lotus-bud lamp sitting on the grass: a lathe with scalloped petals. */
function lotusLampGeometry(): BufferGeometry {
  const profile = [
    [0.001, 0],
    [0.14, 0.01],
    [0.24, 0.08],
    [0.27, 0.18],
    [0.23, 0.29],
    [0.12, 0.37],
    [0.001, 0.4],
  ].map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(profile, 24);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = 1 + 0.1 * Math.cos(8 * Math.atan2(z, x));
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Largest outward push of rockGeometry's noise; dividing by it keeps the rock inside its collider circle. */
const ROCK_BULGE = 1.24;

/** Lumpy rock: a sphere pushed in/out by a few sines (same position → same offset, so UV seams stay closed). */
function rockGeometry(seed: number): BufferGeometry {
  const g = new SphereGeometry(1, 10, 7);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = (1 + 0.16 * Math.sin(3.1 * x + seed) * Math.cos(2.3 * z + seed * 1.7) + 0.08 * Math.sin(5.3 * y + seed * 2.1)) / ROCK_BULGE;
    pos.setXYZ(i, x * n, Math.max(y, -0.35) * n, z * n);
  }
  g.computeVertexNormals();
  return g;
}

function addGate(batch: GeometryBatch<Key>): void {
  const z0 = GATE.zMin;
  const z1 = GATE.zMax;
  // Pillars on stone plinths.
  const pillar = new CylinderGeometry(0.26, 0.3, 4.2, 14);
  const plinth = new CylinderGeometry(0.42, 0.48, 0.3, 14);
  for (const x of [-GATE_PILLAR_X, GATE_PILLAR_X]) {
    batch.add("stone", plinth, place(x, 0.15, GATE_Z), { worldUV: 0.8 });
    batch.add("paintRed", pillar, place(x, 0.3 + 2.1, GATE_Z), { uvScale: [2, 4] });
  }
  pillar.dispose();
  plinth.dispose();
  // Lintel beams.
  box(batch, "paintRed", -GATE_PILLAR_X - 0.5, GATE_PILLAR_X + 0.5, 3.4, 3.62, GATE_Z - 0.16, GATE_Z + 0.16, 1);
  box(batch, "darkWood", -GATE_PILLAR_X - 0.7, GATE_PILLAR_X + 0.7, 4.1, 4.5, GATE_Z - 0.22, GATE_Z + 0.22, 1);
  // Small hip roof.
  const roof = createRoofGeometry({
    cx: 0,
    cz: GATE_Z,
    halfX: GATE_PILLAR_X + 1.5,
    halfZ: (z1 - z0) / 2 + 0.9,
    ridgeHalf: GATE_PILLAR_X,
    eaveY: 4.5,
    rise: 1.2,
    sag: 1.6,
    cornerLift: 0.35,
    thickness: 0.16,
  }, 3);
  batch.add("roof", roof.top);
  batch.add("wood", roof.bottom);
  batch.add("roofTrim", roof.fascia);
  roof.top.dispose();
  roof.bottom.dispose();
  roof.fascia.dispose();
  // Low walls either side of the gate, capped with tile trim.
  for (const s of [-1, 1]) {
    const xa = s * (GATE_PILLAR_X + 0.4);
    const xb = s * GATE_WALL_X;
    const [x0, x1] = xa < xb ? [xa, xb] : [xb, xa];
    box(batch, "stone", x0, x1, 0, 0.5, GATE_Z - 0.28, GATE_Z + 0.28, 1.2);
    box(batch, "plaster", x0, x1, 0.5, 1.55, GATE_Z - 0.22, GATE_Z + 0.22, 1.5);
    box(batch, "roofTrim", x0 - 0.1, x1 + 0.1, 1.55, 1.75, GATE_Z - 0.4, GATE_Z + 0.4, 1);
  }
}

/** Point on the boundary ellipse at angle a, scaled outwards by s. */
function ringPoint(a: number, s: number): Vec2 {
  return { x: BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * s, z: BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * s };
}

export interface LanternSpots {
  stone: readonly Vector3[];
  lotus: readonly Vector3[];
}

export interface Garden {
  readonly lanterns: LanternSpots;
  update(daylight: number): void;
  dispose(): void;
}

export async function createGarden(scene: Scene, _assets: Assets, materials: Materials, regions: Regions): Promise<Garden> {
  const rand = seeded(0x5a7d);

  const owned: Material[] = [];
  const own = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const gravel = own(
    new MeshStandardMaterial({
      map: materials.stone.map,
      normalMap: materials.stone.normalMap,
      roughnessMap: materials.stone.roughnessMap,
      color: 0xa69f90,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  // Weathered granite: the stone set's relief without its cobble colour pattern.
  const rock = own(
    new MeshStandardMaterial({ normalMap: materials.stone.normalMap, roughnessMap: materials.stone.roughnessMap, color: 0x827d73, metalness: 0 }),
  );
  const lanternPaper = own(new MeshStandardMaterial({ color: 0xf5e9cc, roughness: 0.9, emissive: 0xffc680, emissiveIntensity: GLOW_DAY }));
  const lotusLamp = own(new MeshStandardMaterial({ color: 0xf7dcd8, roughness: 0.85, emissive: 0xffbe92, emissiveIntensity: GLOW_DAY }));
  const batchMaterials = { ...materials, gravel, rock, lanternPaper, lotusLamp };

  const batches = new Map<GardenRegion | "gate", GeometryBatch<Key>>();
  const batchOf = (r: GardenRegion | "gate"): GeometryBatch<Key> => {
    let b = batches.get(r);
    if (!b) batches.set(r, (b = new GeometryBatch<Key>()));
    return b;
  };

  // Stone path + its lanterns.
  addPath(batchOf("garden-near"), rand);
  const stone = PATH_LANTERNS.map((p) => {
    addStoneLantern(batchOf(gardenRegionOf(p.x, p.z)), p.x, p.z);
    return new Vector3(p.x, STONE_LIGHT_Y, p.z);
  });

  // Lotus-lantern loop.
  const ribbon = loopRibbon(LANTERN_LOOP.points, LANTERN_LOOP.width);
  batchOf("garden-west").add("gravel", ribbon, undefined, { worldUV: 1.5, castShadow: false });
  ribbon.dispose();
  const lampGeo = lotusLampGeometry().scale(1.4, 1.4, 1.4);
  const lotus = LANTERN_LOOP.lanterns.map((p) => {
    batchOf(gardenRegionOf(p.x, p.z)).add("lotusLamp", lampGeo, place(p.x, 0, p.z, rand() * Math.PI), { castShadow: false });
    return new Vector3(p.x, LOTUS_LIGHT_Y, p.z);
  });
  lampGeo.dispose();

  // Rocks: footprint r, about half as tall, sunk a little.
  ROCKS.forEach((r, i) => {
    const g = rockGeometry(i * 2.37 + 1);
    batchOf(gardenRegionOf(r.x, r.z)).add("rock", g, place(r.x, r.r * 0.12, r.z, rand() * Math.PI * 2, r.r, r.r * (0.45 + rand() * 0.2), r.r * 0.82), { worldUV: 4 });
    g.dispose();
  });

  addGate(batchOf("gate"));

  const built: Group[] = [];
  for (const [region, batch] of batches) {
    const group = batch.build(`garden:${region}`, batchMaterials);
    regions.group(region).add(group);
    built.push(group);
  }

  // Wide-canopy ancient trees surrounding the courtyard boundary (matching cothu.glb silhouette & foliage).
  const ancientGeo = createAncientTreeGeometries();
  const uTreeTime = { value: 0 };
  const trunkMat = own(new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 }));
  const canopyMat = own(
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.0,
      emissive: new Color(0x113016),
      emissiveIntensity: 0.22,
    }),
  );
  canopyMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTreeTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float swayWeight = clamp((transformed.y - 2.5) * 0.28, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.048 * sin(uTime * 1.55 + leafPhase) + 0.022 * cos(uTime * 2.8 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.22;
        transformed.z += leafSway * 0.65;`,
      );
  };

  const trunks = new InstancedMesh(ancientGeo.trunk, trunkMat, ANCIENT_TREE_COUNT);
  const canopies = new InstancedMesh(ancientGeo.canopy, canopyMat, ANCIENT_TREE_COUNT);

  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let k = 0; k < ANCIENT_TREE_COUNT; k++) {
    const a = Math.PI / 2 + GATE_GAP_RAD + ((k + 0.2 + rand() * 0.6) / ANCIENT_TREE_COUNT) * arc;
    const p = ringPoint(a, ANCIENT_RING[0] + rand() * (ANCIENT_RING[1] - ANCIENT_RING[0]));
    const sc = ANCIENT_SCALE[0] + rand() * (ANCIENT_SCALE[1] - ANCIENT_SCALE[0]);
    const spread = sc * (1.06 + rand() * 0.18);
    const yaw = rand() * Math.PI * 2;
    const mat = place(p.x, 0, p.z, yaw, spread, sc, spread);
    trunks.setMatrixAt(k, mat);
    canopies.setMatrixAt(k, mat);
  }
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  trunks.computeBoundingSphere();
  trunks.name = "ancient-tree-trunks";

  canopies.castShadow = true;
  canopies.receiveShadow = true;
  canopies.computeBoundingSphere();
  canopies.name = "ancient-tree-canopies";

  // Distant broad-canopy forest ring beyond the boundary.
  const farGeo = createFarCanopyTreeGeometry();
  const farMat = own(new MeshLambertMaterial({ vertexColors: true }));
  const far = new InstancedMesh(farGeo, farMat, FAR_TREE_COUNT);
  for (let i = 0; i < FAR_TREE_COUNT; i++) {
    const a = rand() * Math.PI * 2;
    const p = ringPoint(a, FAR_RING[0] + rand() * (FAR_RING[1] - FAR_RING[0]));
    const h = FAR_HEIGHT[0] + rand() * (FAR_HEIGHT[1] - FAR_HEIGHT[0]);
    const w = h * (0.95 + rand() * 0.35);
    far.setMatrixAt(i, place(p.x, 0, p.z, rand() * Math.PI, w, h, w));
  }
  far.computeBoundingSphere();
  far.name = "far-trees";

  const forest: InstancedMesh[] = [trunks, canopies, far];
  for (const o of forest) {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    scene.add(o);
  }

  registerCameraPreset("gate", { position: [0, 2.4, 36], target: [0, 2.6, 46] });
  registerCameraPreset("overview", { position: [0, 75, 100], target: [0, 0, 10] });

  return {
    lanterns: { stone, lotus },
    update(daylight) {
      uTreeTime.value = performance.now() * 0.001;
      const k = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * (1 - daylight);
      lanternPaper.emissiveIntensity = k;
      lotusLamp.emissiveIntensity = k;
      canopyMat.emissiveIntensity = 0.16 + 0.14 * daylight;
    },
    dispose() {
      for (const g of built) {
        g.removeFromParent();
        disposeGroupGeometry(g);
      }
      for (const o of forest) {
        scene.remove(o);
        o.dispose();
      }
      ancientGeo.trunk.dispose();
      ancientGeo.canopy.dispose();
      farGeo.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
