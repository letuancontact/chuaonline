import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Scene,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOUNDARY, GATE, LANTERN_LOOP, PATH, PATH_LANTERNS, ROCKS, type Vec2 } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { IS_MOBILE, maxAnisotropy } from "../engine/renderer.ts";
import type { Assets } from "./assets.ts";
import type { MaterialKey, Materials } from "./materials.ts";
import { GeometryBatch, disposeGroupGeometry } from "./merge.ts";
import { gardenRegionOf, type GardenRegion, type Regions } from "./regions.ts";
import { createRoofGeometry } from "./roof.ts";
import { seeded } from "./random.ts";
import { attachAncientTreeToWishingTree } from "./wishing-tree.ts";

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

/**
 * Low-forking, wide-canopy base height (metres) for the procedural multi-dome trees.
 * Lowering the base height to 6.5 m while starting foliage domes at y = 1.1 m
 * ensures the lower horizon line is completely covered.
 */
const MAPLE_BASE_HEIGHT = 6.5;
/** Base height for the Wishing Tree outside the gate (matches wishing-tree.ts hang spots). */
const WISH_TREE_BASE_HEIGHT = 7.6;

/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.25;

/**
 * Number of evenly spaced angular slots around the courtyard perimeter.
 * Every ring uses this exact angular grid with locked phase offsets (0.0 -> 0.5 -> 0.25 -> 0.75)
 * so front tree trunks and low canopy domes interlock and hide the horizon completely.
 */
const PERIMETER_SLOTS = IS_MOBILE ? 24 : 28;

interface MapleRingSpec {
  readonly slots: number;
  readonly ring: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly spread: readonly [number, number];
  readonly phaseOffset: number;
}

/**
 * High-LOD staggered rings (100% procedural, zero GLB downloads):
 * - Ring 1 (phase 0.00): Complete front perimeter ring framing the courtyard.
 * - Ring 2 (phase 0.50): Placed at the exact midpoint gap between every pair of Ring 1 trunks.
 * - Ring 3 (phase 0.25): Placed at the quarter-step gap between Ring 1 and Ring 2.
 */
const MAPLE_HIGH_RINGS: readonly MapleRingSpec[] = [
  {
    slots: PERIMETER_SLOTS,
    ring: [1.02, 1.07],
    scale: [0.96, 1.16],
    spread: [1.18, 1.32],
    phaseOffset: 0.0,
  },
  {
    slots: PERIMETER_SLOTS,
    ring: [1.1, 1.17],
    scale: [1.08, 1.28],
    spread: [1.22, 1.36],
    phaseOffset: 0.5,
  },
  {
    slots: PERIMETER_SLOTS,
    ring: [1.2, 1.3],
    scale: [1.18, 1.42],
    spread: [1.25, 1.42],
    phaseOffset: 0.25,
  },
];

/**
 * Far-LOD staggered rings:
 * - Ring 4 (phase 0.75): Fills the remaining three-quarter-step gap behind Ring 2 & Ring 3.
 * - Ring 5 (double density): Seals the deep woodland horizon from the ground up.
 */
const MAPLE_FAR_RINGS: readonly MapleRingSpec[] = [
  {
    slots: PERIMETER_SLOTS,
    ring: [1.33, 1.46],
    scale: [1.28, 1.56],
    spread: [1.28, 1.46],
    phaseOffset: 0.75,
  },
  {
    slots: PERIMETER_SLOTS * 2,
    ring: [1.48, 1.82],
    scale: [1.42, 1.85],
    spread: [1.3, 1.52],
    phaseOffset: 0.5,
  },
];

/**
 * Interleaved foliage palette cycling smoothly across adjacent trees:
 * 1. Đỏ phong trầm ấm (Classic Temple Maple Red)
 * 2. Vàng nõn chuối tươi dịu (Fresh Chartreuse / Young Leaf Yellow-Green)
 * 3. Vàng cam mùa thu (Warm Autumn Gold-Orange)
 * 4. Đỏ cam hổ phách (Warm Vermilion-Amber)
 * 5. Vàng lá thu sáng (Soft Golden Yellow)
 * 6. Xanh cốm non nõn chuối (Soft Spring Olive-Chartreuse)
 */
const FOREST_FOLIAGE_PALETTE: readonly number[] = [
  0xde3c24, // Đỏ phong trầm ấm
  0xb5e349, // Vàng nõn chuối tươi dịu
  0xf5a12c, // Vàng cam mùa thu
  0xeb5e26, // Đỏ cam hổ phách
  0xf7bd38, // Vàng lá thu sáng
  0x9ed642, // Xanh cốm non nõn chuối
];

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_PILLAR_X = 3.4;
const GATE_WALL_X = 18;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();
const UP = new Vector3(0, 1, 0);

function box(
  batch: GeometryBatch<Key>,
  key: Key,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  tile = 1,
  castShadow = true,
): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile, castShadow });
  g.dispose();
}

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromAxisAngle(UP, yaw), s3.set(sx, sy, sz));
}

