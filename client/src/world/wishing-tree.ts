import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOUNDARY, GATE_Z, HALL, LANTERN_LOOP, PATH, PROP_COLLIDERS, ROOF, STEPS } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { seeded } from "./random.ts";

const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 14;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(ax + t * dx - x, az + t * dz - z);
}

/**
 * Computes the exact outer-left courtyard position just inside the left perimeter wall
 * near the front-left corner, guaranteed clear of the Hall, paths, and garden props.
 */
function resolveWishTreePos(): { x: number; z: number } {
  let bestX = BOUNDARY.x - BOUNDARY.rx * 0.72;
  let bestZ = Math.min(GATE_Z - 5.5, STEPS.zMax + 3.5);
  let bestScore = -Infinity;

  const zStart = GATE_Z - 4.2;
  const zEnd = HALL.zMin;

  for (let cz = zStart; cz >= zEnd; cz -= 0.8) {
    const bv = (cz - BOUNDARY.z) / BOUNDARY.rz;
    if (Math.abs(bv) >= 0.94) continue;
    const xWallLeft = BOUNDARY.x - BOUNDARY.rx * Math.sqrt(1 - bv * bv);

    for (const wallInset of [4.2, 4.8, 5.5, 6.2]) {
      const cx = xWallLeft + wallInset;

      // 1. Must stay well outside the Hall roof and front steps.
      if (cx > ROOF.xMin - 4.2 && cx < ROOF.xMax + 4.2 && cz > HALL.zMin - 4.0 && cz < STEPS.zMax + 3.2) {
        continue;
      }

      // 2. Must stay clear of the main central entrance path.
      if (Math.abs(cx - PATH.from.x) < PATH.width * 0.5 + 3.4) {
        continue;
      }

      // 3. Measure clearance to the lantern loop path and existing tree/rock colliders.
      let minClearance = 99;
      const pts = LANTERN_LOOP.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        const d = distToSegment(cx, cz, a.x, a.z, b.x, b.z) - LANTERN_LOOP.width * 0.5;
        if (d < minClearance) minClearance = d;
      }
      for (const c of PROP_COLLIDERS) {
        const d = Math.hypot(cx - c.x, cz - c.z) - c.r;
        if (d < minClearance) minClearance = d;
      }

      if (minClearance < 2.6) continue;

      // Prefer outer-left spots closer to the front-left end of the wall with comfortable clearance.
      const forwardBonus = (cz - HALL.zMax) * 0.35;
      const wallProximityBonus = (6.5 - wallInset) * 0.4;
      const score = Math.min(minClearance, 4.2) + forwardBonus + wallProximityBonus;

      if (score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestZ = cz;
      }
    }
  }

  return { x: bestX, z: bestZ };
}

export const WISH_TREE_POS = resolveWishTreePos();

