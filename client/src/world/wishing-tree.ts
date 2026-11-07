import {
  BoxGeometry,
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
  type BufferGeometry,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOUNDARY, GATE_Z, ROOF } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { seeded } from "./random.ts";

/**
 * Placed OUTSIDE the temple gate (z = GATE_Z + 3.2) at the far-left end of the left perimeter wall.
 */
export const WISH_TREE_POS = {
  x: Math.min(ROOF.xMin - 6.5, BOUNDARY.x - BOUNDARY.rx * 0.68),
  z: GATE_Z + 3.2,
} as const;

const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 14;

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
  const count = g.getAttribute("position").count;
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
 * Appends a smooth curved organic limb (trunk, root, bough, or aerial root) along a 3D quadratic
 * Bézier curve by chaining tapered cylinder segments with overlapped joints.
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

    const cyl = new CylinderGeometry(r1, r0, len * 1.08, radialSegs, 1);
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

  const baseStep = new CylinderGeometry(1.52, 1.58, 0.12, 8);
  baseStep.translate(0, 0.06, 0);
  parts.push(paintGeometry(baseStep, 0x6e695f));

  const curbWall = new CylinderGeometry(1.34, 1.4, 0.28, 8);
  curbWall.translate(0, 0.24, 0);
  parts.push(paintGeometry(curbWall, 0x857f73));

  const topLip = new CylinderGeometry(1.44, 1.44, 0.06, 8);
  topLip.translate(0, 0.39, 0);
  parts.push(paintGeometry(topLip, 0x9c9587));

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * 1.38;
    const pz = Math.sin(a) * 1.38;
    const post = new CylinderGeometry(0.08, 0.095, 0.46, 6);
    post.translate(px, 0.24, pz);
    parts.push(paintGeometry(post, 0x918a7c));

    const cap = new SphereGeometry(0.085, 8, 6);
    cap.scale(1, 0.75, 1);
    cap.translate(px, 0.49, pz);
    parts.push(paintGeometry(cap, 0xa69f90));
  }

  const soil = new CylinderGeometry(1.26, 1.26, 0.32, 16);
  soil.translate(0, 0.18, 0);
  parts.push(paintGeometry(soil, 0x382a1d));

  const moss = new SphereGeometry(1.24, 14, 8);
  moss.scale(1, 0.18, 1);
  moss.translate(0, 0.31, 0);
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
 * 18 secondary forked branches, and 12 draping aerial roots.
 */
