import {
  AdditiveBlending,
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
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
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
const GATE_GAP_RAD = 0.23;

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
// NATURAL TEMPLE FOREST PALETTE (GREEN, CHARTREUSE, GOLDEN YELLOW, WARM ORANGE, SOFT RED)
// ============================================================================

/**
 * Balanced 20-slot palette interleaving Green, Golden-Yellow, Chartreuse, Warm Orange, and Soft Maple Red:
 * - 30% Xanh lá cổ thụ & xanh non (Lush Banyan/Temple Green & Fresh Leaf Green)
 * - 30% Vàng thu & vàng nõn chuối (Golden Yellow, Bright Amber & Chartreuse)
 * - 20% Vàng cam ấm (Warm Apricot & Autumn Orange)
 * - 20% Hơi đỏ / Đỏ phong dịu (Soft Temple Crimson & Coral Maple Red)
 */
const TEMPLE_FOREST_PALETTE: readonly number[] = [
  0x488a38, // Xanh lá cổ thụ tươi
  0xedb52a, // Vàng thu sáng
  0xc9422e, // Đỏ phong dịu
  0x64a840, // Xanh lá non
  0xf5c83b, // Vàng rực ấm
  0xe68228, // Vàng cam
  0x3d7830, // Xanh rừng trầm
  0xa8d142, // Vàng nõn chuối / xanh cốm
  0xd45234, // Đỏ cam dịu
  0xf0a82e, // Vàng hổ phách
  0x52963c, // Xanh bồ đề
  0xe37026, // Cam thu ấm
  0x96c43e, // Xanh vàng nõn chuối
  0xb83828, // Đỏ trầm vừa phải
  0xf2be35, // Vàng nghệ sáng
  0x438034, // Xanh cổ thụ
  0xde5c2c, // Hơi đỏ cam
  0x72b043, // Xanh lá sáng
  0xeb982a, // Vàng cam dịu
  0xc44530, // Đỏ lá phong dịu
];

function pickTreeFoliageColor(index: number, ringTier: number, out: Color): Color {
  const step = (index * 3 + ringTier * 5) % TEMPLE_FOREST_PALETTE.length;
  const baseHex = TEMPLE_FOREST_PALETTE[step] ?? 0x488a38;
  out.setHex(baseHex);

  // Subtle atmospheric harmony on the farthest horizon tier so giant trees blend naturally with the sky haze
  if (ringTier >= 4) {
    out.lerp(new Color(0x9ab598), 0.14);
  }
  return out;
}

// ============================================================================
// SHADERS: GENTLE BREEZE & NATURAL 3-TONE SUNLIT CANOPY DEPTH
// ============================================================================

/**
 * Bark shader:
 * - Ignores the per-instance foliage `instanceColor` so trunks stay natural dark/reddish/grey-brown wood.
 * - Applies a slow, gentle asynchronous branch sway.
 */
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
        float branchWeight = clamp((transformed.y - 1.2) * 0.16, 0.0, 1.0);
        float treePhase = treePos.x * 0.37 + treePos.y * 0.53;
        float boughSway = branchWeight * 0.02 * sin(uTime * 1.0 + treePhase + transformed.x * 0.45);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Foliage shader:
 * - Preserves outward-domed normals on both sides of `DoubleSide` leaf cards so backfaces never turn dark.
 * - Preserves true Green, Yellow, Orange, and Soft Red hues while adding 3-tone canopy depth:
 *   + Sun-facing upper crown (`vSunShift`): warm sunlit highlight.
 *   + Shaded lower/inner crown (`vShadeShift`): rich natural ambient occlusion.
 */
function attachMapleFoliageShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying float vSunShift;\nvarying float vShadeShift;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float heightNorm = clamp((transformed.y - 1.0) / 5.5, 0.0, 1.0);
        float sunSide = clamp(
          dot(normalize( vec3(transformed.x, max(0.2, transformed.y - 1.2), transformed.z) ), vec3(0.45, 0.80, 0.35)),
          0.0,
          1.0
        );
        vSunShift = clamp(heightNorm * 0.55 + sunSide * 0.55, 0.0, 1.0);
        vShadeShift = clamp((1.0 - heightNorm) * 0.65 + (1.0 - sunSide) * 0.35, 0.0, 1.0);

        float swayWeight = clamp((transformed.y - 1.0) * 0.2, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 1.1 + transformed.z * 1.0 + transformed.y * 0.65;
        float swayX = swayWeight * (0.028 * sin(uTime * 1.1 + treePhase + clusterPhase) + 0.012 * cos(uTime * 2.0 - clusterPhase));
        float swayZ = swayWeight * (0.022 * cos(uTime * 1.0 + treePhase * 1.3 + clusterPhase));
        transformed.x += swayX;
        transformed.y += (swayX + swayZ) * 0.1;
        transformed.z += swayZ;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vSunShift;\nvarying float vShadeShift;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Hue-preserving 3-tone canopy depth (works for Green, Yellow, Orange, and Soft Red alike!)
        vec3 deepCanopyShade = diffuseColor.rgb * vec3(0.58, 0.62, 0.54);
        vec3 sunlitCrown = mix(diffuseColor.rgb * 1.22, vec3(1.0, 0.94, 0.68), 0.20);
        diffuseColor.rgb = mix(diffuseColor.rgb, deepCanopyShade, vShadeShift * 0.44);
        diffuseColor.rgb = mix(diffuseColor.rgb, sunlitCrown, vSunShift * 0.48);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight += diffuseColor.rgb * (0.08 + 0.15 * vSunShift);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// HIGH-DETAIL BOTANICAL LEAF CLUSTER TEXTURE (`1024x1024` — 90+ REALISTIC LEAVES)
// ============================================================================

/**
 * Draws a rich, high-resolution 1024x1024 botanical branchlet cluster with 90+ overlapping
 * realistic leaves (both 5–7 lobed Maple leaves and heart-shaped Bodhi/Banyan leaves with
 * crisp serrated margins, petioles, midribs, and lateral veins).
 * Full coverage in the cluster core ensures canopies look lush and thick, while individual
 * leaves stand out crisply around the edges when viewed up close!
 */
function drawRealisticFoliageClusterTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0x88f01a2);

  // 1. Woody branchlet skeleton inside the cluster
  ctx.strokeStyle = "#3d2415";
  ctx.lineCap = "round";
  const twigs: readonly [number, number, number, number, number, number, number][] = [
    [0.5, 0.9, 0.49, 0.52, 0.5, 0.12, 0.008],
    [0.49, 0.72, 0.3, 0.62, 0.12, 0.48, 0.006],
    [0.5, 0.68, 0.7, 0.58, 0.88, 0.44, 0.006],
    [0.49, 0.5, 0.28, 0.38, 0.14, 0.24, 0.005],
    [0.5, 0.46, 0.72, 0.34, 0.86, 0.22, 0.005],
  ];
  for (const [x0, y0, cx, cy, x1, y1, w] of twigs) {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * cx, size * cy, size * x1, size * y1);
    ctx.stroke();
  }

  /**
   * Draws a detailed, realistic serrated botanical leaf (alternating between 5-lobed palmate
   * and sacred Bodhi/ovate-serrated leaves for rich organic texture).
   */
  const drawDetailedLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    kind: "palmate" | "ovate",
    innerLum: string,
    outerLum: string,
    tipLum: string,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Petiole stem
    ctx.strokeStyle = "#54321c";
    ctx.lineWidth = Math.max(1.2, radius * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.48);
    ctx.quadraticCurveTo(radius * 0.03, radius * 0.26, 0, radius * 0.06);
    ctx.stroke();

    if (kind === "palmate") {
      const lobeAngles = [-1.52, -0.76, 0, 0.76, 1.52] as const;
      const lobeLengths = [0.68, 0.94, 1.12, 0.94, 0.68] as const;
      const lobeWidths = [0.19, 0.23, 0.25, 0.23, 0.19] as const;

      ctx.beginPath();
      ctx.moveTo(0, radius * 0.14);

      for (let i = 0; i < lobeAngles.length; i++) {
        const a = lobeAngles[i]! - Math.PI * 0.5;
        const len = radius * lobeLengths[i]!;
        const wid = radius * lobeWidths[i]!;
        const perp = a + Math.PI * 0.5;

        const tipX = Math.cos(a) * len;
        const tipY = Math.sin(a) * len;

        const l1x = Math.cos(a) * (len * 0.42) - Math.cos(perp) * (wid * 0.85);
        const l1y = Math.sin(a) * (len * 0.42) - Math.sin(perp) * (wid * 0.85);
        const l2x = Math.cos(a) * (len * 0.76) - Math.cos(perp) * (wid * 0.52);
        const l2y = Math.sin(a) * (len * 0.76) - Math.sin(perp) * (wid * 0.52);

        const r2x = Math.cos(a) * (len * 0.76) + Math.cos(perp) * (wid * 0.52);
        const r2y = Math.sin(a) * (len * 0.76) + Math.sin(perp) * (wid * 0.52);
        const r1x = Math.cos(a) * (len * 0.42) + Math.cos(perp) * (wid * 0.85);
        const r1y = Math.sin(a) * (len * 0.42) + Math.sin(perp) * (wid * 0.85);

        ctx.lineTo(l1x, l1y);
        ctx.lineTo(l2x, l2y);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(r2x, r2y);
        ctx.lineTo(r1x, r1y);

        if (i < lobeAngles.length - 1) {
          const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
          const midA = (a + nextA) * 0.5;
          const notchR = radius * 0.34;
          ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
        }
      }
      ctx.closePath();

      const grad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.16, radius * 1.08);
      grad.addColorStop(0, innerLum);
      grad.addColorStop(0.65, outerLum);
      grad.addColorStop(1, tipLum);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = Math.max(1.3, radius * 0.028);
      ctx.strokeStyle = "rgba(48, 34, 20, 0.64)";
      ctx.stroke();

      // Crisp palmate primary & secondary veins
      ctx.strokeStyle = "rgba(255, 252, 238, 0.55)";
      ctx.lineWidth = Math.max(1.0, radius * 0.02);
      for (let i = 0; i < lobeAngles.length; i++) {
        const a = lobeAngles[i]! - Math.PI * 0.5;
        const len = radius * lobeLengths[i]! * 0.86;
        ctx.beginPath();
        ctx.moveTo(0, radius * 0.08);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.stroke();
      }
    } else {
      // Realistic serrated Temple Bodhi / Elm leaf with drip-tip apex and lateral pinnate veins
      const w = radius * 0.62;
      const h = radius * 1.12;
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.22);
      ctx.bezierCurveTo(-w * 0.95, radius * 0.2, -w * 1.05, -h * 0.35, -w * 0.45, -h * 0.72);
      ctx.quadraticCurveTo(-w * 0.12, -h * 0.92, 0, -h * 1.08);
      ctx.quadraticCurveTo(w * 0.12, -h * 0.92, w * 0.45, -h * 0.72);
      ctx.bezierCurveTo(w * 1.05, -h * 0.35, w * 0.95, radius * 0.2, 0, radius * 0.22);
      ctx.closePath();

      const grad = ctx.createLinearGradient(-w * 0.5, radius * 0.2, w * 0.5, -h);
      grad.addColorStop(0, innerLum);
      grad.addColorStop(0.6, outerLum);
      grad.addColorStop(1, tipLum);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = Math.max(1.3, radius * 0.028);
      ctx.strokeStyle = "rgba(48, 34, 20, 0.64)";
      ctx.stroke();

      // Central midrib & 4 pairs of arched lateral veins
      ctx.strokeStyle = "rgba(255, 252, 238, 0.58)";
      ctx.lineWidth = Math.max(1.1, radius * 0.022);
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.18);
      ctx.lineTo(0, -h * 0.94);
      ctx.stroke();

      ctx.lineWidth = Math.max(0.9, radius * 0.015);
      for (let v = 1; v <= 4; v++) {
        const vy = radius * 0.05 - (v / 4.6) * h * 0.85;
        const vw = w * (1 - v * 0.16) * 0.78;
        ctx.beginPath();
        ctx.moveTo(0, vy);
        ctx.quadraticCurveTo(-vw * 0.55, vy - h * 0.05, -vw, vy - h * 0.14);
        ctx.moveTo(0, vy);
        ctx.quadraticCurveTo(vw * 0.55, vy - h * 0.05, vw, vy - h * 0.14);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  // Layer 1: 32 deep-canopy shadow leaves filling the interior so the cluster is lush and never sparse
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    const d = Math.sqrt(rand()) * 0.34 * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.5 + Math.sin(a) * d;
    const r = (0.11 + rand() * 0.04) * size;
    drawDetailedLeaf(
      lx,
      ly,
      r,
      a + Math.PI * 0.5 + (rand() - 0.5) * 0.6,
      i % 2 === 0 ? "palmate" : "ovate",
      "#8c8274",
      "#aba090",
      "#7a7062",
    );
  }

  // Layer 2: 34 mid-tone botanical leaves spreading out to the branchlet tips
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + 0.12 + (rand() - 0.5) * 0.24;
    const d = (0.12 + rand() * 0.28) * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.49 + Math.sin(a) * d;
    const r = (0.105 + rand() * 0.038) * size;
    drawDetailedLeaf(
      lx,
      ly,
      r,
      a + Math.PI * 0.5 + (rand() - 0.5) * 0.5,
      i % 3 === 0 ? "ovate" : "palmate",
      "#bfb5a6",
      "#dcd3c4",
      "#f0e9dc",
    );
  }

  // Layer 3: 26 crisp, sunlit foreground leaves with sharp veins & serrated tips
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.25 + (rand() - 0.5) * 0.2;
    const d = (0.06 + rand() * 0.3) * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.48 + Math.sin(a) * d;
    const r = (0.1 + rand() * 0.036) * size;
    drawDetailedLeaf(
      lx,
      ly,
      r,
      a + Math.PI * 0.5 + (rand() - 0.5) * 0.45,
      i % 2 === 0 ? "palmate" : "ovate",
      "#dfd7c8",
      "#f7f2e8",
      "#ffffff",
    );
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// LUSH VOLUMETRIC 3D TREE BUILDERS (8 ARCHETYPES, DENSE CANOPIES)
// ============================================================================

