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

/** Base height for the Wishing Tree outside the gate (matches wishing-tree.ts hang spots). */
const WISH_TREE_BASE_HEIGHT = 7.6;

/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.25;

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

// ============================================================================
// CLEAN, LUMINOUS TEMPLE FOLIAGE PALETTE (GREEN, GOLDEN-YELLOW, WARM ORANGE, MAPLE RED)
// ============================================================================

/**
 * Clean, vibrant, harmonious palette for stylized 3D temple trees:
 * Interleaves lush green, chartreuse, golden yellow, warm apricot-orange, and soft maple red.
 */
const TEMPLE_FOREST_PALETTE: readonly number[] = [
  0x46a342, // Xanh lá tươi thanh tịnh
  0xf5be2e, // Vàng thu rực sáng
  0xe0422a, // Đỏ lá phong tươi dịu
  0x62b548, // Xanh lá non
  0xf7ce3e, // Vàng nắng ấm
  0xf08226, // Vàng cam mùa thu
  0x3b8f38, // Xanh cổ thụ
  0xa8d63e, // Xanh cốm / vàng nõn chuối
  0xd94e34, // Đỏ cam dịu
  0xf2a829, // Vàng hổ phách
];

function pickTreeFoliageColor(index: number, ringTier: number, out: Color): Color {
  const step = (index * 3 + ringTier * 2) % TEMPLE_FOREST_PALETTE.length;
  const baseHex = TEMPLE_FOREST_PALETTE[step] ?? 0x46a342;
  out.setHex(baseHex);

  // Soften distant horizon trees slightly so they blend smoothly into the mountain haze
  if (ringTier >= 3) {
    out.lerp(new Color(0xb8cfc0), 0.14);
  }
  return out;
}

// ============================================================================
// SHADERS: SMOOTH HEMISPHERE SHADING & GENTLE BREEZE
// ============================================================================

function attachMapleBarkShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
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
        float branchWeight = clamp((transformed.y - 1.5) * 0.14, 0.0, 1.0);
        float treePhase = treePos.x * 0.37 + treePos.y * 0.53;
        float boughSway = branchWeight * 0.018 * sin(uTime * 0.95 + treePhase + transformed.x * 0.4);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Stylized Ghibli/Chibi Foliage Shader:
 * - Prevents `DoubleSide` backface normal inversion so leaves never turn dark/black on the back.
 * - Creates a clean, luminous sunlit gradient from the bottom of the canopy (`vCanopyGrad = 0`)
 *   to the sunlit top crown (`vCanopyGrad = 1`) without muddying the leaf colors.
 */
function attachMapleFoliageShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying float vCanopyGrad;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float heightNorm = clamp((transformed.y - 1.4) / 5.2, 0.0, 1.0);
        float sunSide = clamp(dot(normalize(objectNormal), vec3(0.42, 0.82, 0.38)), 0.0, 1.0);
        vCanopyGrad = clamp(heightNorm * 0.52 + sunSide * 0.48, 0.0, 1.0);

        float swayWeight = clamp((transformed.y - 1.2) * 0.18, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 0.9 + transformed.z * 0.85 + transformed.y * 0.5;
        float swayX = swayWeight * (0.025 * sin(uTime * 1.05 + treePhase + clusterPhase) + 0.01 * cos(uTime * 1.9 - clusterPhase));
        float swayZ = swayWeight * (0.02 * cos(uTime * 0.95 + treePhase * 1.2 + clusterPhase));
        transformed.x += swayX;
        transformed.y += (swayX + swayZ) * 0.08;
        transformed.z += swayZ;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vCanopyGrad;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Clean stylized gradient: soft warm shadow underneath, luminous sunlit tint on top
        vec3 lowerShade = diffuseColor.rgb * vec3(0.74, 0.76, 0.70);
        vec3 upperSun = mix(diffuseColor.rgb * 1.16, vec3(1.0, 0.96, 0.78), 0.18);
        diffuseColor.rgb = mix(lowerShade, upperSun, vCanopyGrad);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb * 0.95, 0.28) + diffuseColor.rgb * (0.06 + 0.12 * vCanopyGrad);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// CRISP, PURE-LUMINOUS 5-LOBED MAPLE SPRIG TEXTURE (`1024x1024`)
// ============================================================================

/**
 * Draws a clean, high-resolution 1024x1024 sprig of 11 distinct, large, well-proportioned
 * 5-lobed Japanese Maple leaves (`Acer palmatum`).
 * Uses pure luminous ivory-to-white tones (`#e8e2d5` -> `#ffffff`) with subtle warm veins
 * and NO dark brown/black borders so `instanceColor` produces vibrant, crystal-clear foliage!
 */
function drawCrispMapleSprigTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  /**
   * Draws one large, unmistakable 5-lobed Japanese Maple leaf with graceful curved lobes,
   * deep palmate notches, and bright veins.
   */
  const drawFiveLobeMapleLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    brightness: number,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    const lobeAngles = [-1.48, -0.74, 0, 0.74, 1.48] as const;
    const lobeLengths = [0.68, 0.94, 1.12, 0.94, 0.68] as const;
    const lobeWidths = [0.22, 0.26, 0.28, 0.26, 0.22] as const;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.16);

    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]!;
      const wid = radius * lobeWidths[i]!;
      const perp = a + Math.PI * 0.5;

      const tipX = Math.cos(a) * len;
      const tipY = Math.sin(a) * len;

      const lMidX = Math.cos(a) * (len * 0.52) - Math.cos(perp) * wid;
      const lMidY = Math.sin(a) * (len * 0.52) - Math.sin(perp) * wid;

      const rMidX = Math.cos(a) * (len * 0.52) + Math.cos(perp) * wid;
      const rMidY = Math.sin(a) * (len * 0.52) + Math.sin(perp) * wid;

      ctx.quadraticCurveTo(lMidX, lMidY, tipX, tipY);

      if (i < lobeAngles.length - 1) {
        const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
        const midA = (a + nextA) * 0.5;
        const notchR = radius * 0.34;
        const notchX = Math.cos(midA) * notchR;
        const notchY = Math.sin(midA) * notchR;
        ctx.quadraticCurveTo(rMidX, rMidY, notchX, notchY);
      } else {
        ctx.quadraticCurveTo(rMidX, rMidY, 0, radius * 0.16);
      }
    }

    ctx.closePath();

    const b0 = Math.round(218 * brightness);
    const b1 = Math.round(244 * brightness);
    const b2 = Math.min(255, Math.round(255 * brightness));

    const grad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.15, radius * 1.05);
    grad.addColorStop(0, `rgb(${b0}, ${b0 - 4}, ${b0 - 12})`);
    grad.addColorStop(0.65, `rgb(${b1}, ${b1 - 2}, ${b1 - 6})`);
    grad.addColorStop(1, `rgb(${b2}, ${b2}, ${b2})`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Soft, clean edge definition (no dark brown/black outline!)
    ctx.lineWidth = Math.max(1.5, radius * 0.024);
    ctx.strokeStyle = `rgba(${Math.round(185 * brightness)}, ${Math.round(178 * brightness)}, ${Math.round(165 * brightness)}, 0.45)`;
    ctx.stroke();

    // Luminous palmate veins
    ctx.strokeStyle = "rgba(255, 255, 245, 0.55)";
    ctx.lineWidth = Math.max(1.2, radius * 0.022);
    ctx.lineCap = "round";
    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]! * 0.82;
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.08);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.restore();
  };

  // 1. Inner base leaves (5 large overlapping leaves forming a soft, solid centre)
  const innerLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.54, 0.24, 0.0, 0.9],
    [0.34, 0.58, 0.22, -0.55, 0.88],
    [0.66, 0.58, 0.22, 0.55, 0.88],
    [0.36, 0.38, 0.23, -0.32, 0.92],
    [0.64, 0.38, 0.23, 0.32, 0.92],
  ];
  for (const [x, y, r, rot, br] of innerLeaves) {
    drawFiveLobeMapleLeaf(x * size, y * size, r * size, rot, br);
  }

  // 2. Outer fan of 7 crisp, large 5-lobed maple leaves defining the silhouette
  const outerLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.24, 0.23, 0.0, 1.0],
    [0.24, 0.32, 0.21, -0.52, 0.98],
    [0.76, 0.32, 0.21, 0.52, 0.98],
    [0.19, 0.56, 0.2, -0.95, 0.95],
    [0.81, 0.56, 0.2, 0.95, 0.95],
    [0.36, 0.74, 0.19, -2.35, 0.92],
    [0.64, 0.74, 0.19, 2.35, 0.92],
    [0.5, 0.46, 0.22, 0.12, 1.0],
  ];
  for (const [x, y, r, rot, br] of outerLeaves) {
    drawFiveLobeMapleLeaf(x * size, y * size, r * size, rot, br);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// SMOOTH CATMULL-ROM TRUNKS & SCULPTED FOLIAGE CUSHION PADS (NO FLAT X-PYRAMIDS)
// ============================================================================

/**
 * Evaluates a smooth Catmull-Rom spline through `controlPts` so trunks and boughs
 * curve organically without sharp polygonal kinks.
 */
function sampleSmoothCurve(controlPts: readonly Vector3[], subdivisions: number): Vector3[] {
  const n = controlPts.length;
  if (n < 2) return [...controlPts];
  const out: Vector3[] = [];
  for (let i = 0; i <= subdivisions; i++) {
    const tGlobal = (i / subdivisions) * (n - 1);
    const seg = Math.min(n - 2, Math.floor(tGlobal));
    const t = tGlobal - seg;

    const p0 = controlPts[Math.max(0, seg - 1)]!;
    const p1 = controlPts[seg]!;
    const p2 = controlPts[seg + 1]!;
    const p3 = controlPts[Math.min(n - 1, seg + 2)]!;

    const t2 = t * t;
    const t3 = t2 * t;

    const x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    const z =
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

    out.push(new Vector3(x, y, z));
  }
  return out;
}

function buildSmoothBranchTube(
  controlPts: readonly Vector3[],
  rStart: number,
  rEnd: number,
  lengthSegs: number,
  radialSegs: number,
  baseHex: number,
  topHex: number,
  flareBase = false,
): BufferGeometry {
  const points = sampleSmoothCurve(controlPts, lengthSegs);
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

    const tFrac = i / Math.max(1, rings - 1);
    const flare = flareBase && tFrac < 0.22 ? 1 + 0.35 * Math.pow(1 - tFrac / 0.22, 2) : 1.0;
    const r = (rStart * Math.pow(1 - tFrac, 0.85) + rEnd * tFrac) * flare;
    cTmp.lerpColors(c0, c1, tFrac);

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

      const nx = normal.x * ca + binormal.x * sa;
      const ny = normal.y * ca + binormal.y * sa;
      const nz = normal.z * ca + binormal.z * sa;

      const idx = i * cols + j;
      pos[idx * 3] = curr.x + nx * r;
      pos[idx * 3 + 1] = curr.y + ny * r;
      pos[idx * 3 + 2] = curr.z + nz * r;

      nrm[idx * 3] = nx;
      nrm[idx * 3 + 1] = ny;
      nrm[idx * 3 + 2] = nz;

      uv[idx * 2] = uFrac * 2.0;
      uv[idx * 2 + 1] = vDist * 0.75;

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
 * Builds a smoothly curved 3x3 subdivided leaf-sprig shell (18 triangles with smooth spherical curvature)
 * instead of a flat 4-triangle pyramid, so leaf clusters drape like real foliage without flat plane seams!
 */
function buildCurvedSprigShell(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  depth: number,
  arch: number,
  yaw: number,
  pitch: number,
  roll: number,
  innerHex: number,
  outerHex: number,
  padCenter: Vector3,
): BufferGeometry {
  const segs = 3;
  const cols = segs + 1;
  const vCount = cols * cols;
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);

  const cIn = new Color(innerHex);
  const cOut = new Color(outerHex);
  const cTmp = new Color();

  tmpEuler.set(pitch, yaw, roll, "YXZ");
  q.setFromEuler(tmpEuler);

  for (let iy = 0; iy <= segs; iy++) {
    const v = iy / segs;
    const lz = (0.5 - v) * depth;
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const lx = (u - 0.5) * width;
      const r2 = (u - 0.5) * (u - 0.5) * 4 + (v - 0.5) * (v - 0.5) * 4;
      const ly = arch * (1 - r2 * 0.65);

      v3.set(lx, ly, lz).applyQuaternion(q);
      const wx = cx + v3.x;
      const wy = cy + v3.y;
      const wz = cz + v3.z;

      const idx = iy * cols + ix;
      pos[idx * 3] = wx;
      pos[idx * 3 + 1] = wy;
      pos[idx * 3 + 2] = wz;

      uv[idx * 2] = u;
      uv[idx * 2 + 1] = v;

      cTmp.lerpColors(cIn, cOut, Math.min(1, Math.sqrt(r2) * 0.65 + v * 0.35));
      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;

      const nx = wx - padCenter.x;
      const ny = wy - padCenter.y + 0.55;
      const nz = wz - padCenter.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm[idx * 3] = nx / len;
      nrm[idx * 3 + 1] = ny / len;
      nrm[idx * 3 + 2] = nz / len;
    }
  }

  const indices: number[] = [];
  for (let iy = 0; iy < segs; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * cols + ix;
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
 * Builds a soft, sculpted 3D Canopy Pad ("tán mây lá phong bo tròn tự nhiên"):
 * Combines a smooth organic cushion core + shingled curved 3x3 maple-sprig shells around the rim
 * so the canopy looks soft, refined, and natural from every camera angle.
 */
function buildSculptedFoliagePad(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  droop: number,
  rimSprigs: number,
  rand: () => number,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const shHex = 0xcfc8bc;
  const mdHex = 0xede8df;
  const brHex = 0xffffff;

  // 1. Central curved dome shells (2 overlapping gentle domes with no sharp corners)
  for (let i = 0; i < 2; i++) {
    const a = i * 1.57 + rand() * 0.6;
    const s = width * (0.82 + i * 0.08);
    parts.push(
      buildCurvedSprigShell(
        cx,
        cy + 0.1 + i * 0.08,
        cz,
        s,
        s,
        0.24,
        a,
        (rand() - 0.5) * 0.14,
        (rand() - 0.5) * 0.14,
        shHex,
        brHex,
        center,
      ),
    );
  }

  // 2. Shingled outer rim maple-leaf sprigs fanning around the cloud pad
  for (let i = 0; i < rimSprigs; i++) {
    const a = (i / rimSprigs) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const reach = width * (0.28 + (i % 2) * 0.1 + rand() * 0.08);
    const s = width * (0.72 + rand() * 0.14);
    const dy = (i % 2 === 0 ? -0.04 : 0.06) - droop * 0.12;
    const pitch = 0.28 + droop * 0.25 + (rand() - 0.5) * 0.1;

    parts.push(
      buildCurvedSprigShell(
        cx + Math.cos(a) * reach,
        cy + dy,
        cz + Math.sin(a) * reach,
        s,
        s * 0.92,
        0.2,
        a,
        pitch,
        (rand() - 0.5) * 0.16,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: sculpted foliage pad");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"   // 1. Cổ thụ hậu cảnh
  | "spreading" // 2. Cây tán xòe
  | "rounded"   // 3. Cây tán tròn
  | "weeping"   // 4. Cây dáng rủ nhẹ
  | "curved"    // 5. Cây thân cong nghệ thuật
  | "small";    // 6. Cây phong nhỏ sát sân

interface ArchetypeSpec {
  readonly id: MapleArchetypeId;
  readonly baseHeight: number;
  readonly trunkBaseR: number;
  readonly trunkTopR: number;
  readonly barkColors: readonly [number, number];
  readonly trunkCurve: readonly [number, number, number][];
  readonly boughs: readonly {
    readonly angle: number;
    readonly startY: number;
    readonly midR: number;
    readonly midY: number;
    readonly endR: number;
    readonly endY: number;
    readonly radius: number;
    readonly padWidth: number;
    readonly droop: number;
  }[];
  readonly crownPads: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly width: number;
    readonly droop: number;
  }[];
}

const ARCHETYPE_SPECS: readonly ArchetypeSpec[] = [
  // 1. Cổ thụ hậu cảnh (Base height 10.5m)
  {
    id: "ancient",
    baseHeight: 10.5,
    trunkBaseR: 0.34,
    trunkTopR: 0.11,
    barkColors: [0x452d1e, 0x63432e],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 1.3, -0.05],
      [-0.1, 2.7, 0.06],
      [-0.03, 4.1, 0.02],
      [0.04, 5.4, -0.03],
    ],
    boughs: [
      { angle: 0.2, startY: 2.3, midR: 1.6, midY: 3.3, endR: 3.1, endY: 4.0, radius: 0.14, padWidth: 2.3, droop: 0.08 },
      { angle: 1.45, startY: 2.6, midR: 1.5, midY: 3.7, endR: 2.9, endY: 4.5, radius: 0.13, padWidth: 2.2, droop: 0.06 },
      { angle: 2.75, startY: 2.4, midR: 1.65, midY: 3.5, endR: 3.2, endY: 4.2, radius: 0.14, padWidth: 2.35, droop: 0.08 },
      { angle: 4.0, startY: 2.8, midR: 1.45, midY: 4.0, endR: 2.8, endY: 4.9, radius: 0.12, padWidth: 2.15, droop: 0.05 },
      { angle: 5.25, startY: 3.1, midR: 1.4, midY: 4.3, endR: 2.7, endY: 5.2, radius: 0.11, padWidth: 2.1, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 6.6, z: 0.0, width: 2.6, droop: 0.04 },
      { x: -1.3, y: 5.8, z: 0.9, width: 2.2, droop: 0.05 },
      { x: 1.3, y: 5.9, z: -0.9, width: 2.2, droop: 0.05 },
    ],
  },

  // 2. Cây phong tán xòe (Base height 8.2m)
  {
    id: "spreading",
    baseHeight: 8.2,
    trunkBaseR: 0.26,
    trunkTopR: 0.085,
    barkColors: [0x4a2f20, 0x694532],
    trunkCurve: [
      [0, 0, 0],
      [-0.07, 1.0, 0.05],
      [0.1, 2.1, -0.05],
      [0.05, 3.2, -0.02],
      [-0.03, 4.2, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 1.9, midR: 1.5, midY: 2.5, endR: 2.9, endY: 3.0, radius: 0.11, padWidth: 2.0, droop: 0.06 },
      { angle: 1.65, startY: 2.15, midR: 1.4, midY: 2.85, endR: 2.75, endY: 3.4, radius: 0.1, padWidth: 1.95, droop: 0.06 },
      { angle: 3.15, startY: 2.0, midR: 1.55, midY: 2.65, endR: 3.0, endY: 3.15, radius: 0.11, padWidth: 2.05, droop: 0.06 },
      { angle: 4.7, startY: 2.35, midR: 1.35, midY: 3.1, endR: 2.6, endY: 3.7, radius: 0.095, padWidth: 1.9, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 5.0, z: 0.0, width: 2.25, droop: 0.04 },
      { x: -1.1, y: 4.3, z: -0.7, width: 1.9, droop: 0.05 },
      { x: 1.1, y: 4.4, z: 0.7, width: 1.9, droop: 0.05 },
    ],
  },

  // 3. Cây phong tán tròn (Base height 7.4m)
  {
    id: "rounded",
    baseHeight: 7.4,
    trunkBaseR: 0.23,
    trunkTopR: 0.075,
    barkColors: [0x453327, 0x614939],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.9, 0.03],
      [-0.06, 1.9, -0.04],
      [0.02, 2.9, 0.02],
      [0.0, 3.8, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 1.8, midR: 1.25, midY: 2.4, endR: 2.3, endY: 3.0, radius: 0.095, padWidth: 1.85, droop: 0.08 },
      { angle: 1.95, startY: 2.0, midR: 1.2, midY: 2.7, endR: 2.2, endY: 3.3, radius: 0.09, padWidth: 1.8, droop: 0.08 },
      { angle: 3.5, startY: 1.9, midR: 1.3, midY: 2.5, endR: 2.35, endY: 3.1, radius: 0.095, padWidth: 1.85, droop: 0.08 },
      { angle: 5.05, startY: 2.15, midR: 1.15, midY: 2.85, endR: 2.15, endY: 3.5, radius: 0.085, padWidth: 1.75, droop: 0.07 },
    ],
    crownPads: [
      { x: 0.0, y: 4.6, z: 0.0, width: 2.1, droop: 0.05 },
      { x: -0.85, y: 4.0, z: 0.7, width: 1.8, droop: 0.06 },
      { x: 0.85, y: 4.1, z: -0.7, width: 1.8, droop: 0.06 },
    ],
  },

  // 4. Cây phong dáng rủ nhẹ (Base height 7.0m)
  {
    id: "weeping",
    baseHeight: 7.0,
    trunkBaseR: 0.22,
    trunkTopR: 0.075,
    barkColors: [0x472d22, 0x634030],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 0.95, -0.04],
      [0.15, 2.0, -0.08],
      [0.06, 3.0, -0.03],
      [-0.04, 3.8, 0.02],
    ],
    boughs: [
      { angle: 0.25, startY: 1.9, midR: 1.35, midY: 2.8, endR: 2.5, endY: 2.4, radius: 0.09, padWidth: 1.8, droop: 0.25 },
      { angle: 1.8, startY: 2.1, midR: 1.3, midY: 3.0, endR: 2.4, endY: 2.6, radius: 0.085, padWidth: 1.75, droop: 0.25 },
      { angle: 3.35, startY: 2.0, midR: 1.4, midY: 2.9, endR: 2.55, endY: 2.5, radius: 0.09, padWidth: 1.85, droop: 0.28 },
      { angle: 4.9, startY: 2.25, midR: 1.25, midY: 3.1, endR: 2.35, endY: 2.7, radius: 0.085, padWidth: 1.75, droop: 0.22 },
    ],
    crownPads: [
      { x: 0.0, y: 4.4, z: 0.0, width: 2.0, droop: 0.16 },
      { x: -0.9, y: 3.8, z: 0.6, width: 1.75, droop: 0.2 },
      { x: 0.9, y: 3.9, z: -0.6, width: 1.75, droop: 0.2 },
    ],
  },

  // 5. Cây phong thân cong nghệ thuật (Base height 6.4m)
  {
    id: "curved",
    baseHeight: 6.4,
    trunkBaseR: 0.2,
    trunkTopR: 0.07,
    barkColors: [0x4c372b, 0x6b4f3f],
    trunkCurve: [
      [0, 0, 0],
      [-0.18, 0.85, 0.1],
      [-0.26, 1.8, 0.14],
      [0.1, 2.7, -0.06],
      [0.2, 3.6, -0.1],
    ],
    boughs: [
      { angle: 0.5, startY: 1.7, midR: 1.2, midY: 2.2, endR: 2.2, endY: 2.6, radius: 0.085, padWidth: 1.7, droop: 0.08 },
      { angle: 2.4, startY: 2.05, midR: 1.15, midY: 2.65, endR: 2.1, endY: 3.05, radius: 0.08, padWidth: 1.65, droop: 0.06 },
      { angle: 4.3, startY: 2.4, midR: 1.2, midY: 3.0, endR: 2.15, endY: 3.4, radius: 0.075, padWidth: 1.65, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.18, y: 4.2, z: -0.1, width: 1.9, droop: 0.05 },
      { x: -0.75, y: 3.65, z: 0.5, width: 1.6, droop: 0.06 },
    ],
  },

  // 6. Cây phong nhỏ sát sân (Base height 5.2m)
  {
    id: "small",
    baseHeight: 5.2,
    trunkBaseR: 0.16,
    trunkTopR: 0.055,
    barkColors: [0x4a3324, 0x664834],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.7, -0.03],
      [-0.05, 1.5, 0.03],
      [0.02, 2.3, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.25, midR: 0.9, midY: 1.7, endR: 1.65, endY: 2.1, radius: 0.065, padWidth: 1.45, droop: 0.06 },
      { angle: 2.4, startY: 1.45, midR: 0.85, midY: 1.9, endR: 1.6, endY: 2.3, radius: 0.06, padWidth: 1.4, droop: 0.06 },
      { angle: 4.5, startY: 1.6, midR: 0.88, midY: 2.05, endR: 1.55, endY: 2.45, radius: 0.06, padWidth: 1.4, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.0, y: 3.0, z: 0.0, width: 1.65, droop: 0.04 },
    ],
  },
];