function paintGeometry(g: BufferGeometry, hex: number, swayWeight = 0): BufferGeometry {
  const pos = g.getAttribute("position");
  const count = pos.count;
  const c = new Color(hex);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = swayWeight;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Generates an organic, gnarled 3D branch/trunk tube along a quadratic 3D Bézier curve
 * with natural bark fluting, smooth tapering, and a vertical color gradient.
 */
function buildCurvedTube(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  rStart: number,
  rEnd: number,
  lengthSegs: number,
  radialSegs: number,
  colorStart: number,
  colorEnd: number,
  fluteAmp = 0.08,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const c0 = new Color(colorStart);
  const c1 = new Color(colorEnd);
  const cTmp = new Color();

  for (let i = 0; i <= lengthSegs; i++) {
    const t = i / lengthSegs;
    const inv = 1 - t;

    // Point on quadratic Bézier curve
    const cx = inv * inv * p0[0] + 2 * inv * t * p1[0] + t * t * p2[0];
    const cy = inv * inv * p0[1] + 2 * inv * t * p1[1] + t * t * p2[1];
    const cz = inv * inv * p0[2] + 2 * inv * t * p1[2] + t * t * p2[2];

    // Curve tangent
    let tx = 2 * inv * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    let ty = 2 * inv * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    let tz = 2 * inv * (p1[2] - p0[2]) + 2 * t * (p2[2] - p1[2]);
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;

    // Orthonormal frame (N, B) around tangent T
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(ty) > 0.92) {
      ux = 1;
      uy = 0;
    }
    let nx = ty * uz - tz * uy;
    let ny = tz * ux - tx * uz;
    let nz = tx * uy - ty * ux;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;

    const baseR = rStart + (rEnd - rStart) * Math.pow(t, 0.85);
    cTmp.copy(c0).lerp(c1, t);

    for (let j = 0; j < radialSegs; j++) {
      const a = (j / radialSegs) * Math.PI * 2;
      const flute = 1 + fluteAmp * (1 - 0.65 * t) * Math.sin(a * 5 + t * 4.5);
      const r = baseR * flute;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const vx = cx + (nx * cos + bx * sin) * r;
      const vy = cy + (ny * cos + by * sin) * r;
      const vz = cz + (nz * cos + bz * sin) * r;

      positions.push(vx, vy, vz);
      colors.push(cTmp.r, cTmp.g, cTmp.b);
      uvs.push(j / radialSegs, t * 0.15);
    }
  }

  for (let i = 0; i < lengthSegs; i++) {
    const rowA = i * radialSegs;
    const rowB = (i + 1) * radialSegs;
    for (let j = 0; j < radialSegs; j++) {
      const nextJ = (j + 1) % radialSegs;
      indices.push(rowA + j, rowB + j, rowB + nextJ);
      indices.push(rowA + j, rowB + nextJ, rowA + nextJ);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const nonIndexed = geo.toNonIndexed();
  geo.dispose();
  return nonIndexed;
}

/** Builds the two-tiered octagonal stone planter bed and mossy earth mound. */
function buildPlanterGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const baseStep = new CylinderGeometry(2.72, 2.82, 0.14, 8);
  baseStep.translate(0, 0.07, 0);
  parts.push(paintGeometry(baseStep.toNonIndexed(), 0x6e695f));

  const curbWall = new CylinderGeometry(2.42, 2.52, 0.34, 8);
  curbWall.translate(0, 0.28, 0);
  parts.push(paintGeometry(curbWall.toNonIndexed(), 0x857f73));

  const topLip = new CylinderGeometry(2.56, 2.56, 0.07, 8);
  topLip.translate(0, 0.46, 0);
  parts.push(paintGeometry(topLip.toNonIndexed(), 0x9c9587));

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * 2.46;
    const pz = Math.sin(a) * 2.46;
    const post = new CylinderGeometry(0.11, 0.13, 0.56, 6);
    post.translate(px, 0.29, pz);
    parts.push(paintGeometry(post.toNonIndexed(), 0x918a7c));

    const cap = new SphereGeometry(0.11, 8, 6);
    cap.scale(1, 0.75, 1);
    cap.translate(px, 0.59, pz);
    parts.push(paintGeometry(cap.toNonIndexed(), 0xa69f90));
  }

  const soil = new CylinderGeometry(2.3, 2.3, 0.38, 16);
  soil.translate(0, 0.22, 0);
  parts.push(paintGeometry(soil.toNonIndexed(), 0x382a1d));

  const moss = new SphereGeometry(2.26, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.46);
  moss.scale(1, 0.22, 1);
  moss.translate(0, 0.36, 0);
  parts.push(paintGeometry(moss.toNonIndexed(), 0x3b522c));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree planter");
  return merged;
}

interface BranchTip {
  x: number;
  y: number;
  z: number;
  r: number;
  isOuter: boolean;
}

/**
 * Builds the ancient Bodhi trunk, 8 gnarled buttress roots, 6 primary boughs,
 * 18 secondary forked branches, and 12 hanging aerial roots.
 */