function buildCurvedBranchSegment(
  points: readonly Vector3[],
  radii: readonly number[],
  radialSegs: number,
  baseHex: number,
  topHex: number,
  fluted = false,
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

    const rBase = radii[i]!;
    const tFrac = i / Math.max(1, rings - 1);
    cTmp.lerpColors(c0, c1, tFrac);

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

      const flute = fluted ? 1 + 0.1 * (1 - tFrac * 0.7) * Math.sin(theta * 5 + tFrac * 3.0) : 1;
      const r = rBase * flute;

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

      uv[idx * 2] = uFrac * 2.2;
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

function buildArchedLeafFrond(
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
  tierCenter: Vector3,
): BufferGeometry {
  const cIn = new Color(innerHex);
  const cOut = new Color(outerHex);

  const localPos = new Float32Array([
    -0.55, -0.05, -0.55,
    0.55, -0.05, -0.55,
    0.55, -0.05, 0.55,
    -0.55, -0.05, 0.55,
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
    const vx = posAttr.getX(i) - tierCenter.x;
    const vy = posAttr.getY(i) - tierCenter.y + 0.5;
    const vz = posAttr.getZ(i) - tierCenter.z;
    const len = Math.hypot(vx, vy, vz) || 1;
    nrmArr[i * 3] = vx / len;
    nrmArr[i * 3 + 1] = vy / len;
    nrmArr[i * 3 + 2] = vz / len;
  }
  g.setAttribute("normal", new Float32BufferAttribute(nrmArr, 3));
  return g;
}

/**
 * Builds a lush, dense, multi-layered 3D Canopy Cloud ("vòm tán lá cổ thụ dày nhiều lớp"):
 * Combines 11 to 13 overlapping 3D arched leaf fronds at varied pitches (from horizontal crown domes
 * to 42°skirt fronds) so the canopy is rich, full-bodied, and blocks the background fog while keeping
 * natural organic leaf edges.
 */
function buildLushCanopyCloud(
  cx: number,
  cy: number,
  cz: number,
  width: number,
  droop: number,
  frondCount: number,
  rand: () => number,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const shHex = 0x786e62;
  const mdHex = 0xdad2c5;
  const brHex = 0xfffefa;

  // 1. Dense inner core cross-domes (3 intersecting pitched fronds so the centre is never hollow)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand() * 0.5;
    const d = width * (0.12 + rand() * 0.1);
    const s = width * (0.95 + rand() * 0.18);
    parts.push(
      buildArchedLeafFrond(
        cx + Math.cos(a) * d,
        cy - 0.06 - droop * 0.1,
        cz + Math.sin(a) * d,
        s,
        s * 0.95,
        0.2,
        a,
        0.38 + droop * 0.25,
        (rand() - 0.5) * 0.25,
        shHex,
        mdHex,
        center,
      ),
    );
  }

  // 2. Outer shingled skirt & radiating branchlet sprays (6–8 fronds around the perimeter)
  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const isProtruding = i % 2 === 0;
    const reach = width * (isProtruding ? 0.44 + rand() * 0.18 : 0.28 + rand() * 0.14);
    const s = width * (isProtruding ? 0.86 + rand() * 0.2 : 0.94 + rand() * 0.18);
    const dy = (isProtruding ? -0.05 : 0.1) - droop * (0.16 + rand() * 0.12) + (rand() - 0.5) * 0.06;
    const pitch = 0.42 + droop * 0.35 + (rand() - 0.5) * 0.16;

    parts.push(
      buildArchedLeafFrond(
        cx + Math.cos(a) * reach,
        cy + dy,
        cz + Math.sin(a) * reach,
        s,
        s * (0.92 + rand() * 0.16),
        0.22,
        a + (rand() - 0.5) * 0.25,
        pitch,
        (rand() - 0.5) * 0.24,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  // 3. Upper sunlit crown cap (2 overlapping arched domes on top)
  for (let i = 0; i < 2; i++) {
    const a = i * 1.57 + rand() * 0.8;
    const topS = width * (0.88 + rand() * 0.18);
    parts.push(
      buildArchedLeafFrond(
        cx + (rand() - 0.5) * 0.14,
        cy + 0.24 + i * 0.08,
        cz + (rand() - 0.5) * 0.14,
        topS,
        topS,
        0.22,
        a,
        0.18 + (rand() - 0.5) * 0.14,
        (rand() - 0.5) * 0.18,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: lush canopy cloud");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"   // 1. Đại thụ chân trời & hậu cảnh (thân lớn, tán cực rộng nhiều tầng)
  | "spreading" // 2. Cổ thụ tán xòe rộng (cành vươn ngang dày tán)
  | "rounded"   // 3. Cổ thụ tán vòm tròn nhiều tầng
  | "weeping"   // 4. Cổ thụ dáng rủ mềm mại
  | "curved"    // 5. Cây thân cong nghệ thuật (nhìn rõ đường cong thân gỗ)
  | "small"     // 6. Cây cảnh tầm trung (sát sân chùa, lá cực chi tiết)
  | "airy"      // 7. Cây cảnh nhiều nhánh (sát sân chùa, lộ rõ cành & cụm lá)
  | "shrub";    // 8. Cây tán thấp / bụi lớn (lấp chân rừng & mép sân)

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
    readonly subForks: number;
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
  // 1. Đại thụ (Base height 12.5m; scaled up to 22–29m on the horizon ring!)
  {
    id: "ancient",
    baseHeight: 12.5,
    trunkBaseR: 0.48,
    trunkTopR: 0.16,
    barkColors: [0x3b2618, 0x5c3d28],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 1.3, -0.06],
      [-0.12, 2.8, 0.08],
      [-0.04, 4.4, 0.02],
      [0.05, 6.0, -0.04],
    ],
    boughs: [
      { angle: 0.15, startY: 2.2, midR: 2.3, midY: 3.4, endR: 4.5, endY: 4.2, radius: 0.2, padWidth: 3.1, droop: 0.1, subForks: 2 },
      { angle: 1.4, startY: 2.5, midR: 2.1, midY: 3.8, endR: 4.2, endY: 4.7, radius: 0.18, padWidth: 2.95, droop: 0.08, subForks: 2 },
      { angle: 2.65, startY: 2.3, midR: 2.4, midY: 3.5, endR: 4.6, endY: 4.4, radius: 0.2, padWidth: 3.15, droop: 0.1, subForks: 2 },
      { angle: 3.9, startY: 2.8, midR: 2.0, midY: 4.2, endR: 4.0, endY: 5.2, radius: 0.17, padWidth: 2.85, droop: 0.06, subForks: 2 },
      { angle: 5.15, startY: 3.1, midR: 1.9, midY: 4.6, endR: 3.8, endY: 5.7, radius: 0.16, padWidth: 2.8, droop: 0.06, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 7.8, z: 0.0, width: 3.4, droop: 0.05 },
      { x: -1.9, y: 6.8, z: 1.3, width: 2.9, droop: 0.06 },
      { x: 1.9, y: 6.9, z: -1.3, width: 2.9, droop: 0.06 },
      { x: -1.4, y: 6.7, z: -1.6, width: 2.75, droop: 0.06 },
      { x: 1.5, y: 6.8, z: 1.5, width: 2.75, droop: 0.06 },
    ],
  },

  // 2. Cổ thụ tán xòe rộng (Base height 9.5m)
  {
    id: "spreading",
    baseHeight: 9.5,
    trunkBaseR: 0.34,
    trunkTopR: 0.11,
    barkColors: [0x4a2c1d, 0x694330],
    trunkCurve: [
      [0, 0, 0],
      [-0.07, 1.0, 0.05],
      [0.11, 2.1, -0.06],
      [0.06, 3.3, -0.03],
      [-0.04, 4.4, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 1.8, midR: 2.1, midY: 2.5, endR: 4.1, endY: 3.0, radius: 0.15, padWidth: 2.75, droop: 0.08, subForks: 2 },
      { angle: 1.65, startY: 2.1, midR: 1.95, midY: 2.9, endR: 3.9, endY: 3.5, radius: 0.14, padWidth: 2.65, droop: 0.08, subForks: 2 },
      { angle: 3.15, startY: 1.95, midR: 2.15, midY: 2.7, endR: 4.2, endY: 3.2, radius: 0.15, padWidth: 2.8, droop: 0.08, subForks: 2 },
      { angle: 4.7, startY: 2.35, midR: 1.85, midY: 3.3, endR: 3.7, endY: 4.0, radius: 0.13, padWidth: 2.55, droop: 0.06, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 5.5, z: 0.0, width: 3.0, droop: 0.05 },
      { x: -1.6, y: 4.7, z: -1.0, width: 2.5, droop: 0.06 },
      { x: 1.6, y: 4.8, z: 1.0, width: 2.5, droop: 0.06 },
      { x: 0.0, y: 4.6, z: 1.7, width: 2.4, droop: 0.06 },
    ],
  },

  // 3. Cổ thụ tán vòm tròn nhiều tầng (Base height 8.5m)
  {
    id: "rounded",
    baseHeight: 8.5,
    trunkBaseR: 0.28,
    trunkTopR: 0.095,
    barkColors: [0x423126, 0x5e4738],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.9, 0.03],
      [-0.06, 2.0, -0.04],
      [0.02, 3.1, 0.02],
      [0.0, 4.1, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 1.7, midR: 1.55, midY: 2.5, endR: 2.9, endY: 3.1, radius: 0.12, padWidth: 2.4, droop: 0.1, subForks: 2 },
      { angle: 1.95, startY: 1.9, midR: 1.5, midY: 2.8, endR: 2.8, endY: 3.4, radius: 0.11, padWidth: 2.35, droop: 0.1, subForks: 2 },
      { angle: 3.5, startY: 1.8, midR: 1.6, midY: 2.6, endR: 3.0, endY: 3.2, radius: 0.12, padWidth: 2.45, droop: 0.1, subForks: 2 },
      { angle: 5.05, startY: 2.1, midR: 1.45, midY: 3.0, endR: 2.7, endY: 3.7, radius: 0.11, padWidth: 2.3, droop: 0.08, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 5.0, z: 0.0, width: 2.65, droop: 0.06 },
      { x: -1.1, y: 4.3, z: 0.9, width: 2.3, droop: 0.08 },
      { x: 1.1, y: 4.4, z: -0.9, width: 2.3, droop: 0.08 },
    ],
  },

  // 4. Cổ thụ dáng rủ (Base height 8.0m)
  {
    id: "weeping",
    baseHeight: 8.0,
    trunkBaseR: 0.26,
    trunkTopR: 0.09,
    barkColors: [0x472b20, 0x633e2f],
    trunkCurve: [
      [0, 0, 0],
      [0.09, 1.0, -0.05],
      [0.18, 2.1, -0.1],
      [0.08, 3.2, -0.04],
      [-0.05, 4.1, 0.03],
    ],
    boughs: [
      { angle: 0.25, startY: 1.9, midR: 1.75, midY: 3.0, endR: 3.2, endY: 2.3, radius: 0.11, padWidth: 2.35, droop: 0.42, subForks: 2 },
      { angle: 1.8, startY: 2.1, midR: 1.65, midY: 3.2, endR: 3.1, endY: 2.5, radius: 0.1, padWidth: 2.3, droop: 0.42, subForks: 2 },
      { angle: 3.35, startY: 2.0, midR: 1.8, midY: 3.1, endR: 3.3, endY: 2.4, radius: 0.11, padWidth: 2.4, droop: 0.45, subForks: 2 },
      { angle: 4.9, startY: 2.3, midR: 1.6, midY: 3.4, endR: 3.0, endY: 2.7, radius: 0.1, padWidth: 2.25, droop: 0.38, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 4.7, z: 0.0, width: 2.5, droop: 0.28 },
      { x: -1.2, y: 4.0, z: 0.7, width: 2.2, droop: 0.35 },
      { x: 1.2, y: 4.1, z: -0.8, width: 2.2, droop: 0.35 },
    ],
  },

  // 5. Cây thân cong nghệ thuật (Base height 7.2m — inner courtyard ring)
  {
    id: "curved",
    baseHeight: 7.2,
    trunkBaseR: 0.24,
    trunkTopR: 0.08,
    barkColors: [0x4c372b, 0x6b4f3f],
    trunkCurve: [
      [0, 0, 0],
      [-0.22, 0.9, 0.12],
      [-0.32, 1.9, 0.18],
      [0.14, 2.9, -0.08],
      [0.24, 3.9, -0.14],
    ],
    boughs: [
      { angle: 0.5, startY: 1.7, midR: 1.5, midY: 2.3, endR: 2.7, endY: 2.7, radius: 0.1, padWidth: 2.15, droop: 0.1, subForks: 2 },
      { angle: 2.4, startY: 2.1, midR: 1.4, midY: 2.8, endR: 2.6, endY: 3.2, radius: 0.095, padWidth: 2.1, droop: 0.08, subForks: 2 },
      { angle: 4.3, startY: 2.5, midR: 1.45, midY: 3.2, endR: 2.65, endY: 3.6, radius: 0.09, padWidth: 2.1, droop: 0.08, subForks: 2 },
    ],
    crownPads: [
      { x: 0.22, y: 4.5, z: -0.14, width: 2.35, droop: 0.06 },
      { x: -0.9, y: 3.9, z: 0.6, width: 2.0, droop: 0.08 },
    ],
  },

  // 6. Cây cảnh tầm trung sát sân (Base height 5.8m — crisp detailed leaves close to player)
  {
    id: "small",
    baseHeight: 5.8,
    trunkBaseR: 0.19,
    trunkTopR: 0.065,
    barkColors: [0x4a3324, 0x664834],
    trunkCurve: [
      [0, 0, 0],
      [0.06, 0.75, -0.04],
      [-0.06, 1.6, 0.03],
      [0.03, 2.5, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.3, midR: 1.1, midY: 1.8, endR: 2.0, endY: 2.2, radius: 0.08, padWidth: 1.75, droop: 0.08, subForks: 2 },
      { angle: 2.4, startY: 1.5, midR: 1.05, midY: 2.0, endR: 1.95, endY: 2.4, radius: 0.075, padWidth: 1.7, droop: 0.08, subForks: 2 },
      { angle: 4.5, startY: 1.65, midR: 1.08, midY: 2.15, endR: 1.9, endY: 2.6, radius: 0.075, padWidth: 1.7, droop: 0.08, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 3.2, z: 0.0, width: 1.95, droop: 0.05 },
      { x: -0.65, y: 2.85, z: 0.5, width: 1.65, droop: 0.06 },
    ],
  },

  // 7. Cây cảnh nhiều nhánh sát sân (Base height 6.6m — intricate branch structure & detailed leaf clusters)
  {
    id: "airy",
    baseHeight: 6.6,
    trunkBaseR: 0.22,
    trunkTopR: 0.075,
    barkColors: [0x3d281c, 0x5c3f2e],
    trunkCurve: [
      [0, 0, 0],
      [0.1, 1.0, 0.06],
      [-0.08, 2.1, -0.05],
      [-0.12, 3.1, -0.07],
      [0.04, 4.0, 0.02],
    ],
    boughs: [
      { angle: 0.15, startY: 1.6, midR: 1.55, midY: 2.3, endR: 2.85, endY: 2.8, radius: 0.095, padWidth: 1.85, droop: 0.06, subForks: 2 },
      { angle: 1.75, startY: 1.9, midR: 1.45, midY: 2.7, endR: 2.7, endY: 3.3, radius: 0.09, padWidth: 1.8, droop: 0.06, subForks: 2 },
      { angle: 3.3, startY: 1.75, midR: 1.6, midY: 2.5, endR: 2.95, endY: 3.0, radius: 0.095, padWidth: 1.85, droop: 0.06, subForks: 2 },
      { angle: 4.85, startY: 2.2, midR: 1.4, midY: 3.0, endR: 2.6, endY: 3.6, radius: 0.085, padWidth: 1.75, droop: 0.06, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 4.4, z: 0.0, width: 2.05, droop: 0.05 },
      { x: 0.85, y: 3.9, z: -0.65, width: 1.75, droop: 0.06 },
    ],
  },

  // 8. Cây tán thấp / Bụi phong lớn (Base height 4.2m — low foreground tier)
  {
    id: "shrub",
    baseHeight: 4.2,
    trunkBaseR: 0.15,
    trunkTopR: 0.05,
    barkColors: [0x453022, 0x5e4332],
    trunkCurve: [
      [0, 0, 0],
      [0.04, 0.5, -0.03],
      [-0.03, 1.1, 0.02],
      [0.0, 1.7, 0.0],
    ],
    boughs: [
      { angle: 0.5, startY: 0.45, midR: 0.9, midY: 0.95, endR: 1.75, endY: 1.4, radius: 0.065, padWidth: 1.65, droop: 0.14, subForks: 2 },
      { angle: 2.6, startY: 0.5, midR: 0.88, midY: 1.0, endR: 1.7, endY: 1.5, radius: 0.065, padWidth: 1.65, droop: 0.14, subForks: 2 },
      { angle: 4.7, startY: 0.48, midR: 0.92, midY: 0.98, endR: 1.78, endY: 1.45, radius: 0.065, padWidth: 1.65, droop: 0.14, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 2.1, z: 0.0, width: 1.85, droop: 0.08 },
    ],
  },
];

function buildArchetypeGeometry(spec: ArchetypeSpec, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  // 1. Curved trunk with flared base
  const trunkPts = spec.trunkCurve.map(([x, y, z]) => new Vector3(x, y, z));
  const n = trunkPts.length;
  const trunkRadii = trunkPts.map((_, i) => {
    const t = i / Math.max(1, n - 1);
    const flare = i === 0 ? 1.35 : 1.0;
    return (spec.trunkBaseR * (1 - t) + spec.trunkTopR * t) * flare;
  });
  barkParts.push(
    buildCurvedBranchSegment(trunkPts, trunkRadii, spec.id === "ancient" ? 6 : 5, spec.barkColors[0], spec.barkColors[1], true),
  );

  // Flared root buttresses for large trees
  if (spec.id === "ancient" || spec.id === "spreading") {
    const rootCount = 4;
    for (let r = 0; r < rootCount; r++) {
      const a = (r / rootCount) * Math.PI * 2 + 0.4;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rPts = [
        new Vector3(ca * spec.trunkBaseR * 0.45, 0.7, sa * spec.trunkBaseR * 0.45),
        new Vector3(ca * spec.trunkBaseR * 1.15, 0.28, sa * spec.trunkBaseR * 1.15),
        new Vector3(ca * spec.trunkBaseR * 1.8, 0.0, sa * spec.trunkBaseR * 1.8),
      ];
      barkParts.push(
        buildCurvedBranchSegment(
          rPts,
          [spec.trunkBaseR * 0.42, spec.trunkBaseR * 0.28, spec.trunkBaseR * 0.12],
          4,
          spec.barkColors[0],
          spec.barkColors[1],
        ),
      );
    }
  }

  // 2. Primary boughs, secondary forks, and lush multi-layered foliage clouds
  for (const b of spec.boughs) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.6, b.startY, sa * spec.trunkTopR * 0.6);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildCurvedBranchSegment([p0, p1, p2], [b.radius, b.radius * 0.68, b.radius * 0.34], 4, spec.barkColors[0], spec.barkColors[1]),
    );

    // Mid-bough interior foliage pad so the canopy is never hollow near the trunk
    leafParts.push(
      buildLushCanopyCloud(p1.x * 1.05, p1.y + 0.18, p1.z * 1.05, b.padWidth * 0.88, b.droop, 5, rand),
    );

    // Primary bough tip foliage cloud
    leafParts.push(
      buildLushCanopyCloud(p2.x, p2.y + 0.1, p2.z, b.padWidth, b.droop, 6, rand),
    );

    // Secondary branch forks radiating out in different directions
    for (let f = 0; f < b.subForks; f++) {
      const side = f === 0 ? -1 : 1;
      const fAngle = b.angle + side * (0.5 + rand() * 0.14);
      const fca = Math.cos(fAngle);
      const fsa = Math.sin(fAngle);
      const fReach = b.endR * (0.92 + rand() * 0.2);
      const fEndY = b.endY + (f === 0 ? 0.38 : -0.2) - b.droop * 0.35;

      const fp1 = new Vector3((p1.x + fca * fReach) * 0.5, (p1.y + fEndY) * 0.52, (p1.z + fsa * fReach) * 0.5);
      const fp2 = new Vector3(fca * fReach, fEndY, fsa * fReach);

      barkParts.push(
        buildCurvedBranchSegment([p1, fp1, fp2], [b.radius * 0.55, b.radius * 0.32, 0.03], 3, spec.barkColors[0], spec.barkColors[1]),
      );

      leafParts.push(
        buildLushCanopyCloud(fp2.x, fp2.y + 0.08, fp2.z, b.padWidth * 0.88, b.droop, 5, rand),
      );
    }
  }

  // 3. Upper crown clouds
  for (const cp of spec.crownPads) {
    leafParts.push(buildLushCanopyCloud(cp.x, cp.y, cp.z, cp.width, cp.droop, 6, rand));
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
 * Builds the lush Wishing Bodhi Tree geometry for `wishing-tree.ts`
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
  barkParts.push(buildCurvedBranchSegment(trunkPts, [0.36, 0.27, 0.21, 0.16, 0.11], 6, 0x3b2618, 0x5c3d28, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.65, 3.85 + (i % 2) * 0.18, sa * 2.65);
    barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [0.14, 0.095, 0.045], 4, 0x4a3121, 0x694732));

    leafParts.push(
      buildLushCanopyCloud(p1.x, p1.y + 0.58, p1.z, 1.9, 0.06, 6, rand),
      buildLushCanopyCloud(p2.x, p2.y + 0.38, p2.z, 2.05, 0.08, 6, rand),
    );
  }

  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.3;
    const cy = c === 0 ? 6.15 : 5.25;
    leafParts.push(buildLushCanopyCloud(Math.cos(a) * rad, cy, Math.sin(a) * rad, 2.15, 0.05, 6, rand));
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
// 5-TIER STEPPED AMPHITHEATER FOREST LAYOUT (TALLEST AT HORIZON -> SHORTER & DETAILED INWARD)
// ============================================================================