function buildArchetypeGeometry(spec: ArchetypeSpec, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  // 1. Smooth Catmull-Rom curved trunk with natural base flare
  const trunkPts = spec.trunkCurve.map(([x, y, z]) => new Vector3(x, y, z));
  barkParts.push(
    buildSmoothBranchTube(trunkPts, spec.trunkBaseR, spec.trunkTopR, 10, 8, spec.barkColors[0], spec.barkColors[1], true),
  );

  // 2. Smooth Catmull-Rom primary boughs & secundarios + sculpted foliage pads
  for (const b of spec.boughs) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.5, b.startY, sa * spec.trunkTopR * 0.5);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildSmoothBranchTube([p0, p1, p2], b.radius, b.radius * 0.28, 6, 6, spec.barkColors[0], spec.barkColors[1]),
    );

    // Main foliage cloud at the bough tip
    leafParts.push(
      buildSculptedFoliagePad(p2.x, p2.y + 0.08, p2.z, b.padWidth, b.droop, 5, rand),
    );

    // One secondary fork per bough for natural asymmetry without overcrowding
    const fAngle = b.angle + (rand() > 0.5 ? 0.52 : -0.52);
    const fReach = b.endR * 0.85;
    const fEndY = b.endY + 0.25 - b.droop * 0.25;
    const fp2 = new Vector3(Math.cos(fAngle) * fReach, fEndY, Math.sin(fAngle) * fReach);

    barkParts.push(
      buildSmoothBranchTube([p1, fp2], b.radius * 0.55, b.radius * 0.2, 4, 5, spec.barkColors[0], spec.barkColors[1]),
    );

    leafParts.push(
      buildSculptedFoliagePad(fp2.x, fp2.y + 0.06, fp2.z, b.padWidth * 0.82, b.droop, 4, rand),
    );
  }

  // 3. Upper crown pads
  for (const cp of spec.crownPads) {
    leafParts.push(buildSculptedFoliagePad(cp.x, cp.y, cp.z, cp.width, cp.droop, 5, rand));
  }

  const mergedBark = mergeGeometries(barkParts, false);
  const mergedLeaves = mergeGeometries(leafParts, false);
  for (const g of barkParts) g.dispose();
  for (const g of leafParts) g.dispose();
  if (!mergedBark || !mergedLeaves) throw new Error(`merge: archetype ${spec.id}`);

  const combined = mergeGeometries([mergedBark, mergedLeaves], true);
  mergedBark.dispose();
  mergedLeaves.dispose();
  if (!combined) throw new Error(`merge: combined archetype ${spec.id}`);

  combined.computeBoundingBox();
  const bbox = combined.boundingBox ?? new Box3();
  const rawH = Math.max(0.01, bbox.max.y - bbox.min.y);
  const scale = spec.baseHeight / rawH;
  combined.translate(0, -bbox.min.y, 0);
  combined.scale(scale, scale, scale);
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  return combined;
}