function buildTrunkAndBranches(): { geometry: BufferGeometry; tips: BranchTip[]; hangSpots: BranchTip[] } {
  const parts: BufferGeometry[] = [];
  const tips: BranchTip[] = [];
  const hangSpots: BranchTip[] = [];

  // 1. Massive gnarled main trunk with subtle S-curve and mossy base
  parts.push(
    buildCurvedTube(
      [0, 0.32, 0],
      [0.14, 1.55, -0.08],
      [-0.06, 2.85, 0.05],
      0.74,
      0.44,
      10,
      12,
      0x3d3524,
      0x543e2c,
      0.14,
    ),
  );

  // Central crown leader rising into the upper canopy
  parts.push(
    buildCurvedTube(
      [-0.06, 2.7, 0.05],
      [0.08, 3.65, -0.06],
      [0.0, 4.55, 0.0],
      0.4,
      0.16,
      7,
      9,
      0x543e2c,
      0x634a35,
      0.08,
    ),
  );
  tips.push({ x: 0, y: 4.75, z: 0, r: 1.55, isOuter: false });

  // 2. 8 sinuous surface buttress roots gripping the mossy mound
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.18;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const side = i % 2 === 0 ? 0.22 : -0.22;
    parts.push(
      buildCurvedTube(
        [ca * 0.42, 1.15, sa * 0.42],
        [ca * 1.18 - sa * side, 0.62, sa * 1.18 + ca * side],
        [ca * 2.05, 0.34, sa * 2.05],
        0.26,
        0.07,
        7,
        8,
        0x443826,
        0x364226,
        0.12,
      ),
    );
  }

  // 3. 6 primary sweeping boughs + 3 forked secondary branches per bough
  const mainBoughs = 6;
  for (let i = 0; i < mainBoughs; i++) {
    const a = (i / mainBoughs) * Math.PI * 2 + 0.25;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yStart = 2.38 + (i % 3) * 0.16;
    const midR = 1.45;
    const endR = 2.65 + (i % 2) * 0.22;
    const endY = 3.35 + (i % 3) * 0.18;

    const p0: [number, number, number] = [ca * 0.25, yStart, sa * 0.25];
    const p1: [number, number, number] = [ca * midR - sa * 0.25, yStart + 0.68, sa * midR + ca * 0.25];
    const p2: [number, number, number] = [ca * endR, endY, sa * endR];

    parts.push(buildCurvedTube(p0, p1, p2, 0.3, 0.13, 8, 9, 0x523c2b, 0x624934, 0.09));
    tips.push({ x: p2[0], y: p2[1] + 0.25, z: p2[2], r: 1.32, isOuter: true });
    tips.push({ x: p1[0] * 0.9, y: p1[1] + 0.85, z: p1[2] * 0.9, r: 1.42, isOuter: false });

    hangSpots.push({ x: p1[0], y: p1[1] - 0.12, z: p1[2], r: 1, isOuter: false });
    hangSpots.push({ x: p2[0] * 0.88, y: p2[1] - 0.22, z: p2[2] * 0.88, r: 1, isOuter: true });

    for (const forkSide of [-1, 1] as const) {
      const fa = a + forkSide * 0.42;
      const fca = Math.cos(fa);
      const fsa = Math.sin(fa);
      const forkLen = 3.25 + (forkSide > 0 ? 0.18 : 0);
      const forkY = endY + 0.22 + (forkSide > 0 ? 0.14 : -0.06);

      const fp0: [number, number, number] = [p1[0], p1[1] + 0.05, p1[2]];
      const fp1: [number, number, number] = [fca * 2.35, endY + 0.15, fsa * 2.35];
      const fp2: [number, number, number] = [fca * forkLen, forkY, fsa * forkLen];

      parts.push(buildCurvedTube(fp0, fp1, fp2, 0.16, 0.065, 6, 7, 0x594230, 0x69503a, 0.06));
      tips.push({ x: fp2[0], y: fp2[1] + 0.18, z: fp2[2], r: 1.12, isOuter: true });
      hangSpots.push({ x: fp1[0] * 0.96, y: fp1[1] - 0.25, z: fp1[2] * 0.96, r: 1, isOuter: true });
    }

    const ua = a + 0.52;
    const uca = Math.cos(ua);
    const usa = Math.sin(ua);
    const up0: [number, number, number] = [p1[0] * 0.75, p1[1] + 0.15, p1[2] * 0.75];
    const up1: [number, number, number] = [uca * 1.55, endY + 0.75, usa * 1.55];
    const up2: [number, number, number] = [uca * 2.05, endY + 1.15, usa * 2.05];
    parts.push(buildCurvedTube(up0, up1, up2, 0.15, 0.06, 6, 7, 0x594230, 0x6b523b, 0.05));
    tips.push({ x: up2[0], y: up2[1] + 0.2, z: up2[2], r: 1.25, isOuter: false });
  }

  // 4. 12 sacred Bodhi aerial roots draping down from the boughs
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.14;
    const r = i % 2 === 0 ? 1.38 : 1.92;
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const topY = i % 2 === 0 ? 2.95 : 3.15;
    const botY = i % 3 === 0 ? 0.42 : 1.45 + (i % 2) * 0.35;
    const drift = (i % 2 === 0 ? 1 : -1) * 0.12;
    parts.push(
      buildCurvedTube(
        [rx, topY, rz],
        [rx + drift, (topY + botY) * 0.5, rz - drift],
        [rx * 0.96, botY, rz * 0.96],
        0.028,
        0.012,
        6,
        5,
        0x4e3928,
        0x664f38,
        0.02,
      ),
    );
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree trunk & branches");
  return { geometry: merged, tips, hangSpots };
}