/**
 * Dedicated shader for the multi-colored Maple foliage (`DoubleSide` alpha-cutout leaf domes):
 * 1. Applies gentle wind sway in the vertex shader.
 * 2. Keeps outward-domed canopy normals on both sides of `DoubleSide` leaf cards so backfaces never turn black.
 * 3. Adds warm sunlight translucency so chartreuse, golden-orange, and crimson domes glow naturally.
 */
function attachMapleFoliageShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vCanopyLift;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        vCanopyLift = clamp((transformed.y - 1.2) / 5.0, 0.0, 1.0);
        float swayWeight = clamp((transformed.y - 1.0) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.04 * sin(uTime * 1.55 + leafPhase) + 0.016 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCanopyLift;")
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight += diffuseColor.rgb * (0.10 + 0.16 * vCanopyLift);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// LUSH MULTI-DOMED TEMPLE TREE (LOW TRUNK + DENSE HORIZON-COVERING CANOPY)
// ============================================================================

/**
 * Draws a dense 512x512 botanical texture of a 7-lobed serrated Maple/Bodhi branchlet
 * in a high-luminance neutral-warm value range so `instanceColor` tints each tree cleanly
 * into Chartreuse (`vàng nõn chuối`), Golden-Orange (`vàng cam`), or Temple Crimson (`đỏ phong`).
 */
function drawMapleClusterTexture(size = 512): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0xca71ad0);

  // Delicate dark-wood twig stems radiating from the centre.
  ctx.strokeStyle = "#4a2c18";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.009;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.86);
  ctx.quadraticCurveTo(size * 0.49, size * 0.52, size * 0.5, size * 0.16);
  ctx.moveTo(size * 0.49, size * 0.66);
  ctx.quadraticCurveTo(size * 0.32, size * 0.56, size * 0.18, size * 0.44);
  ctx.moveTo(size * 0.5, size * 0.64);
  ctx.quadraticCurveTo(size * 0.68, size * 0.54, size * 0.82, size * 0.42);
  ctx.moveTo(size * 0.49, size * 0.42);
  ctx.quadraticCurveTo(size * 0.34, size * 0.32, size * 0.24, size * 0.22);
  ctx.moveTo(size * 0.5, size * 0.4);
  ctx.quadraticCurveTo(size * 0.66, size * 0.3, size * 0.76, size * 0.2);
  ctx.stroke();

  /** Draws one 7-lobe serrated palmately-lobed leaf at (cx, cy). */
  const drawPalmateMapleLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    innerLum: string,
    outerLum: string,
    tipLum: string,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    const lobeAngles = [-1.88, -1.25, -0.6, 0, 0.6, 1.25, 1.88] as const;
    const lobeLengths = [0.48, 0.78, 0.96, 1.06, 0.96, 0.78, 0.48] as const;
    const lobeWidths = [0.17, 0.23, 0.26, 0.28, 0.26, 0.23, 0.17] as const;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.16);

    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]!;
      const wid = radius * lobeWidths[i]!;
      const perp = a + Math.PI * 0.5;

      const tipX = Math.cos(a) * len;
      const tipY = Math.sin(a) * len;

      const l1x = Math.cos(a) * (len * 0.45) - Math.cos(perp) * (wid * 0.85);
      const l1y = Math.sin(a) * (len * 0.45) - Math.sin(perp) * (wid * 0.85);
      const l2x = Math.cos(a) * (len * 0.75) - Math.cos(perp) * (wid * 0.46);
      const l2y = Math.sin(a) * (len * 0.75) - Math.sin(perp) * (wid * 0.46);

      const r2x = Math.cos(a) * (len * 0.75) + Math.cos(perp) * (wid * 0.46);
      const r2y = Math.sin(a) * (len * 0.75) + Math.sin(perp) * (wid * 0.46);
      const r1x = Math.cos(a) * (len * 0.45) + Math.cos(perp) * (wid * 0.85);
      const r1y = Math.sin(a) * (len * 0.45) + Math.sin(perp) * (wid * 0.85);

      ctx.lineTo(l1x, l1y);
      ctx.lineTo(l2x, l2y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(r2x, r2y);
      ctx.lineTo(r1x, r1y);

      if (i < lobeAngles.length - 1) {
        const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
        const midA = (a + nextA) * 0.5;
        const notchR = radius * 0.32;
        ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
      }
    }

    ctx.closePath();

    const grad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.14, radius * 1.04);
    grad.addColorStop(0, innerLum);
    grad.addColorStop(0.66, outerLum);
    grad.addColorStop(1, tipLum);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.3, radius * 0.03);
    ctx.strokeStyle = "rgba(64, 42, 24, 0.62)";
    ctx.stroke();

    // Palmate primary veins.
    ctx.strokeStyle = "rgba(255, 252, 235, 0.5)";
    ctx.lineWidth = Math.max(1.0, radius * 0.022);
    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]! * 0.86;
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.08);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.restore();
  };

  // Dense background layer filling the cluster core so domes are opaque and block the horizon.
  const backShades: readonly [string, string, string][] = [
    ["#b8ae9e", "#d4cbb8", "#aba08e"],
    ["#c2b8a7", "#ded5c3", "#b5aa98"],
  ];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2 + (rand() - 0.5) * 0.24;
    const dist = (0.08 + rand() * 0.24) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.49 + Math.sin(angle) * dist;
    const r = (0.125 + rand() * 0.045) * size;
    const pal = backShades[i % backShades.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.65, pal[0], pal[1], pal[2]);
  }

  // Sunlit foreground leaves in the spray.
  const frontShades: readonly [string, string, string][] = [
    ["#ded6c6", "#f5efe2", "#ffffff"],
    ["#d6cebe", "#ede6d8", "#faf6ed"],
    ["#e6dfd1", "#faf5ea", "#ffffff"],
  ];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2 + 0.15 + (rand() - 0.5) * 0.22;
    const dist = (0.04 + rand() * 0.21) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.48 + Math.sin(angle) * dist;
    const r = (0.13 + rand() * 0.045) * size;
    const pal = frontShades[i % frontShades.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.55, pal[0], pal[1], pal[2]);
  }

  drawPalmateMapleLeaf(size * 0.48, size * 0.46, size * 0.15, -0.32, "#e3dcd0", "#f7f2e6", "#ffffff");
  drawPalmateMapleLeaf(size * 0.53, size * 0.51, size * 0.145, 0.38, "#dbd3c5", "#f2ece0", "#fcfaf5");

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/**
 * Builds a slender, lightweight curved tubular branch or trunk spline.
 */