function buildTrunkAndBranches(): { geometry: BufferGeometry; tips: BranchTip[]; hangSpots: BranchTip[] } {
  const parts: BufferGeometry[] = [];
  const tips: BranchTip[] = [];
  const hangSpots: BranchTip[] = [];

  // 1. Gnarled main Bodhi trunk with natural S-curve
  appendCurvedLimb(parts, [0, 0.22, 0], [0.12, 1.45, -0.08], [-0.06, 2.75, 0.05], 0.52, 0.32, 6, 10, 0x3d3524, 0x543e2c);
  appendCurvedLimb(parts, [-0.06, 2.6, 0.05], [0.07, 3.5, -0.05], [0.0, 4.35, 0.0], 0.3, 0.12, 5, 8, 0x543e2c, 0x634a35);
  tips.push({ x: 0, y: 4.5, z: 0, r: 1.15 });

  // 2. 8 sinuous surface buttress roots gripping the mossy earth mound
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.18;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const side = i % 2 === 0 ? 0.16 : -0.16;
    appendCurvedLimb(
      parts,
      [ca * 0.3, 1.02, sa * 0.3],
      [ca * 0.74 - sa * side, 0.52, sa * 0.74 + ca * side],
      [ca * 1.16, 0.26, sa * 1.16],
      0.19,
      0.055,
      4,
      7,
      0x443826,
      0x364226,
    );
  }

  // 3. 6 primary sweeping boughs + 18 secondary forked branches
  const mainBoughs = 6;
  for (let i = 0; i < mainBoughs; i++) {
    const a = (i / mainBoughs) * Math.PI * 2 + 0.25;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yStart = 2.34 + (i % 3) * 0.14;
    const midR = 0.98;
    const endR = 1.72 + (i % 2) * 0.16;
    const endY = 3.22 + (i % 3) * 0.15;

    const p0: [number, number, number] = [ca * 0.18, yStart, sa * 0.18];
    const p1: [number, number, number] = [ca * midR - sa * 0.18, yStart + 0.58, sa * midR + ca * 0.18];
    const p2: [number, number, number] = [ca * endR, endY, sa * endR];

    appendCurvedLimb(parts, p0, p1, p2, 0.22, 0.095, 5, 8, 0x523c2b, 0x624934);
    tips.push({ x: p2[0], y: p2[1] + 0.18, z: p2[2], r: 0.92 });
    tips.push({ x: p1[0] * 0.9, y: p1[1] + 0.72, z: p1[2] * 0.9, r: 0.98 });

    hangSpots.push({ x: p1[0], y: p1[1] - 0.1, z: p1[2], r: 1 });
    hangSpots.push({ x: p2[0] * 0.9, y: p2[1] - 0.18, z: p2[2] * 0.9, r: 1 });

    for (const forkSide of [-1, 1] as const) {
      const fa = a + forkSide * 0.42;
      const fca = Math.cos(fa);
      const fsa = Math.sin(fa);
      const forkLen = 2.05 + (forkSide > 0 ? 0.14 : 0);
      const forkY = endY + 0.2 + (forkSide > 0 ? 0.12 : -0.04);

      const fp0: [number, number, number] = [p1[0], p1[1] + 0.04, p1[2]];
      const fp1: [number, number, number] = [fca * 1.5, endY + 0.14, fsa * 1.5];
      const fp2: [number, number, number] = [fca * forkLen, forkY, fsa * forkLen];

      appendCurvedLimb(parts, fp0, fp1, fp2, 0.12, 0.05, 4, 6, 0x594230, 0x69503a);
      tips.push({ x: fp2[0], y: fp2[1] + 0.14, z: fp2[2], r: 0.8 });
      hangSpots.push({ x: fp1[0] * 0.98, y: fp1[1] - 0.2, z: fp1[2] * 0.98, r: 1 });
    }

    const ua = a + 0.52;
    const uca = Math.cos(ua);
    const usa = Math.sin(ua);
    const up0: [number, number, number] = [p1[0] * 0.75, p1[1] + 0.12, p1[2] * 0.75];
    const up1: [number, number, number] = [uca * 1.05, endY + 0.65, usa * 1.05];
    const up2: [number, number, number] = [uca * 1.38, endY + 0.98, usa * 1.38];
    appendCurvedLimb(parts, up0, up1, up2, 0.11, 0.045, 4, 6, 0x594230, 0x6b523b);
    tips.push({ x: up2[0], y: up2[1] + 0.16, z: up2[2], r: 0.88 });
  }

  // 4. 12 sacred Bodhi aerial roots draping down from the main boughs
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.14;
    const r = i % 2 === 0 ? 0.88 : 1.24;
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const topY = i % 2 === 0 ? 2.84 : 3.02;
    const botY = i % 3 === 0 ? 0.36 : 1.38 + (i % 2) * 0.32;
    const drift = (i % 2 === 0 ? 1 : -1) * 0.08;
    appendCurvedLimb(
      parts,
      [rx, topY, rz],
      [rx + drift, (topY + botY) * 0.5, rz - drift],
      [rx * 0.95, botY, rz * 0.95],
      0.022,
      0.01,
      4,
      5,
      0x4e3928,
      0x664f38,
    );
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree trunk & branches");
  return { geometry: merged, tips, hangSpots };
}

const FOLIAGE_SHADES = [
  0x1f4023, // Deep shaded underside foliage
  0x29522b, // Rich forest green
  0x346432, // Sacred Bodhi jade green
  0x427637, // Mid-canopy leaf green
  0x55883b, // Sunlit upper canopy green
  0x729c3e, // Warm chartreuse-green leaf tips
  0x9ab042, // Golden-green young Bodhi shoots
] as const;

/**
 * Builds an organic, multi-layered Bodhi canopy out of 108 tilted, layered leaf pads
 * shaded from deep moss-green underneath to sunlit golden-green at the crown.
 */