/**
 * Builds the Wishing Bodhi/Maple Tree geometry for `wishing-tree.ts`
 * (normalized to 7.6 m so the 36 red wishing plaques at y = 2.95..3.35 m hang directly beneath its boughs).
 */
function buildWishingTreeGeometry(): BufferGeometry {
  const rand = seeded(0xb0de99);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  const trunkPts = [
    new Vector3(0.0, 0.0, 0.0),
    new Vector3(0.06, 0.9, -0.04),
    new Vector3(-0.07, 1.85, 0.05),
    new Vector3(-0.02, 2.8, 0.02),
    new Vector3(0.0, 3.85, 0.0),
  ];
  barkParts.push(buildSmoothBranchTube(trunkPts, 0.34, 0.11, 10, 8, 0x452d1e, 0x63432e, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.65, 3.85 + (i % 2) * 0.18, sa * 2.65);
    barkParts.push(buildSmoothBranchTube([p0, p1, p2], 0.13, 0.04, 6, 6, 0x4a3121, 0x694732));

    leafParts.push(
      buildSculptedFoliagePad(p1.x, p1.y + 0.52, p1.z, 1.75, 0.05, 5, rand),
      buildSculptedFoliagePad(p2.x, p2.y + 0.35, p2.z, 1.85, 0.06, 5, rand),
    );
  }

  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.2;
    const cy = c === 0 ? 6.1 : 5.2;
    leafParts.push(buildSculptedFoliagePad(Math.cos(a) * rad, cy, Math.sin(a) * rad, 2.0, 0.04, 5, rand));
  }

  const mergedBark = mergeGeometries(barkParts, false);
  const mergedLeaves = mergeGeometries(leafParts, false);
  for (const g of barkParts) g.dispose();
  for (const g of leafParts) g.dispose();
  if (!mergedBark || !mergedLeaves) throw new Error("merge: wishing tree");

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
}

