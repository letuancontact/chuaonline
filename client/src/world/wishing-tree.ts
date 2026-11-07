import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
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
import { GATE } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { seeded } from "./random.ts";

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_WALL_X = 18;

/**
 * Placed OUTSIDE the temple gate (z = GATE_Z + 2.6) right at the far-left end
 * of the left perimeter wall (x = -GATE_WALL_X - 0.5 = -18.5).
 */
export const WISH_TREE_POS = {
  x: -GATE_WALL_X - 0.5,
  z: GATE_Z + 2.6,
} as const;

const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 16;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();
const upVec = new Vector3(0, 1, 0);
const segDir = new Vector3();
const segQuat = new Quaternion();
const segPos = new Vector3();
const segScale = new Vector3(1, 1, 1);
const segMat = new Matrix4();

function paintGeometry(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Deforms a cylinder with natural bark ridges and gnarls (using the exact vertex
 * displacement pattern from `rockGeometry` in `garden.ts`).
 */
function barkCylinder(
  rTop: number,
  rBottom: number,
  height: number,
  radialSegs: number,
  seed: number,
  gnarl = 0.12,
): CylinderGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, radialSegs, 3);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    const flute =
      1 +
      gnarl * Math.sin(angle * 5 + y * 2.2 + seed) +
      gnarl * 0.45 * Math.cos(angle * 3 - y * 3.1 + seed);
    pos.setXYZ(i, x * flute, y, z * flute);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Appends a smooth curved organic limb (trunk, buttress root, sweeping bough, or aerial root)
 * along a 3D quadratic Bézier curve with natural bark fluting.
 */
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
  gnarl = 0.1,
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

    const r0 = rStart + (rEnd - rStart) * Math.pow(t0, 0.85);
    const r1 = rStart + (rEnd - rStart) * Math.pow(t1, 0.85);

    const cyl = barkCylinder(r1, r0, len * 1.12, radialSegs, i * 1.7 + rStart * 10, gnarl);
    segDir.set(dx / len, dy / len, dz / len);
    segQuat.setFromUnitVectors(upVec, segDir);
    segPos.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    segMat.compose(segPos, segQuat, segScale);
    cyl.applyMatrix4(segMat);

    cStep.copy(c0).lerp(c1, (t0 + t1) * 0.5);
    parts.push(paintGeometry(cyl, cStep.getHex()));
  }
}

/** Builds the octagonal stone planter bed and mossy root mound. */
function buildPlanterGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const baseStep = new CylinderGeometry(2.15, 2.25, 0.14, 8);
  baseStep.translate(0, 0.07, 0);
  parts.push(paintGeometry(baseStep, 0x6e695f));

  const curbWall = new CylinderGeometry(1.92, 2.0, 0.32, 8);
  curbWall.translate(0, 0.26, 0);
  parts.push(paintGeometry(curbWall, 0x857f73));

  const topLip = new CylinderGeometry(2.04, 2.04, 0.07, 8);
  topLip.translate(0, 0.44, 0);
  parts.push(paintGeometry(topLip, 0x9c9587));

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * 1.96;
    const pz = Math.sin(a) * 1.96;
    const post = new CylinderGeometry(0.095, 0.11, 0.52, 6);
    post.translate(px, 0.27, pz);
    parts.push(paintGeometry(post, 0x918a7c));

    const cap = new SphereGeometry(0.1, 8, 6);
    cap.scale(1, 0.75, 1);
    cap.translate(px, 0.55, pz);
    parts.push(paintGeometry(cap, 0xa69f90));
  }

  const soil = new CylinderGeometry(1.82, 1.82, 0.36, 16);
  soil.translate(0, 0.2, 0);
  parts.push(paintGeometry(soil, 0x382a1d));

  const moss = new SphereGeometry(1.8, 14, 8);
  moss.scale(1, 0.2, 1);
  moss.translate(0, 0.34, 0);
  parts.push(paintGeometry(moss, 0x3b522c));

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
}

/**
 * Builds the gnarled Bodhi trunk, 8 buttress roots, 6 primary curved boughs,
 * 18 secondary forked branches, and 14 draping aerial roots.
 */