function buildCurvedBranchSegment(
  points: readonly Vector3[],
  radii: readonly number[],
  radialSegs: number,
  baseHex: number,
  topHex: number,
): BufferGeometry {
  const rings = points.length;
  const cols = radialSegs + 1;
  const vCount = rings * cols;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);

  const c0 = new Color(baseHex);
  const c1 = new Color(topHex);
  const cTmp = new Color();

  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const pt = new Vector3();
  let vDist = 0;

  for (let i = 0; i < rings; i++) {
    const curr = points[i]!;
    if (i > 0) {
      vDist += curr.distanceTo(points[i - 1]!);
    }
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(rings - 1, i + 1)]!;
    tangent.subVectors(next, prev).normalize();

    const ref = Math.abs(tangent.y) > 0.92 ? new Vector3(1, 0, 0) : UP;
    binormal.crossVectors(tangent, ref).normalize();
    normal.crossVectors(binormal, tangent).normalize();

    const r = radii[i]!;
    const tFrac = i / Math.max(1, rings - 1);
    cTmp.lerpColors(c0, c1, tFrac);

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

      const nx = normal.x * ca + binormal.x * sa;
      const ny = normal.y * ca + binormal.y * sa;
      const nz = normal.z * ca + binormal.z * sa;

      pt.set(curr.x + nx * r, curr.y + ny * r, curr.z + nz * r);

      const idx = i * cols + j;
      pos[idx * 3] = pt.x;
      pos[idx * 3 + 1] = pt.y;
      pos[idx * 3 + 2] = pt.z;

      nrm[idx * 3] = nx;
      nrm[idx * 3 + 1] = ny;
      nrm[idx * 3 + 2] = nz;

      uv[idx * 2] = uFrac * 2.0;
      uv[idx * 2 + 1] = vDist * 0.85;

      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(indices);
  return g;
}

/**
 * Builds one curved, umbrella-arched leaf spray card ("phiến vòm lá").
 */
function buildArchedLeafSpray(
  cx: number,
  cy: number,
  cz: number,
  scaleX: number,
  scaleZ: number,
  archHeight: number,
  yaw: number,
  pitch: number,
  roll: number,
  innerHex: number,
  outerHex: number,
  cloudCenter: Vector3,
): BufferGeometry {
  const cIn = new Color(innerHex);
  const cOut = new Color(outerHex);

  const localPos = new Float32Array([
    -0.54, -0.06, -0.54,
    0.54, -0.06, -0.54,
    0.54, -0.06, 0.54,
    -0.54, -0.06, 0.54,
    0.0, archHeight, 0.0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
    0.5, 0.5,
  ]);
  const cols = new Float32Array([
    cIn.r, cIn.g, cIn.b,
    cOut.r, cOut.g, cOut.b,
    cOut.r, cOut.g, cOut.b,
    cIn.r, cIn.g, cIn.b,
    (cIn.r + cOut.r) * 0.52, (cIn.g + cOut.g) * 0.52, (cIn.b + cOut.b) * 0.52,
  ]);
  const indices = [
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
  ];

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(localPos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  g.setAttribute("color", new Float32BufferAttribute(cols, 3));
  g.setIndex(indices);

  tmpEuler.set(pitch, yaw, roll, "YXZ");
  q.setFromEuler(tmpEuler);
  m4.compose(v3.set(cx, cy, cz), q, s3.set(scaleX, 1, scaleZ));
  g.applyMatrix4(m4);

  const posAttr = g.getAttribute("position");
  const nrmArr = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i) - cloudCenter.x;
    const vy = posAttr.getY(i) - cloudCenter.y + 0.45;
    const vz = posAttr.getZ(i) - cloudCenter.z;
    const len = Math.hypot(vx, vy, vz) || 1;
    nrmArr[i * 3] = vx / len;
    nrmArr[i * 3 + 1] = vy / len;
    nrmArr[i * 3 + 2] = vz / len;
  }
  g.setAttribute("normal", new Float32BufferAttribute(nrmArr, 3));
  return g;
}