interface TreeInstanceRecord {
  variantIndex: number;
  matrix: Matrix4;
  color: Color;
}

/** Point on the boundary ellipse at angle `a`, scaled outwards by `s`. */
function ringPoint(a: number, s: number): Vec2 {
  return { x: BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * s, z: BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * s };
}

interface SteppedRingConfig {
  readonly tier: number;
  readonly count: number;
  readonly ring: readonly [number, number];
  /** Target world height range (metres): steps down from 22–29m at the horizon to 4.5–8m at the courtyard edge! */
  readonly heightRange: readonly [number, number];
  /** Extra horizontal canopy spread multiplier (wider at the horizon to seal the fog). */
  readonly spreadRange: readonly [number, number];
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
  readonly variants: readonly number[];
}

const STEPPED_AMPHITHEATER_RINGS: readonly SteppedRingConfig[] = [
  // TẦNG 5 (Đường chân trời): Đại thụ khổng lồ cao 22–29m, tán cực rộng che kín sương mù phía sau
  {
    tier: 5,
    count: IS_MOBILE ? 44 : 56,
    ring: [1.54, 1.82],
    heightRange: [22.0, 29.0],
    spreadRange: [1.32, 1.55],
    phaseOffset: 0.5,
    gateGapFactor: 0.35,
    variants: [0, 1, 2],
  },
  // TẦNG 4 (Hậu cảnh cao): Cổ thụ cao 16.5–21.5m, xếp so le ngay trước Tầng 5
  {
    tier: 4,
    count: IS_MOBILE ? 36 : 46,
    ring: [1.36, 1.52],
    heightRange: [16.5, 21.5],
    spreadRange: [1.24, 1.44],
    phaseOffset: 0.0,
    gateGapFactor: 0.5,
    variants: [0, 1, 2, 3],
  },
  // TẦNG 3 (Trung cảnh cao): Cổ thụ cao 12.0–16.0m, xếp so le trước Tầng 4
  {
    tier: 3,
    count: IS_MOBILE ? 30 : 38,
    ring: [1.21, 1.34],
    heightRange: [12.0, 16.0],
    spreadRange: [1.18, 1.35],
    phaseOffset: 0.5,
    gateGapFactor: 0.7,
    variants: [1, 2, 3, 4],
  },
  // TẦNG 2 (Trung cảnh gần): Cây cổ thụ vừa cao 8.5–11.5m, xếp so le trước Tầng 3
  {
    tier: 2,
    count: IS_MOBILE ? 26 : 34,
    ring: [1.09, 1.19],
    heightRange: [8.5, 11.5],
    spreadRange: [1.12, 1.26],
    phaseOffset: 0.25,
    gateGapFactor: 0.88,
    variants: [1, 2, 3, 4, 6],
  },
  // TẦNG 1 (Sát mép sân chùa): Cây nhỏ & vừa cao 4.8–7.8m, lá cực kỳ chi tiết và rõ nét
  {
    tier: 1,
    count: IS_MOBILE ? 24 : 30,
    ring: [1.01, 1.08],
    heightRange: [4.8, 7.8],
    spreadRange: [1.05, 1.18],
    phaseOffset: 0.75,
    gateGapFactor: 1.0,
    variants: [4, 5, 6, 7],
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

  for (const cfg of STEPPED_AMPHITHEATER_RINGS) {
    const gap = GATE_GAP_RAD * cfg.gateGapFactor;
    const arc = Math.PI * 2 - 2 * gap;

    for (let k = 0; k < cfg.count; k++) {
      // Staggered slot placement with subtle natural variation so trunks interlock and block gaps
      const slotPos = k + 0.5 + cfg.phaseOffset + (rand() - 0.5) * 0.24;
      const u = (((slotPos % cfg.count) + cfg.count) % cfg.count) / cfg.count;
      const a = Math.PI / 2 + gap + u * arc;

      const r = cfg.ring[0] + rand() * (cfg.ring[1] - cfg.ring[0]);
      const p = ringPoint(a, r);

      const vIdx = pickNonRepeatingVariant(cfg.variants);
      const spec = ARCHETYPE_SPECS[vIdx]!;

      // Compute exact scale multiplier so the tree's world height matches the stepped tier's heightRange!
      const targetHeight = cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0]);
      const sy = targetHeight / spec.baseHeight;
      const spread = cfg.spreadRange[0] + rand() * (cfg.spreadRange[1] - cfg.spreadRange[0]);
      const sx = sy * spread * (0.94 + rand() * 0.12);
      const sz = sy * spread * (0.94 + rand() * 0.12);
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
// GOLDEN SUNLIGHT SHAFTS FILTERING THROUGH THE FOREST
// ============================================================================

function createForestSunbeams(scene: Scene, rand: () => number): {
  mesh: InstancedMesh;
  material: MeshBasicMaterial;
  dispose(): void;
} {
  const beamCount = IS_MOBILE ? 14 : 22;
  const geo = new PlaneGeometry(3.6, 16.0);
  geo.translate(0, 7.5, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255, 224, 150, 0.0)");
    g.addColorStop(0.25, "rgba(255, 215, 132, 0.28)");
    g.addColorStop(0.7, "rgba(255, 198, 108, 0.14)");
    g.addColorStop(1, "rgba(255, 185, 90, 0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 256);

    ctx.globalCompositeOperation = "destination-in";
    const hg = ctx.createLinearGradient(0, 0, 128, 0);
    hg.addColorStop(0, "rgba(0,0,0,0)");
    hg.addColorStop(0.5, "rgba(0,0,0,1)");
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, 128, 256);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;

  const material = new MeshBasicMaterial({
    map: tex,
    color: new Color(0xffd88a),
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geo, material, beamCount);
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let i = 0; i < beamCount; i++) {
    const u = (i + 0.5) / beamCount;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;
    const p = ringPoint(a, 1.08 + (i % 3) * 0.14);
    tmpEuler.set(-0.22, a + Math.PI * 0.25, -0.32, "YXZ");
    q.setFromEuler(tmpEuler);
    const sc = 0.85 + rand() * 0.45;
    mesh.setMatrixAt(i, m4.compose(v3.set(p.x, 0, p.z), q, s3.set(sc, sc, sc)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.renderOrder = 2;
  mesh.name = "forest-sunbeams";
  scene.add(mesh);

  return {
    mesh,
    material,
    dispose() {
      scene.remove(mesh);
      mesh.dispose();
      geo.dispose();
      material.dispose();
      tex.dispose();
    },
  };
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

  // 1. Build shared PBR Bark & High-Detail 90-Leaf Botanical Foliage materials.
  const mapleLeafTex = drawRealisticFoliageClusterTexture(1024);
  const mapleBarkMat = own(
    new MeshStandardMaterial({
      map: materials.wood.map,
      normalMap: materials.wood.normalMap,
      roughnessMap: materials.wood.roughnessMap,
      normalScale: new Vector2(1.3, 1.3),
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
      alphaTest: 0.26,
      transparent: false,
      roughness: 0.72,
      metalness: 0.0,
      emissive: new Color(0x141f0c),
      emissiveIntensity: 0.06,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 8 distinct Tree Archetype geometries + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Bodhi Tree (warm golden-green & autumn crown) outside the gate.
  const wishTreeFoliageMat = own(mapleFoliageMat.clone());
  wishTreeFoliageMat.color.setHex(0xe8a82e);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the 5-Tier Stepped Amphitheater Forest (Tallest 22–29m at horizon -> 4.8–7.8m detailed at courtyard edge).
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
    mesh.castShadow = !IS_MOBILE && (vIdx === 4 || vIdx === 5 || vIdx === 6);
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius += 6.0;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `maple-archetype:${spec.id}`;
    scene.add(mesh);
    forest.push(mesh);
  });

  // 4. Slanted golden sunlight shafts filtering through the forest gaps during daytime.
  const sunbeams = createForestSunbeams(scene, rand);

  registerCameraPreset("gate", { position: [0, 2.4, 36], target: [0, 2.6, 46] });
  registerCameraPreset("overview", { position: [0, 75, 100], target: [0, 0, 10] });

  return {
    lanterns: { stone, lotus },
    update(daylight) {
      uTreeTime.value = performance.now() * 0.001;
      const k = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * (1 - daylight);
      lanternPaper.emissiveIntensity = k;
      lotusLamp.emissiveIntensity = k;
      const leafEmissive = 0.04 + 0.07 * daylight;
      mapleFoliageMat.emissiveIntensity = leafEmissive;
      wishTreeFoliageMat.emissiveIntensity = leafEmissive;

      const beamAlpha = Math.max(0, (daylight - 0.35) / 0.65) * 0.15;
      sunbeams.mesh.visible = beamAlpha > 0.01;
      sunbeams.material.opacity = beamAlpha;
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
      sunbeams.dispose();
      mapleLeafTex.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