/**
 * Builds an organic, multi-layered cloud-like Bodhi foliage canopy (64 ruffled leaf clusters)
 * with realistic interior ambient-occlusion shading, sunlit golden-green crown tips, and wind-sway UVs.
 */
function buildCanopyGeometry(tips: readonly BranchTip[]): BufferGeometry {
  const rand = seeded(0xb0d1);
  const parts: BufferGeometry[] = [];

  const deepShadowColor = new Color(0x1b3620);
  const midJadeColor = new Color(0x346332);
  const sunlitTipColor = new Color(0x7ca13c);
  const goldenLeafColor = new Color(0xb5a83e);
  const cTmp = new Color();

  const addFoliageCluster = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, goldenMix: number): void => {
    const g = new IcosahedronGeometry(1, 2);
    const pos = g.getAttribute("position");
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    const phaseA = rand() * Math.PI * 2;
    const phaseB = rand() * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);

      const lobe =
        1 +
        0.22 * Math.sin(vx * 4.2 + phaseA) * Math.cos(vz * 4.2 + phaseB) +
        0.12 * Math.sin(vy * 6.0 + vx * 3.0);

      const flatVy = vy < 0 ? vy * 0.58 : vy;

      const wx = cx + vx * rx * lobe;
      const wy = cy + flatVy * ry * lobe;
      const wz = cz + vz * rz * lobe;
      pos.setXYZ(i, wx, wy, wz);

      const heightNorm = Math.max(0, Math.min(1, (wy - 2.6) / 3.1));
      const localTop = Math.max(0, Math.min(1, (vy + 0.7) / 1.65));
      const lightFactor = Math.max(0, Math.min(1, localTop * 0.68 + heightNorm * 0.32));

      if (lightFactor < 0.48) {
        cTmp.copy(deepShadowColor).lerp(midJadeColor, lightFactor / 0.48);
      } else {
        cTmp.copy(midJadeColor).lerp(sunlitTipColor, (lightFactor - 0.48) / 0.52);
      }
      if (goldenMix > 0 && lightFactor > 0.62) {
        cTmp.lerp(goldenLeafColor, goldenMix * (lightFactor - 0.62));
      }

      colors[i * 3] = cTmp.r;
      colors[i * 3 + 1] = cTmp.g;
      colors[i * 3 + 2] = cTmp.b;

      const radialDist = Math.hypot(wx, wz);
      const swayWeight = Math.min(1, 0.35 + (radialDist / 4.2) * 0.45 + localTop * 0.2);
      uvs[i * 2] = (wx + wz) * 0.4;
      uvs[i * 2 + 1] = swayWeight;
    }

    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    parts.push(g);
  };

  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    if (!t) continue;
    const golden = i % 4 === 0 ? 0.45 : 0.12;
    addFoliageCluster(t.x, t.y, t.z, t.r, t.r * 0.54, t.r, golden);

    for (let s = 0; s < 2; s++) {
      const sa = rand() * Math.PI * 2;
      const dist = t.r * (0.48 + rand() * 0.28);
      const subR = t.r * (0.62 + rand() * 0.18);
      const dy = (rand() - 0.35) * 0.42;
      addFoliageCluster(
        t.x + Math.cos(sa) * dist,
        t.y + dy,
        t.z + Math.sin(sa) * dist,
        subR,
        subR * 0.52,
        subR,
        s === 0 ? 0.35 : 0,
      );
    }
  }

  addFoliageCluster(0, 5.15, 0, 1.85, 0.95, 1.85, 0.4);
  addFoliageCluster(0.75, 4.85, 0.65, 1.45, 0.78, 1.45, 0.3);
  addFoliageCluster(-0.78, 4.8, -0.6, 1.45, 0.78, 1.45, 0.3);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree canopy");
  return merged;
}

/** Builds 6 warm golden temple lanterns hanging beneath the main boughs. */
function buildTreeLanternsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 6;
  const radius = 2.35;
  const yTop = 3.12;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.25;
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;

    const cord = new CylinderGeometry(0.008, 0.008, 0.32, 5);
    cord.translate(lx, yTop - 0.16, lz);
    parts.push(paintGeometry(cord.toNonIndexed(), 0x3b2818));

    const cap = new CylinderGeometry(0.09, 0.115, 0.04, 8);
    cap.translate(lx, yTop - 0.32, lz);
    parts.push(paintGeometry(cap.toNonIndexed(), 0x4a2e1b));

    const glowCore = new SphereGeometry(0.098, 10, 8);
    glowCore.scale(1, 1.3, 1);
    glowCore.translate(lx, yTop - 0.43, lz);
    parts.push(paintGeometry(glowCore.toNonIndexed(), 0xffdfa0));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree lanterns");
  return merged;
}