function buildTrunkAndBranches(): { geometry: BufferGeometry; tips: BranchTip[]; hangSpots: BranchTip[] } {
  const parts: BufferGeometry[] = [];
  const tips: BranchTip[] = [];
  const hangSpots: BranchTip[] = [];

  // 1. Massive gnarled main Bodhi trunk with natural S-curve rising well above the 1.75m gate wall
  appendCurvedLimb(parts, [0, 0.26, 0], [0.16, 1.75, -0.1], [-0.08, 3.35, 0.06], 0.68, 0.42, 7, 11, 0x3d3524, 0x543e2c, 0.14);
  appendCurvedLimb(parts, [-0.08, 3.15, 0.06], [0.1, 4.35, -0.06], [0.0, 5.45, 0.0], 0.38, 0.15, 5, 9, 0x543e2c, 0x634a35, 0.1);
  tips.push({ x: 0, y: 5.65, z: 0, r: 1.55 });

  // 2. 8 sinuous surface buttress roots gripping the mossy earth mound
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.18;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const side = i % 2 === 0 ? 0.22 : -0.22;
    appendCurvedLimb(
      parts,
      [ca * 0.38, 1.18, sa * 0.38],
      [ca * 1.05 - sa * side, 0.58, sa * 1.05 + ca * side],
      [ca * 1.68, 0.3, sa * 1.68],
      0.25,
      0.065,
      5,
      8,
      0x443826,
      0x364226,
      0.13,
    );
  }

  // 3. 6 primary sweeping boughs + 18 secondary forked branches
  const mainBoughs = 6;
  for (let i = 0; i < mainBoughs; i++) {
    const a = (i / mainBoughs) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yStart = 2.85 + (i % 3) * 0.18;
    const midR = 1.38;
    const endR = 2.48 + (i % 2) * 0.22;
    const endY = 3.92 + (i % 3) * 0.2;

    const p0: [number, number, number] = [ca * 0.24, yStart, sa * 0.24];
    const p1: [number, number, number] = [ca * midR - sa * 0.24, yStart + 0.72, sa * midR + ca * 0.24];
    const p2: [number, number, number] = [ca * endR, endY, sa * endR];

    appendCurvedLimb(parts, p0, p1, p2, 0.29, 0.12, 6, 9, 0x523c2b, 0x624934, 0.1);
    tips.push({ x: p2[0], y: p2[1] + 0.22, z: p2[2], r: 1.28 });
    tips.push({ x: p1[0] * 0.92, y: p1[1] + 0.88, z: p1[2] * 0.92, r: 1.35 });

    hangSpots.push({ x: p1[0], y: p1[1] - 0.12, z: p1[2], r: 1 });
    hangSpots.push({ x: p2[0] * 0.9, y: p2[1] - 0.2, z: p2[2] * 0.9, r: 1 });

    for (const forkSide of [-1, 1] as const) {
      const fa = a + forkSide * 0.42;
      const fca = Math.cos(fa);
      const fsa = Math.sin(fa);
      const forkLen = 3.05 + (forkSide > 0 ? 0.2 : 0);
      const forkY = endY + 0.24 + (forkSide > 0 ? 0.15 : -0.05);

      const fp0: [number, number, number] = [p1[0], p1[1] + 0.05, p1[2]];
      const fp1: [number, number, number] = [fca * 2.2, endY + 0.16, fsa * 2.2];
      const fp2: [number, number, number] = [fca * forkLen, forkY, fsa * forkLen];

      appendCurvedLimb(parts, fp0, fp1, fp2, 0.16, 0.06, 5, 7, 0x594230, 0x69503a, 0.08);
      tips.push({ x: fp2[0], y: fp2[1] + 0.18, z: fp2[2], r: 1.08 });
      hangSpots.push({ x: fp1[0] * 0.96, y: fp1[1] - 0.22, z: fp1[2] * 0.96, r: 1 });
    }

    const ua = a + 0.52;
    const uca = Math.cos(ua);
    const usa = Math.sin(ua);
    const up0: [number, number, number] = [p1[0] * 0.76, p1[1] + 0.15, p1[2] * 0.76];
    const up1: [number, number, number] = [uca * 1.48, endY + 0.82, usa * 1.48];
    const up2: [number, number, number] = [uca * 1.95, endY + 1.25, usa * 1.95];
    appendCurvedLimb(parts, up0, up1, up2, 0.15, 0.055, 5, 7, 0x594230, 0x6b523b, 0.07);
    tips.push({ x: up2[0], y: up2[1] + 0.2, z: up2[2], r: 1.2 });
  }

  // 4. 14 sacred Bodhi aerial roots (rễ khí sinh) draping down from the main boughs
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.14;
    const r = i % 2 === 0 ? 1.28 : 1.82;
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const topY = i % 2 === 0 ? 3.45 : 3.68;
    const botY = i % 3 === 0 ? 0.42 : 1.75 + (i % 2) * 0.38;
    const drift = (i % 2 === 0 ? 1 : -1) * 0.12;
    appendCurvedLimb(
      parts,
      [rx, topY, rz],
      [rx + drift, (topY + botY) * 0.5, rz - drift],
      [rx * 0.95, botY, rz * 0.95],
      0.028,
      0.012,
      5,
      5,
      0x4e3928,
      0x664f38,
      0.04,
    );
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree trunk & branches");
  return { geometry: merged, tips, hangSpots };
}