// ============================================================================
// AIRY 3-TIER STEPPED FOREST LAYOUT (WELL-SPACED, TALLER AT HORIZON -> SMALLER INWARD)
// ============================================================================

interface TreeInstanceRecord {
  variantIndex: number;
  matrix: Matrix4;
  color: Color;
}

function ringPoint(a: number, s: number): Vec2 {
  return { x: BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * s, z: BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * s };
}

interface SteppedRingConfig {
  readonly tier: number;
  readonly count: number;
  readonly ring: readonly [number, number];
  readonly heightRange: readonly [number, number];
  readonly spreadRange: readonly [number, number];
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
  readonly variants: readonly number[];
}

/**
 * 3 clean, well-spaced stepped tiers (~86 trees total instead of 204):
 * - Tier 3 (Horizon): 12.5m – 16.5m tall trees framing the distant horizon without overcrowding.
 * - Tier 2 (Midground): 8.5m – 11.2m tall trees staggered behind Tier 1.
 * - Tier 1 (Courtyard Edge): 5.2m – 7.4m graceful trees with plenty of breathing space (~13m apart).
 */
const STEPPED_RINGS: readonly SteppedRingConfig[] = [
  {
    tier: 3,
    count: IS_MOBILE ? 34 : 42,
    ring: [1.34, 1.56],
    heightRange: [12.5, 16.5],
    spreadRange: [1.08, 1.22],
    phaseOffset: 0.25,
    gateGapFactor: 0.5,
    variants: [0, 1, 2],
  },
  {
    tier: 2,
    count: IS_MOBILE ? 24 : 28,
    ring: [1.14, 1.26],
    heightRange: [8.5, 11.2],
    spreadRange: [1.02, 1.15],
    phaseOffset: 0.5,
    gateGapFactor: 0.8,
    variants: [1, 2, 3, 4],
  },
  {
    tier: 1,
    count: IS_MOBILE ? 16 : 18,
    ring: [1.02, 1.09],
    heightRange: [5.2, 7.4],
    spreadRange: [0.96, 1.08],
    phaseOffset: 0.0,
    gateGapFactor: 1.0,
    variants: [2, 3, 4, 5],
  },
];