/**
 * Builds a refined 3D Wishing Plaque & Curved Silk Ribbon with origin at (0, 0, 0) (the branch knot)
 * and `uv.y` increasing downward so the silk ribbon tail ripples in the breeze.
 */
function buildPlaqueGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const cord = new CylinderGeometry(0.0045, 0.0045, 0.1, 5);
  cord.translate(0, -0.05, 0);
  parts.push(paintGeometry(cord.toNonIndexed(), 0xf2c96d, 0.1));

  const topCap = new BoxGeometry(0.096, 0.022, 0.018);
  topCap.translate(0, -0.108, 0);
  parts.push(paintGeometry(topCap.toNonIndexed(), 0xe5b142, 0.2));

  const tablet = new BoxGeometry(0.088, 0.19, 0.014);
  tablet.translate(0, -0.21, 0);
  parts.push(paintGeometry(tablet.toNonIndexed(), 0xc92a1d, 0.35));

  const slip = new BoxGeometry(0.032, 0.15, 0.017);
  slip.translate(0, -0.21, 0);
  parts.push(paintGeometry(slip.toNonIndexed(), 0xffe28a, 0.35));

  const botCap = new BoxGeometry(0.09, 0.018, 0.016);
  botCap.translate(0, -0.31, 0);
  parts.push(paintGeometry(botCap.toNonIndexed(), 0xe5b142, 0.45));

  const segs = 4;
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    const segH = 0.055;
    const yCenter = -0.345 - s * segH;
    const zCurve = Math.sin(t * Math.PI * 1.2) * 0.012;
    const ribbonSeg = new BoxGeometry(0.034 * (1 - t * 0.32), segH + 0.004, 0.004);
    ribbonSeg.rotateX(Math.cos(t * Math.PI) * 0.12);
    ribbonSeg.translate(0, yCenter, zCurve);
    parts.push(paintGeometry(ribbonSeg.toNonIndexed(), s % 2 === 0 ? 0xe03526 : 0xf24835, 0.6 + t * 0.4));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing plaque");
  return merged;
}

interface PlaqueState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  baseYaw: number;
  phase: number;
  freq: number;
  scale: number;
  impulse: number;
}

export interface WishingTree {
  /** Activates a new red-and-gold wishing plaque on the Bodhi tree with a celebratory breeze swing. */
  hangWish(): void;
  update(t: number, daylight: number): void;
  dispose(): void;
}