function buildCanopyGeometry(tips: readonly BranchTip[]): BufferGeometry {
  const rand = seeded(0xb0d1);
  const parts: BufferGeometry[] = [];

  const addLeafPad = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, colorHex: number): void => {
    const pad = new SphereGeometry(1, 9, 7);
    pad.scale(rx, ry, rz);
    pad.rotateX((rand() - 0.5) * 0.36);
    pad.rotateZ((rand() - 0.5) * 0.36);
    pad.rotateY(rand() * Math.PI * 2);
    pad.translate(cx, cy, cz);
    parts.push(paintGeometry(pad, colorHex));
  };

  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    if (!t) continue;

    // 1. Shaded underside pad
    addLeafPad(t.x, t.y - 0.14, t.z, t.r * 0.92, t.r * 0.34, t.r * 0.96, FOLIAGE_SHADES[1]);
    // 2. Main middle leaf pad
    addLeafPad(t.x, t.y + 0.04, t.z, t.r * 0.98, t.r * 0.42, t.r * 0.92, FOLIAGE_SHADES[3]);
    // 3. Sunlit upper crown pad
    const topShade = FOLIAGE_SHADES[4 + (i % 3)] ?? 0x55883b;
    addLeafPad(t.x, t.y + 0.22, t.z, t.r * 0.76, t.r * 0.35, t.r * 0.78, topShade);

    // 4. Two organic satellite leaf clusters around each branch tip
    for (let s = 0; s < 2; s++) {
      const sa = rand() * Math.PI * 2;
      const dist = t.r * (0.48 + rand() * 0.26);
      const subR = t.r * (0.56 + rand() * 0.2);
      const dy = (rand() - 0.35) * 0.28;
      const shadeIdx = Math.min(FOLIAGE_SHADES.length - 1, Math.max(0, Math.floor(((t.y + dy - 2.6) / 2.2) * 5) + s));
      addLeafPad(
        t.x + Math.cos(sa) * dist,
        t.y + dy,
        t.z + Math.sin(sa) * dist,
        subR,
        subR * 0.4,
        subR * 0.92,
        FOLIAGE_SHADES[shadeIdx] ?? 0x427637,
      );
    }
  }

  // Crown dome clusters at the top of the tree
  addLeafPad(0, 4.65, 0, 1.32, 0.55, 1.32, FOLIAGE_SHADES[4]);
  addLeafPad(0, 4.92, 0, 0.96, 0.44, 0.96, FOLIAGE_SHADES[6]);
  addLeafPad(0.55, 4.48, 0.45, 1.02, 0.45, 1.02, FOLIAGE_SHADES[5]);
  addLeafPad(-0.55, 4.45, -0.45, 1.02, 0.45, 1.02, FOLIAGE_SHADES[5]);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree canopy");
  return merged;
}

/** Builds 6 warm golden temple lanterns hanging beneath the main boughs. */
function buildTreeLanternsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 6;
  const radius = 1.54;
  const yTop = 2.98;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.25;
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;

    const cord = new CylinderGeometry(0.008, 0.008, 0.28, 5);
    cord.translate(lx, yTop - 0.14, lz);
    parts.push(paintGeometry(cord, 0x3b2818));

    const cap = new CylinderGeometry(0.085, 0.105, 0.038, 8);
    cap.translate(lx, yTop - 0.28, lz);
    parts.push(paintGeometry(cap, 0x4a2e1b));

    const glowCore = new SphereGeometry(0.09, 10, 8);
    glowCore.scale(1, 1.28, 1);
    glowCore.translate(lx, yTop - 0.38, lz);
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
        float swayWeight = clamp((transformed.y - 2.1) * 0.35, 0.0, 1.0);
        float leafPhase = transformed.x * 1.1 + transformed.z * 0.9 + transformed.y * 0.7;
        float leafSway = swayWeight * (0.046 * sin(uTime * 1.65 + leafPhase) + 0.022 * cos(uTime * 2.9 - leafPhase * 1.3));
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
      px = anchor.x + (rand() - 0.5) * 0.18;
      py = anchor.y + (rand() - 0.5) * 0.12;
      pz = anchor.z + (rand() - 0.5) * 0.18;
    } else {
      const r = 1.22 + (i % 3) * 0.28 + (rand() - 0.5) * 0.16;
      px = Math.cos(jitterAngle) * r;
      pz = Math.sin(jitterAngle) * r;
      py = 2.38 + (i % 3) * 0.2 + (rand() - 0.5) * 0.12;
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
    position: [WISH_TREE_POS.x + 5.2, 2.7, WISH_TREE_POS.z + 5.6],
    target: [WISH_TREE_POS.x, 2.3, WISH_TREE_POS.z],
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