/**
 * Builds a full, volumetric, rounded Canopy Dome ("vòm tán cây") with:
 * - Steeply angled perimeter skirt sprays (`pitch = 0.55..0.72 rad`) so looking horizontally from the courtyard
 *   hits solid, lush foliage domes that block 100% of the horizon line.
 * - Shingled mid-dome sprays and a rounded top crown cap.
 */
function buildMapleCloudPad(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  shadowHex: number,
  midHex: number,
  brightHex: number,
  rand: () => number,
  highDetail: boolean,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  // 1. Steeply pitched perimeter skirt ring ("vòm rủ che chân trời") facing outward in all directions.
  const skirtCount = highDetail ? 5 : 3;
  for (let i = 0; i < skirtCount; i++) {
    const a = (i / skirtCount) * Math.PI * 2 + rand() * 0.35;
    const d = radius * (0.36 + rand() * 0.16);
    const sx = radius * (0.98 + rand() * 0.22);
    const sz = radius * (0.96 + rand() * 0.22);
    // Steep pitch (0.55..0.72 rad ≈ 32°..41°) gives the dome vertical thickness to block the horizon.
    const pitch = 0.55 + rand() * 0.17;
    const roll = (rand() - 0.5) * 0.24;
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy - 0.08 + (rand() - 0.5) * 0.08,
        cz + Math.sin(a) * d,
        sx,
        sz,
        0.22,
        a,
        pitch,
        roll,
        shadowHex,
        midHex,
        center,
      ),
    );
  }

  // 2. Mid-dome overlapping sprays fanning outward.
  const midCount = highDetail ? 4 : 2;
  for (let i = 0; i < midCount; i++) {
    const a = (i / midCount) * Math.PI * 2 + 0.4 + (rand() - 0.5) * 0.25;
    const d = radius * (0.24 + rand() * 0.18);
    const sx = radius * (0.95 + rand() * 0.22);
    const sz = radius * (0.95 + rand() * 0.22);
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy + 0.14 + (rand() - 0.5) * 0.06,
        cz + Math.sin(a) * d,
        sx,
        sz,
        0.24,
        a,
        0.3 + rand() * 0.18,
        (rand() - 0.5) * 0.25,
        midHex,
        brightHex,
        center,
      ),
    );
  }

  // 3. Upper sunlit dome cap.
  const capCount = highDetail ? 2 : 1;
  for (let i = 0; i < capCount; i++) {
    const a = i * 1.57 + rand() * 0.8;
    const sx = radius * (0.92 + rand() * 0.2);
    const sz = radius * (0.92 + rand() * 0.2);
    parts.push(
      buildArchedLeafSpray(
        cx,
        cy + 0.28 + i * 0.08,
        cz,
        sx,
        sz,
        0.24,
        a,
        (rand() - 0.5) * 0.2,
        (rand() - 0.5) * 0.2,
        midHex,
        brightHex,
        center,
      ),
    );
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: maple cloud pad");
  return merged;
}

interface MapleTreeGeometries {
  /** High-LOD merged 2-group geometry for inner & mid rings. */
  highGeo: BufferGeometry;
  /** Far-LOD merged 2-group geometry for outer horizon rings. */
  farGeo: BufferGeometry;
  /** Dedicated Golden-Crimson Bodhi/Maple geometry for the Wishing Tree outside the gate. */
  wishTreeGeo: BufferGeometry;
}

/**
 * Generates the low-trunk, multi-domed Temple Trees:
 * - Short trunk (`0.85 m .. 1.45 m` before the first boughs split) so there is NO tall empty gap underneath.
 * - 3 full tiers of dense canopy domes (`Low Skirt y = 1.15..2.1 m`, `Mid Crown y = 2.2..4.1 m`, `Upper Crown y = 4.2..6.2 m`)
 *   that completely hide the lower horizon line.
 */