export function createWishingTree(parent: Object3D): WishingTree {
  const rand = seeded(0xb0de);
  const uTime = { value: 0 };

  const root = new Group();
  root.position.set(WISH_TREE_POS.x, 0, WISH_TREE_POS.z);
  root.name = "wishing-tree";

  const planterGeo = buildPlanterGeometry();
  const planterMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  const planterMesh = new Mesh(planterGeo, planterMat);
  planterMesh.receiveShadow = true;
  planterMesh.castShadow = true;

  const { geometry: trunkGeo, tips, hangSpots } = buildTrunkAndBranches();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 });
  const trunkMesh = new Mesh(trunkGeo, trunkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;

  const canopyGeo = buildCanopyGeometry(tips);
  const canopyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.02 });
  canopyMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float leafPhase = uv.x + transformed.x * 0.7 + transformed.z * 0.5;
        float leafSway = uv.y * (0.048 * sin(uTime * 1.65 + leafPhase) + 0.022 * cos(uTime * 2.9 - leafPhase * 1.4));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.28;
        transformed.z += leafSway * 0.65;`,
      );
  };
  const canopyMesh = new Mesh(canopyGeo, canopyMat);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;

  const lanternGeo = buildTreeLanternsGeometry();
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    emissive: new Color(0xffa438),
    emissiveIntensity: 0.75,
  });
  const lanternMesh = new Mesh(lanternGeo, lanternMat);

  const plaqueGeo = buildPlaqueGeometry();
  const plaqueMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.12,
    emissive: new Color(0x8a1c10),
    emissiveIntensity: 0.28,
  });
  const plaqueMesh = new InstancedMesh(plaqueGeo, plaqueMat, MAX_PLAQUES);
  plaqueMesh.frustumCulled = false;
  plaqueMesh.castShadow = true;
  plaqueMesh.name = "wishing-plaques";

  const plaques: PlaqueState[] = Array.from({ length: MAX_PLAQUES }, (_, i) => {
    const anchor = hangSpots[i % hangSpots.length];
    const jitterAngle = (i / MAX_PLAQUES) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    let px: number;
    let py: number;
    let pz: number;
    if (anchor && i < hangSpots.length) {
      px = anchor.x + (rand() - 0.5) * 0.28;
      py = anchor.y + (rand() - 0.5) * 0.14;
      pz = anchor.z + (rand() - 0.5) * 0.28;
    } else {
      const r = 1.85 + (i % 3) * 0.48 + (rand() - 0.5) * 0.24;
      px = Math.cos(jitterAngle) * r;
      pz = Math.sin(jitterAngle) * r;
      py = 2.45 + (i % 3) * 0.24 + (rand() - 0.5) * 0.16;
    }
    const radialAngle = Math.atan2(pz, px);
    return {
      active: i < INITIAL_PLAQUES,
      x: px,
      y: py,
      z: pz,
      baseYaw: -radialAngle + Math.PI * 0.5 + (rand() - 0.5) * 0.45,
      phase: rand() * Math.PI * 2,
      freq: 1.55 + rand() * 0.7,
      scale: 0.94 + rand() * 0.24,
      impulse: 0,
    };
  });

  let nextSlot = INITIAL_PLAQUES % MAX_PLAQUES;
  let lastT = 0;

  const updatePlaques = (t: number, dt: number): void => {
    for (let i = 0; i < MAX_PLAQUES; i++) {
      const p = plaques[i];
      if (!p) continue;
      if (!p.active) {
        plaqueMesh.setMatrixAt(i, m4.compose(v3.set(0, -2, 0), q.identity(), s3.setScalar(0)));
        continue;
      }
      if (p.impulse > 0) {
        p.impulse = Math.max(0, p.impulse - dt * 0.45);
      }
      const breeze = 0.12 + p.impulse * 0.35;
      const pitch = Math.sin(t * p.freq + p.phase) * breeze;
      const roll = Math.cos(t * (p.freq * 0.78) + p.phase * 1.3) * (breeze * 0.68);
      const yaw = p.baseYaw + Math.sin(t * 0.9 + p.phase) * (0.16 + p.impulse * 0.22);

      tmpEuler.set(pitch, yaw, roll, "YXZ");
      q.setFromEuler(tmpEuler);
      const sc = p.scale * (1 + p.impulse * 0.16);
      plaqueMesh.setMatrixAt(i, m4.compose(v3.set(p.x, p.y, p.z), q, s3.setScalar(sc)));
    }
    plaqueMesh.instanceMatrix.needsUpdate = true;
  };

  updatePlaques(0, 0);

  for (const m of [planterMesh, trunkMesh, canopyMesh, lanternMesh]) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }
  root.add(planterMesh, trunkMesh, canopyMesh, lanternMesh, plaqueMesh);
  parent.add(root);

  registerCameraPreset("wishtree", {
    position: [WISH_TREE_POS.x + 6.5, 3.0, WISH_TREE_POS.z + 6.8],
    target: [WISH_TREE_POS.x, 2.5, WISH_TREE_POS.z],
  });

  return {
    hangWish() {
      const p = plaques[nextSlot];
      if (p) {
        p.active = true;
        p.impulse = 1.0;
      }
      nextSlot = (nextSlot + 1) % MAX_PLAQUES;
      updatePlaques(lastT, 0);
    },
    update(t, daylight) {
      const dt = Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      uTime.value = t;
      const night = Math.max(0, Math.min(1, 1 - daylight));
      lanternMat.emissiveIntensity = 0.65 + night * 1.55 + 0.1 * Math.sin(t * 2.8);
      plaqueMat.emissiveIntensity = 0.22 + night * 0.48;
      updatePlaques(t, dt);
    },
    dispose() {
      parent.remove(root);
      plaqueMesh.dispose();
      for (const g of [planterGeo, trunkGeo, canopyGeo, lanternGeo, plaqueGeo]) g.dispose();
      for (const m of [planterMat, trunkMat, canopyMat, lanternMat, plaqueMat]) m.dispose();
    },
  };
}