/**
 * Ruffled, cloud-like foliage cluster built by displacing a `SphereGeometry` with 3D sine lobes
 * (same proven technique as `rockGeometry` in `garden.ts`), shaded per vertex from deep moss shadow
 * on the underside to sunlit golden-green on the top crown.
 */
function foliagePadGeometry(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  seed: number,
  goldenTip: number,
): BufferGeometry {
  const g = new SphereGeometry(1, 11, 8);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  const deepShadow = new Color(0x1b3820);
  const midJade = new Color(0x336431);
  const sunlitGreen = new Color(0x6e993b);
  const youngGold = new Color(0xb2a83e);
  const cTmp = new Color();

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const lobe =
      1 +
      0.22 * Math.sin(3.6 * x + seed) * Math.cos(3.2 * z + seed * 1.4) +
      0.14 * Math.sin(5.2 * y + 2.4 * x + seed * 2.1);

    const flatY = y < 0 ? y * 0.55 : y;

    const wx = cx + x * rx * lobe;
    const wy = cy + flatY * ry * lobe;
    const wz = cz + z * rz * lobe;
    pos.setXYZ(i, wx, wy, wz);

    const heightNorm = Math.max(0, Math.min(1, (wy - 3.0) / 3.4));
    const localTop = Math.max(0, Math.min(1, (y + 0.65) / 1.6));
    const light = Math.max(0, Math.min(1, localTop * 0.68 + heightNorm * 0.32));

    if (light < 0.46) {
      cTmp.copy(deepShadow).lerp(midJade, light / 0.46);
    } else {
      cTmp.copy(midJade).lerp(sunlitGreen, (light - 0.46) / 0.54);
    }
    if (goldenTip > 0 && light > 0.62) {
      cTmp.lerp(youngGold, goldenTip * (light - 0.62));
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
 * Builds the multi-tiered organic Bodhi foliage canopy out of ruffled leaf pads.
 */
function buildCanopyGeometry(tips: readonly BranchTip[]): BufferGeometry {
  const rand = seeded(0xb0d1);
  const parts: BufferGeometry[] = [];

  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    if (!t) continue;
    const seedBase = i * 3.17 + 1.2;
    const golden = i % 3 === 0 ? 0.48 : 0.15;

    parts.push(foliagePadGeometry(t.x, t.y, t.z, t.r, t.r * 0.54, t.r, seedBase, golden));

    for (let s = 0; s < 2; s++) {
      const sa = rand() * Math.PI * 2;
      const dist = t.r * (0.46 + rand() * 0.26);
      const subR = t.r * (0.62 + rand() * 0.18);
      const dy = (rand() - 0.35) * 0.38;
      parts.push(
        foliagePadGeometry(
          t.x + Math.cos(sa) * dist,
          t.y + dy,
          t.z + Math.sin(sa) * dist,
          subR,
          subR * 0.52,
          subR,
          seedBase + (s + 1) * 4.1,
          s === 0 ? 0.38 : 0.08,
        ),
      );
    }
  }

  parts.push(foliagePadGeometry(0, 5.95, 0, 1.75, 0.92, 1.75, 91.3, 0.45));
  parts.push(foliagePadGeometry(0.72, 5.58, 0.62, 1.38, 0.74, 1.38, 102.7, 0.35));
  parts.push(foliagePadGeometry(-0.74, 5.52, -0.58, 1.38, 0.74, 1.38, 114.1, 0.35));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree canopy");
  return merged;
}

/** Builds 6 warm golden temple lanterns hanging beneath the main boughs. */
function buildTreeLanternsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 6;
  const radius = 2.15;
  const yTop = 3.68;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.28;
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;

    const cord = new CylinderGeometry(0.008, 0.008, 0.32, 5);
    cord.translate(lx, yTop - 0.16, lz);
    parts.push(paintGeometry(cord, 0x3b2818));

    const cap = new CylinderGeometry(0.09, 0.115, 0.04, 8);
    cap.translate(lx, yTop - 0.32, lz);
    parts.push(paintGeometry(cap, 0x4a2e1b));

    const glowCore = new SphereGeometry(0.098, 10, 8);
    glowCore.scale(1, 1.3, 1);
    glowCore.translate(lx, yTop - 0.43, lz);
    parts.push(paintGeometry(glowCore, 0xffdfa0));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree lanterns");
  return merged;
}