function createAncientRedMapleGeometries(): MapleTreeGeometries {
  const rand = seeded(0x7e4a91e);

  const buildForestLOD = (highDetail: boolean): BufferGeometry => {
    const barkParts: BufferGeometry[] = [];
    const leafParts: BufferGeometry[] = [];
    const radialSegs = highDetail ? 5 : 4;
    const subSegs = highDetail ? 4 : 3;

    // 1. Short, slender lower trunk: forks early at y = 0.9 m .. 2.4 m so foliage sits low to the ground.
    const trunkPts = [
      new Vector3(0.0, 0.0, 0.0),
      new Vector3(0.04, 0.65, -0.03),
      new Vector3(-0.05, 1.35, 0.03),
      new Vector3(-0.02, 2.05, 0.02),
      new Vector3(0.02, 2.75, -0.02),
    ];
    const trunkRadii = [0.21, 0.165, 0.13, 0.1, 0.075];
    barkParts.push(buildCurvedBranchSegment(trunkPts, trunkRadii, radialSegs, 0x3b281b, 0x5c402c));

    const shHex = 0x695d52;
    const mdHex = 0xcfc6b8;
    const brHex = 0xfffdf5;
    const warmAccentHex = 0xffe8b8;

    // 2. TIER A — 6 Low-sweeping Skirt Boughs & Horizon-Blocking Domes (y = 1.15 m .. 2.15 m).
    const lowSkirtSpecs = [
      { angle: 0.0, startY: 0.88, reach: 2.35, topY: 1.35 },
      { angle: 1.05, startY: 0.96, reach: 2.25, topY: 1.55 },
      { angle: 2.09, startY: 0.92, reach: 2.4, topY: 1.4 },
      { angle: 3.14, startY: 1.02, reach: 2.3, topY: 1.6 },
      { angle: 4.19, startY: 0.9, reach: 2.45, topY: 1.38 },
      { angle: 5.24, startY: 1.05, reach: 2.25, topY: 1.65 },
    ] as const;

    for (let s = 0; s < lowSkirtSpecs.length; s++) {
      const sp = lowSkirtSpecs[s]!;
      const ca = Math.cos(sp.angle);
      const sa = Math.sin(sp.angle);
      const p0 = new Vector3(ca * 0.08, sp.startY, sa * 0.08);
      const p1 = new Vector3(ca * (sp.reach * 0.55), sp.startY + 0.25, sa * (sp.reach * 0.55));
      const p2 = new Vector3(ca * sp.reach, sp.topY, sa * sp.reach);

      if (highDetail || s % 2 === 0) {
        barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [0.085, 0.055, 0.028], 3, 0x4d3524, 0x5c402c));
      }

      // Large low-hanging foliage dome right at 1.25 m .. 1.75 m height to seal the bottom horizon.
      leafParts.push(
        buildMapleCloudPad(
          p2.x,
          p2.y + 0.08,
          p2.z,
          1.48 + rand() * 0.22,
          shHex,
          mdHex,
          s % 2 === 0 ? brHex : warmAccentHex,
          rand,
          highDetail,
        ),
      );
    }

    // 3. TIER B — 5 Main Mid-Canopy Spreading Boughs + Secondary Forks (y = 2.3 m .. 4.2 m).
    const midBoughSpecs = [
      { angle: 0.42, startY: 1.45, reach: 2.95, topY: 3.15, r0: 0.095, sway: 0.2 },
      { angle: 1.68, startY: 1.65, reach: 2.8, topY: 3.45, r0: 0.09, sway: -0.18 },
      { angle: 2.94, startY: 1.55, reach: 3.0, topY: 3.25, r0: 0.095, sway: 0.18 },
      { angle: 4.2, startY: 1.75, reach: 2.75, topY: 3.6, r0: 0.085, sway: -0.2 },
      { angle: 5.46, startY: 1.9, reach: 2.65, topY: 3.85, r0: 0.08, sway: 0.16 },
    ] as const;

    for (let b = 0; b < midBoughSpecs.length; b++) {
      const spec = midBoughSpecs[b]!;
      const ca = Math.cos(spec.angle);
      const sa = Math.sin(spec.angle);
      const pa = spec.angle + Math.PI * 0.5;

      const p0 = new Vector3(ca * 0.06, spec.startY, sa * 0.06);
      const p1 = new Vector3(
        ca * (spec.reach * 0.5) + Math.cos(pa) * spec.sway,
        spec.startY + (spec.topY - spec.startY) * 0.54,
        sa * (spec.reach * 0.5) + Math.sin(pa) * spec.sway,
      );
      const p2 = new Vector3(ca * spec.reach, spec.topY, sa * spec.reach);

      barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [spec.r0, spec.r0 * 0.65, spec.r0 * 0.34], subSegs, 0x543a28, 0x694934));

      const forkSides = [-0.48, 0.48] as const;
      for (let f = 0; f < forkSides.length; f++) {
        const side = forkSides[f]!;
        const fAngle = spec.angle + side;
        const fca = Math.cos(fAngle);
        const fsa = Math.sin(fAngle);
        const fReach = spec.reach * (0.96 + (f % 2) * 0.18);
        const fTopY = spec.topY + 0.35 + f * 0.24;

        const fp0 = p1.clone();
        const fp1 = new Vector3((fp0.x + fca * fReach) * 0.52, (fp0.y + fTopY) * 0.54, (fp0.z + fsa * fReach) * 0.52);
        const fp2 = new Vector3(fca * fReach, fTopY, fsa * fReach);

        if (highDetail) {
          barkParts.push(buildCurvedBranchSegment([fp0, fp1, fp2], [spec.r0 * 0.5, spec.r0 * 0.28, 0.025], 3, 0x5c402c, 0x473020));
        }

        leafParts.push(
          buildMapleCloudPad(
            fp2.x,
            fp2.y + 0.1,
            fp2.z,
            1.45 + rand() * 0.25,
            shHex,
            mdHex,
            (b + f) % 2 === 0 ? brHex : warmAccentHex,
            rand,
            highDetail,
          ),
        );
      }

      // Interior dome filling the heart of the bough.
      leafParts.push(
        buildMapleCloudPad(
          p2.x * 0.72,
          p2.y - 0.15,
          p2.z * 0.72,
          1.42,
          0x594e43,
          0xb8afa2,
          mdHex,
          rand,
          false,
        ),
      );
    }

    // 4. TIER C — Upper Crown Apex & 6 Top Canopy Domes (y = 4.2 m .. 6.2 m).
    const crownPts = [
      new Vector3(0.02, 2.65, -0.02),
      new Vector3(-0.07, 3.85, 0.04),
      new Vector3(0.0, 5.35, 0.0),
    ];
    barkParts.push(buildCurvedBranchSegment(crownPts, [0.075, 0.05, 0.025], subSegs, 0x543a28, 0x452e1e));

    const crownPads = highDetail ? 6 : 4;
    for (let c = 0; c < crownPads; c++) {
      const ca = (c / crownPads) * Math.PI * 2 + 0.35;
      const rad = c === 0 ? 0.08 : 1.05 + (c % 2) * 0.58;
      const cy = 4.65 + (1 - rad / 2.2) * 0.95 + (rand() - 0.5) * 0.16;
      leafParts.push(
        buildMapleCloudPad(
          Math.cos(ca) * rad,
          cy,
          Math.sin(ca) * rad,
          1.42 + rand() * 0.22,
          shHex,
          mdHex,
          c % 2 === 0 ? brHex : warmAccentHex,
          rand,
          highDetail,
        ),
      );
    }

    const mergedBark = mergeGeometries(barkParts, false);
    const mergedLeaves = mergeGeometries(leafParts, false);
    for (const g of barkParts) g.dispose();
    for (const g of leafParts) g.dispose();
    if (!mergedBark || !mergedLeaves) throw new Error("merge: temple maple");

    const combined = mergeGeometries([mergedBark, mergedLeaves], true);
    mergedBark.dispose();
    mergedLeaves.dispose();
    if (!combined) throw new Error("merge: temple maple combined");

    combined.computeBoundingBox();
    const bbox = combined.boundingBox ?? new Box3();
    const rawH = Math.max(0.01, bbox.max.y - bbox.min.y);
    const scale = MAPLE_BASE_HEIGHT / rawH;
    combined.translate(0, -bbox.min.y, 0);
    combined.scale(scale, scale, scale);
    combined.computeBoundingBox();
    combined.computeBoundingSphere();
    return combined;
  };

  /**
   * Builds the dedicated Golden-Crimson Wishing Bodhi/Maple Tree for `wishing-tree.ts`
   * (normalized to 7.6 m so the hanging red wishing plaques at y = 2.95..3.35 m sit right under its boughs).
   */
  const buildWishingTreeGeometry = (): BufferGeometry => {
    const barkParts: BufferGeometry[] = [];
    const leafParts: BufferGeometry[] = [];

    const trunkPts = [
      new Vector3(0.0, 0.0, 0.0),
      new Vector3(0.06, 0.85, -0.04),
      new Vector3(-0.07, 1.75, 0.05),
      new Vector3(-0.02, 2.65, 0.02),
      new Vector3(0.0, 3.65, 0.0),
    ];
    barkParts.push(buildCurvedBranchSegment(trunkPts, [0.34, 0.26, 0.21, 0.16, 0.11], 6, 0x3b281b, 0x5c402c));

    // 6 main boughs matching `buildHangSpots()` in `wishing-tree.ts` (angles `(i / 6) * 2π + 0.28`).
    const wishGold = 0xf5b82e;
    const wishOrange = 0xeb6825;
    const wishCrimson = 0xd9381e;
    const wishChartreuse = 0xb5e349;
    const domeTints = [wishGold, wishCrimson, wishOrange, wishChartreuse, wishGold, wishCrimson] as const;

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.28;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
      const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
      const p2 = new Vector3(ca * 2.65, 3.85 + (i % 2) * 0.18, sa * 2.65);
      barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [0.14, 0.095, 0.045], 5, 0x543a28, 0x694934));

      const tint = domeTints[i % domeTints.length]!;
      leafParts.push(
        buildMapleCloudPad(p1.x, p1.y + 0.55, p1.z, 1.35, 0x6e2214, tint, 0xffe89e, rand, true),
        buildMapleCloudPad(p2.x, p2.y + 0.35, p2.z, 1.48, 0x6e2214, tint, 0xffe89e, rand, true),
      );
    }

    for (let c = 0; c < 5; c++) {
      const a = (c / 5) * Math.PI * 2 + 0.5;
      const rad = c === 0 ? 0.0 : 1.25;
      const cy = c === 0 ? 6.15 : 5.25;
      const tint = domeTints[c % domeTints.length]!;
      leafParts.push(
        buildMapleCloudPad(Math.cos(a) * rad, cy, Math.sin(a) * rad, 1.55, 0x6e2214, tint, 0xfff0b8, rand, true),
      );
    }

    const mergedBark = mergeGeometries(barkParts, false);
    const mergedLeaves = mergeGeometries(leafParts, false);
    for (const g of barkParts) g.dispose();
    for (const g of leafParts) g.dispose();
    if (!mergedBark || !mergedLeaves) throw new Error("merge: wishing tree maple");

    const combined = mergeGeometries([mergedBark, mergedLeaves], true);
    mergedBark.dispose();
    mergedLeaves.dispose();
    if (!combined) throw new Error("merge: wishing tree combined");

    combined.computeBoundingBox();
    const bbox = combined.boundingBox ?? new Box3();
    const rawH = Math.max(0.01, bbox.max.y - bbox.min.y);
    const scale = WISH_TREE_BASE_HEIGHT / rawH;
    combined.translate(0, -bbox.min.y, 0);
    combined.scale(scale, scale, scale);
    combined.computeBoundingBox();
    combined.computeBoundingSphere();
    return combined;
  };

  return {
    highGeo: buildForestLOD(true),
    farGeo: buildForestLOD(false),
    wishTreeGeo: buildWishingTreeGeometry(),
  };
}