function buildSteppedForestLayout(rand: () => number): TreeInstanceRecord[] {
  const records: TreeInstanceRecord[] = [];
  const tmpColor = new Color();
  let colorCounter = 0;
  let prevVariant = -1;

  const pickNonRepeatingVariant = (pool: readonly number[]): number => {
    let pick = pool[Math.floor(rand() * pool.length)] ?? 0;
    if (pool.length > 1 && pick === prevVariant) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length] ?? 0;
    }
    prevVariant = pick;
    return pick;
  };

  for (const cfg of STEPPED_RINGS) {
    const gap = GATE_GAP_RAD * cfg.gateGapFactor;
    const arc = Math.PI * 2 - 2 * gap;

    for (let k = 0; k < cfg.count; k++) {
      const slotPos = k + 0.5 + cfg.phaseOffset + (rand() - 0.5) * 0.22;
      const u = (((slotPos % cfg.count) + cfg.count) % cfg.count) / cfg.count;
      const a = Math.PI / 2 + gap + u * arc;

      const r = cfg.ring[0] + rand() * (cfg.ring[1] - cfg.ring[0]);
      const p = ringPoint(a, r);

      const vIdx = pickNonRepeatingVariant(cfg.variants);
      const spec = ARCHETYPE_SPECS[vIdx]!;

      const targetHeight = cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0]);
      const sy = targetHeight / spec.baseHeight;
      const spread = cfg.spreadRange[0] + rand() * (cfg.spreadRange[1] - cfg.spreadRange[0]);
      const sx = sy * spread * (0.95 + rand() * 0.1);
      const sz = sy * spread * (0.95 + rand() * 0.1);
      const yaw = (k * 1.6180339 + cfg.tier * 0.9 + rand() * 0.4) * Math.PI * 2;

      pickTreeFoliageColor(colorCounter++, cfg.tier, tmpColor);

      records.push({
        variantIndex: vIdx,
        matrix: place(p.x, 0, p.z, yaw, sx, sy, sz).clone(),
        color: tmpColor.clone(),
      });
    }
  }

  return records;
}