/**
 * Builds a 3D Wishing Plaque & Curved Silk Ribbon with origin at (0, 0, 0) (the branch knot).
 */
function buildPlaqueGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const cord = new CylinderGeometry(0.0045, 0.0045, 0.1, 5);
  cord.translate(0, -0.05, 0);
  parts.push(paintGeometry(cord, 0xf2c96d));

  const topCap = new BoxGeometry(0.096, 0.022, 0.018);
  topCap.translate(0, -0.108, 0);
  parts.push(paintGeometry(topCap, 0xe5b142));

  const tablet = new BoxGeometry(0.088, 0.19, 0.014);
  tablet.translate(0, -0.21, 0);
  parts.push(paintGeometry(tablet, 0xc92a1d));

  const slip = new BoxGeometry(0.032, 0.15, 0.017);
  slip.translate(0, -0.21, 0);
  parts.push(paintGeometry(slip, 0xffe28a));

  const botCap = new BoxGeometry(0.09, 0.018, 0.016);
  botCap.translate(0, -0.31, 0);
  parts.push(paintGeometry(botCap, 0xe5b142));

  const segs = 4;
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    const segH = 0.055;
    const yCenter = -0.345 - s * segH;
    const zCurve = Math.sin(t * Math.PI * 1.2) * 0.012;
    const ribbonSeg = new BoxGeometry(0.034 * (1 - t * 0.32), segH + 0.004, 0.004);
    ribbonSeg.rotateX(Math.cos(t * Math.PI) * 0.12);
    ribbonSeg.translate(0, yCenter, zCurve);
    parts.push(paintGeometry(ribbonSeg, s % 2 === 0 ? 0xe03526 : 0xf24835));
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
        float swayWeight = clamp((transformed.y - 2.6) * 0.32, 0.0, 1.0);
        float leafPhase = transformed.x * 0.9 + transformed.z * 0.8 + transformed.y * 0.6;
        float leafSway = swayWeight * (0.052 * sin(uTime * 1.65 + leafPhase) + 0.024 * cos(uTime * 2.9 - leafPhase * 1.3));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.25;
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
      px = anchor.x + (rand() - 0.5) * 0.26;
      py = anchor.y + (rand() - 0.5) * 0.14;
      pz = anchor.z + (rand() - 0.5) * 0.26;
    } else {
      const r = 1.65 + (i % 3) * 0.42 + (rand() - 0.5) * 0.22;
      px = Math.cos(jitterAngle) * r;
      pz = Math.sin(jitterAngle) * r;
      py = 2.95 + (i % 3) * 0.24 + (rand() - 0.5) * 0.16;
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
      scale: 0.96 + rand() * 0.24,
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
    position: [WISH_TREE_POS.x + 5.8, 3.2, WISH_TREE_POS.z - 6.8],
    target: [WISH_TREE_POS.x, 3.0, WISH_TREE_POS.z],
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