interface PlacedTreeItem {
  x: number;
  z: number;
  matrix: Matrix4;
  colorHex: number;
}

/**
 * Splits a ring of tree instances (with per-instance foliage colors) into North and South halves
 * so frustum culling skips the half behind the camera while keeping draw calls minimal.
 */
function buildHemisphereInstancedMeshes(
  namePrefix: string,
  geometry: BufferGeometry,
  material: Material | Material[],
  items: readonly PlacedTreeItem[],
  receiveShadow: boolean,
): InstancedMesh[] {
  const north: PlacedTreeItem[] = [];
  const south: PlacedTreeItem[] = [];
  for (const item of items) {
    if (item.z <= BOUNDARY.z) north.push(item);
    else south.push(item);
  }

  const meshes: InstancedMesh[] = [];
  const tintCol = new Color();
  const pairs: readonly [string, PlacedTreeItem[]][] = [
    ["north", north],
    ["south", south],
  ];
  for (const [label, list] of pairs) {
    if (list.length === 0) continue;
    const mesh = new InstancedMesh(geometry, material, list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, tintCol.setHex(item.colorHex));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius += 3.5;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `${namePrefix}:${label}`;
    meshes.push(mesh);
  }
  return meshes;
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
      batch.add("stone", g, place((x0 + x1) / 2, SLAB_TOP - 0.05, z + len / 2, (rand() - 0.5) * 0.03), {
        worldUV: 2.6,
        castShadow: false,
      });
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
  box(batch, "rock", x - 0.31, x + 0.31, 0, 0.16, z - 0.31, z + 0.31, 3, false);
  box(batch, "rock", x - 0.12, x + 0.12, 0.16, 0.78, z - 0.12, z + 0.12, 3);
  box(batch, "rock", x - 0.25, x + 0.25, 0.78, 0.86, z - 0.25, z + 0.25, 3, false);
  box(batch, "lanternPaper", x - 0.17, x + 0.17, 0.86, 1.22, z - 0.17, z + 0.17, 0.5, false);
  for (const dx of [-0.19, 0.19]) {
    for (const dz of [-0.19, 0.19]) {
      box(batch, "rock", x + dx - 0.035, x + dx + 0.035, 0.86, 1.22, z + dz - 0.035, z + dz + 0.035, 3, false);
    }
  }
  const cap = new ConeGeometry(0.42, 0.26, 4, 1);
  batch.add("rock", cap, place(x, 1.35, z, Math.PI / 4), { worldUV: 3 });
  cap.dispose();
  const knob = new SphereGeometry(0.07, 8, 6);
  batch.add("rock", knob, place(x, 1.5, z), { worldUV: 3, castShadow: false });
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
  const pillar = new CylinderGeometry(0.26, 0.3, 4.2, 14);
  const plinth = new CylinderGeometry(0.42, 0.48, 0.3, 14);
  for (const x of [-GATE_PILLAR_X, GATE_PILLAR_X]) {
    batch.add("stone", plinth, place(x, 0.15, GATE_Z), { worldUV: 0.8 });
    batch.add("paintRed", pillar, place(x, 0.3 + 2.1, GATE_Z), { uvScale: [2, 4] });
  }
  pillar.dispose();
  plinth.dispose();
  box(batch, "paintRed", -GATE_PILLAR_X - 0.5, GATE_PILLAR_X + 0.5, 3.4, 3.62, GATE_Z - 0.16, GATE_Z + 0.16, 1);
  box(batch, "darkWood", -GATE_PILLAR_X - 0.7, GATE_PILLAR_X + 0.7, 4.1, 4.5, GATE_Z - 0.22, GATE_Z + 0.22, 1);
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
  batch.add("wood", roof.bottom, undefined, { castShadow: false });
  batch.add("roofTrim", roof.fascia, undefined, { castShadow: false });
  roof.top.dispose();
  roof.bottom.dispose();
  roof.fascia.dispose();
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

/**
 * Generates strictly brick-staggered tree positions & interleaved foliage colors
 * so each outer ring's trunks stand directly in the gaps of the inner rings.
 */
function generateStaggeredMapleItems(
  rings: readonly MapleRingSpec[],
  rand: () => number,
  ringIndexOffset = 0,
): PlacedTreeItem[] {
  const items: PlacedTreeItem[] = [];
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;

  rings.forEach((spec, rIdx) => {
    const tierNumber = ringIndexOffset + rIdx;
    for (let k = 0; k < spec.slots; k++) {
      // Tight angular jitter (±0.03 of a slot) keeps the quincunx interlocking alignment exact.
      const slotPos = k + 0.5 + spec.phaseOffset + (rand() - 0.5) * 0.06;
      const u = (((slotPos % spec.slots) + spec.slots) % spec.slots) / spec.slots;
      const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;

      const r = spec.ring[0] + (0.2 + 0.6 * rand()) * (spec.ring[1] - spec.ring[0]);
      const p = ringPoint(a, r);

      const sc = spec.scale[0] + rand() * (spec.scale[1] - spec.scale[0]);
      const spread = spec.spread[0] + rand() * (spec.spread[1] - spec.spread[0]);
      const sx = sc * spread;
      const sz = sc * spread * (0.95 + rand() * 0.1);
      const yaw = (k * 1.6180339 + tierNumber * 0.75 + rand() * 0.35) * Math.PI * 2;

      // Deterministic interleaving of Chartreuse, Maple Red, and Golden-Orange across slots and rings.
      const paletteIdx = (k + tierNumber * 2) % FOREST_FOLIAGE_PALETTE.length;
      const colorHex = FOREST_FOLIAGE_PALETTE[paletteIdx] ?? 0xde3c24;

      items.push({
        x: p.x,
        z: p.z,
        matrix: place(p.x, 0, p.z, yaw, sx, sc, sz).clone(),
        colorHex,
      });
    }
  });

  return items;
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

  const uTreeTime = { value: 0 };

  // Build 100% procedural multi-domed Temple Trees (no `cothu.glb` or `cothu1.glb` network downloads!).
  const mapleLeafTex = drawMapleClusterTexture(512);
  const mapleBarkMat = own(
    new MeshStandardMaterial({
      map: materials.wood.map,
      normalMap: materials.wood.normalMap,
      roughnessMap: materials.wood.roughnessMap,
      normalScale: new Vector2(1.25, 1.25),
      vertexColors: true,
      color: new Color(0x9c7b60),
      roughness: 0.88,
      metalness: 0.0,
    }),
  );
  // Keep trunk colour warm brown regardless of the per-instance leaf `instanceColor` tint!
  mapleBarkMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTreeTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <color_vertex>",
        `#if defined( USE_COLOR_ALPHA )
          vColor = vec4( 1.0 );
        #elif defined( USE_COLOR )
          vColor = vec3( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.xyz *= color.xyz;
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float swayWeight = clamp((transformed.y - 1.0) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.04 * sin(uTime * 1.55 + leafPhase) + 0.016 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
  };

  const mapleFoliageMat = own(
    new MeshStandardMaterial({
      map: mapleLeafTex,
      vertexColors: true,
      color: new Color(0xffffff),
      alphaTest: 0.3,
      transparent: false,
      roughness: 0.74,
      metalness: 0.0,
      emissive: new Color(0x1f1206),
      emissiveIntensity: 0.06,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const generatedMaple = createAncientRedMapleGeometries();
  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // Mount the procedural Wishing Bodhi/Maple Tree onto the planter outside the gate.
  attachAncientTreeToWishingTree(generatedMaple.wishTreeGeo, mapleMats);

  const highMapleItems = generateStaggeredMapleItems(MAPLE_HIGH_RINGS, rand, 0);
  const farMapleItems = generateStaggeredMapleItems(MAPLE_FAR_RINGS, rand, MAPLE_HIGH_RINGS.length);

  const forest: InstancedMesh[] = [
    ...buildHemisphereInstancedMeshes("temple-maple-high", generatedMaple.highGeo, mapleMats, highMapleItems, true),
    ...buildHemisphereInstancedMeshes("temple-maple-far", generatedMaple.farGeo, mapleMats, farMapleItems, false),
  ];

  for (const mesh of forest) {
    scene.add(mesh);
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
      mapleFoliageMat.emissiveIntensity = 0.04 + 0.06 * daylight;
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
      generatedMaple.highGeo.dispose();
      generatedMaple.farGeo.dispose();
      generatedMaple.wishTreeGeo.dispose();
      mapleLeafTex.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