// ============================================================================
// COURTYARD PATH, LANTERNS, ROCKS & GATE
// ============================================================================

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

const ROCK_BULGE = 1.24;

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

  // 1. Build shared PBR Bark & Crisp 5-Lobed Maple Sprig Foliage materials.
  const mapleLeafTex = drawCrispMapleSprigTexture(1024);
  const mapleBarkMat = own(
    new MeshStandardMaterial({
      map: materials.wood.map,
      normalMap: materials.wood.normalMap,
      roughnessMap: materials.wood.roughnessMap,
      normalScale: new Vector2(1.2, 1.2),
      vertexColors: true,
      color: new Color(0xa6866c),
      roughness: 0.88,
      metalness: 0.0,
    }),
  );
  attachMapleBarkShader(mapleBarkMat, uTreeTime);

  const mapleFoliageMat = own(
    new MeshStandardMaterial({
      map: mapleLeafTex,
      vertexColors: true,
      color: new Color(0xffffff),
      alphaTest: 0.35,
      transparent: false,
      roughness: 0.75,
      metalness: 0.0,
      emissive: new Color(0x141c0c),
      emissiveIntensity: 0.05,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 6 smooth Catmull-Rom Tree Archetypes + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Bodhi/Maple Tree (warm golden crown) outside the gate.
  const wishTreeFoliageMat = own(mapleFoliageMat.clone());
  wishTreeFoliageMat.color.setHex(0xf2b42e);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the airy 3-tier Stepped Forest.
  const allRecords = buildSteppedForestLayout(rand);
  const byVariant: TreeInstanceRecord[][] = Array.from({ length: ARCHETYPE_SPECS.length }, () => []);
  for (const rec of allRecords) {
    byVariant[rec.variantIndex]?.push(rec);
  }

  const forest: InstancedMesh[] = [];
  variantGeos.forEach((geo, vIdx) => {
    const list = byVariant[vIdx] ?? [];
    if (list.length === 0) return;
    const spec = ARCHETYPE_SPECS[vIdx]!;
    const mesh = new InstancedMesh(geo, mapleMats, list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !IS_MOBILE && (vIdx === 2 || vIdx === 4 || vIdx === 5);
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius += 5.0;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `maple-archetype:${spec.id}`;
    scene.add(mesh);
    forest.push(mesh);
  });

  registerCameraPreset("gate", { position: [0, 2.4, 36], target: [0, 2.6, 46] });
  registerCameraPreset("overview", { position: [0, 75, 100], target: [0, 0, 10] });

  return {
    lanterns: { stone, lotus },
    update(daylight) {
      uTreeTime.value = performance.now() * 0.001;
      const k = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * (1 - daylight);
      lanternPaper.emissiveIntensity = k;
      lotusLamp.emissiveIntensity = k;
      const leafEmissive = 0.04 + 0.06 * daylight;
      mapleFoliageMat.emissiveIntensity = leafEmissive;
      wishTreeFoliageMat.emissiveIntensity = leafEmissive;
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
      for (const g of variantGeos) g.dispose();
      wishTreeGeo.dispose();
      mapleLeafTex.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
