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

// ============================================================================
// BẢNG TÙY CHỈNH ĐỘ THOÁNG TÁN LÁ & MÀU SẮC (CHỈNH SỬA TRỰC TIẾP TẠI ĐÂY)
// ============================================================================
export const TREE_VISUAL_CONFIG = {
  /**
   * Hệ số kích thước từng chòm nhánh lá (0.72 = tán thoáng, thấy rõ cành nhánh bên trong):
   * - Giảm xuống 0.60..0.68 nếu muốn tán thưa và thoáng hơn nữa.
   * - Tăng lên 0.82..0.90 nếu muốn các chòm lá giao nhau nhiều hơn.
   */
  padSizeMultiplier: 0.72,

  /**
   * Hệ số kích thước từng chiếc lá phong trên cành con (0.82 = lá sắc nét, tách biệt từng lá):
   */
  leafDetailScale: 0.82,

  /**
   * Hệ số chiều cao tổng thể của cây (1.0 = chuẩn theo 4 tầng từ cao xuống thấp).
   */
  treeHeightMultiplier: 1.0,

  /**
   * Màu lá của Cây Bồ Đề Ước Nguyện ngoài cổng tam quan (mã màu Hex).
   */
  wishTreeColor: 0xf2a829,

  /**
   * BẢNG MÀU LÁ CÂY ĐAN XEN TRONG RỪNG (Đỏ phong, Cam thu, Vàng nghệ, Vàng cốm, Xanh lá):
   */
  foliagePalette: [
    0xd6281d, // 1. Đỏ phong tươi (Maple Crimson)
    0xf2641d, // 2. Đỏ cam / Cam thu (Autumn Orange)
    0xf5bc28, // 3. Vàng thu sáng (Golden Yellow)
    0x4da33e, // 4. Xanh lá cây tươi (Fresh Foliage Green)
    0xb81b16, // 5. Đỏ rượu vang (Deep Wine Red)
    0xeb8226, // 6. Vàng cam ấm (Warm Apricot Orange)
    0xaad43b, // 7. Vàng nõn chuối / Xanh cốm (Chartreuse Green)
    0xd93822, // 8. Đỏ son (Scarlet Maple)
    0xf7ce3c, // 9. Vàng nắng ấm (Sunlit Gold)
    0x3f8c36, // 10. Xanh rêu cổ thụ (Temple Moss Green)
    0xc94222, // 11. Cam cháy (Burnt Orange)
    0xe89c28, // 12. Vàng hổ phách (Amber Gold)
  ] as const,
} as const;

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
const GATE_GAP_RAD = 0.24;

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

function pickTreeFoliageColor(index: number, ringTier: number, out: Color): Color {
  const palette = TREE_VISUAL_CONFIG.foliagePalette;
  const step = (index * 5 + ringTier * 3) % palette.length;
  const baseHex = palette[step] ?? 0xd6281d;
  out.setHex(baseHex);

  // Soften distant horizon tiers slightly into warm autumn mist for 3D depth
  if (ringTier === 3) {
    out.lerp(new Color(0xde925f), 0.14);
  } else if (ringTier >= 4) {
    out.lerp(new Color(0xe3a070), 0.26);
  }
  return out;
}

// ============================================================================
// SHADERS: NATURAL BARK & AIRY SUN-FILTERED FOLIAGE
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
        float boughSway = branchWeight * 0.015 * sin(uTime * 0.9 + treePhase + transformed.x * 0.4);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Botanical Foliage Shader:
 * - Preserves outward-domed normals on both sides of `DoubleSide` leaf cards so backfaces never turn black.
 * - Creates natural 3-tone sunlight translucency across each tree's open leaf sprays.
 */
function attachMapleFoliageShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying float vCanopyGrad;\nvarying float vRimLight;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float heightNorm = clamp((transformed.y - 1.4) / 4.8, 0.0, 1.0);
        float sunSide = clamp(dot(normalize(objectNormal), vec3(0.45, 0.80, 0.38)), 0.0, 1.0);
        vCanopyGrad = clamp(heightNorm * 0.50 + sunSide * 0.50, 0.0, 1.0);
        vRimLight = pow(sunSide, 1.5) * heightNorm;

        float swayWeight = clamp((transformed.y - 1.2) * 0.18, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 0.95 + transformed.z * 0.9 + transformed.y * 0.55;
        float swayX = swayWeight * (0.022 * sin(uTime * 1.0 + treePhase + clusterPhase) + 0.008 * cos(uTime * 1.85 - clusterPhase));
        float swayZ = swayWeight * (0.018 * cos(uTime * 0.9 + treePhase * 1.2 + clusterPhase));
        transformed.x += swayX;
        transformed.y += (swayX + swayZ) * 0.08;
        transformed.z += swayZ;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vCanopyGrad;\nvarying float vRimLight;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 lowerShade = diffuseColor.rgb * vec3(0.68, 0.64, 0.60);
        vec3 upperSun = mix(diffuseColor.rgb * 1.18, vec3(1.0, 0.92, 0.64), 0.20);
        diffuseColor.rgb = mix(lowerShade, upperSun, vCanopyGrad);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb * 0.96, 0.28) + vec3(1.0, 0.86, 0.52) * (vRimLight * 0.14);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// REALISTIC BOTANICAL MAPLE BRANCHLET TEXTURE (`1024x1024` — OPEN & DETAILED)
// ============================================================================

/**
 * Draws a high-resolution 1024x1024 botanical Japanese Maple branchlet (`cành lá phong thật chi tiết`):
 * - Features a natural Y-forking wooden twig skeleton with slender leaf petioles (cuống lá).
 * - Places 15 distinct, sharply detailed 7-lobed palmate maple leaves along the twigs with
 *   GENEROUS OPEN SKY GAPS (~50% transparent alpha) between the leaves so canopies breathe
 *   and individual serrated leaves are clearly visible!
 */
function drawBotanicalBranchletTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const leafScale = TREE_VISUAL_CONFIG.leafDetailScale;

  // 1. Draw the woody branchlet and secondary twigs (visible through the open spaces between leaves)
  ctx.strokeStyle = "#4a2c1a";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const branches: readonly [number, number, number, number, number, number, number][] = [
    // Main central stem
    [0.5, 0.95, 0.49, 0.6, 0.5, 0.18, 0.011],
    // Lower left & right side twigs
    [0.49, 0.74, 0.33, 0.65, 0.15, 0.54, 0.0075],
    [0.5, 0.7, 0.67, 0.61, 0.85, 0.5, 0.0075],
    // Upper left & right forks
    [0.49, 0.48, 0.34, 0.38, 0.2, 0.26, 0.006],
    [0.5, 0.44, 0.66, 0.34, 0.8, 0.24, 0.006],
  ];
  for (const [x0, y0, cx, cy, x1, y1, w] of branches) {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * cx, size * cy, size * x1, size * y1);
    ctx.stroke();
  }

  /**
   * Draws a single botanical 7-lobed Japanese Maple leaf (`Acer palmatum`) with:
   * - Slender petiole stem connecting to the twig.
   * - 7 deeply incised acuminate lobes (`sinus = 0.25 * radius`) so the hand-like shape is unmistakable.
   * - Realistic double-serrated leaf margins (răng cưa sắc nét dọc mép từng thùy lá).
   * - Primary palmate midribs + secondary pinnate lateral veins on every lobe.
   */
  const drawRealisticMapleLeaf = (
    cx: number,
    cy: number,
    baseRadius: number,
    rot: number,
    brightness: number,
  ): void => {
    const radius = baseRadius * leafScale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Petiole (leaf stalk)
    ctx.strokeStyle = "#5c341d";
    ctx.lineWidth = Math.max(1.4, radius * 0.036);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.46);
    ctx.quadraticCurveTo(radius * 0.03, radius * 0.25, 0, radius * 0.06);
    ctx.stroke();

    const lobeAngles = [-1.96, -1.32, -0.64, 0, 0.64, 1.32, 1.96] as const;
    const lobeLengths = [0.45, 0.78, 0.98, 1.14, 0.98, 0.78, 0.45] as const;
    const lobeWidths = [0.12, 0.17, 0.2, 0.22, 0.2, 0.17, 0.12] as const;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.12);

    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]!;
      const wid = radius * lobeWidths[i]!;
      const perp = a + Math.PI * 0.5;

      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cp = Math.cos(perp);
      const sp = Math.sin(perp);

      // Left serrated margin (3 sharp teeth along the lobe flank)
      const pL1x = ca * (len * 0.34) - cp * (wid * 0.74);
      const pL1y = sa * (len * 0.34) - sp * (wid * 0.74);
      const pL1InX = ca * (len * 0.38) - cp * (wid * 0.6);
      const pL1InY = sa * (len * 0.38) - sp * (wid * 0.6);

      const pL2x = ca * (len * 0.58) - cp * (wid * 0.95);
      const pL2y = sa * (len * 0.58) - sp * (wid * 0.95);
      const pL2InX = ca * (len * 0.63) - cp * (wid * 0.72);
      const pL2InY = sa * (len * 0.63) - sp * (wid * 0.72);

      const pL3x = ca * (len * 0.8) - cp * (wid * 0.52);
      const pL3y = sa * (len * 0.8) - sp * (wid * 0.52);

      // Sharp acuminate lobe tip
      const tipX = ca * len;
      const tipY = sa * len;

      // Right serrated margin
      const pR3x = ca * (len * 0.8) + cp * (wid * 0.52);
      const pR3y = sa * (len * 0.8) + sp * (wid * 0.52);

      const pR2InX = ca * (len * 0.63) + cp * (wid * 0.72);
      const pR2InY = sa * (len * 0.63) + sp * (wid * 0.72);
      const pR2x = ca * (len * 0.58) + cp * (wid * 0.95);
      const pR2y = sa * (len * 0.58) + sp * (wid * 0.95);

      const pR1InX = ca * (len * 0.38) + cp * (wid * 0.6);
      const pR1InY = sa * (len * 0.38) + sp * (wid * 0.6);
      const pR1x = ca * (len * 0.34) + cp * (wid * 0.74);
      const pR1y = sa * (len * 0.34) + sp * (wid * 0.74);

      ctx.lineTo(pL1x, pL1y);
      ctx.lineTo(pL1InX, pL1InY);
      ctx.lineTo(pL2x, pL2y);
      ctx.lineTo(pL2InX, pL2InY);
      ctx.lineTo(pL3x, pL3y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(pR3x, pR3y);
      ctx.lineTo(pR2InX, pR2InY);
      ctx.lineTo(pR2x, pR2y);
      ctx.lineTo(pR1InX, pR1InY);
      ctx.lineTo(pR1x, pR1y);

      // Deep V-sinus notch between lobes (0.25 * radius) so the 7 lobes are sharply separated
      if (i < lobeAngles.length - 1) {
        const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
        const midA = (a + nextA) * 0.5;
        const notchR = radius * 0.25;
        ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
      }
    }

    ctx.closePath();

    // Natural botanical luminance gradient from petiole heart to lobe tips
    const b0 = Math.round(210 * brightness);
    const b1 = Math.round(242 * brightness);
    const b2 = Math.min(255, Math.round(255 * brightness));

    const grad = ctx.createRadialGradient(0, 0, radius * 0.06, 0, -radius * 0.16, radius * 1.08);
    grad.addColorStop(0, `rgb(${b0}, ${b0 - 5}, ${b0 - 12})`);
    grad.addColorStop(0.62, `rgb(${b1}, ${b1 - 2}, ${b1 - 6})`);
    grad.addColorStop(1, `rgb(${b2}, ${b2}, ${b2})`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Crisp botanical margin contour
    ctx.lineWidth = Math.max(1.3, radius * 0.022);
    ctx.strokeStyle = `rgba(${Math.round(145 * brightness)}, ${Math.round(132 * brightness)}, ${Math.round(118 * brightness)}, 0.55)`;
    ctx.stroke();

    // Primary palmate midribs + secondary lateral veins on each lobe
    ctx.strokeStyle = "rgba(255, 255, 240, 0.62)";
    ctx.lineCap = "round";
    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]!;
      const wid = radius * lobeWidths[i]!;
      const perp = a + Math.PI * 0.5;

      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cp = Math.cos(perp);
      const sp = Math.sin(perp);

      // Primary midrib of the lobe
      ctx.lineWidth = Math.max(1.2, radius * 0.022);
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.06);
      ctx.lineTo(ca * (len * 0.88), sa * (len * 0.88));
      ctx.stroke();

      // Secondary lateral veins branching off the lobe midrib
      if (i >= 1 && i <= 5) {
        ctx.lineWidth = Math.max(0.8, radius * 0.013);
        for (const frac of [0.38, 0.62] as const) {
          const vx = ca * (len * frac);
          const vy = sa * (len * frac);
          const vSpan = wid * (1 - frac * 0.35) * 0.68;
          const vFwd = len * 0.12;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx + ca * vFwd - cp * vSpan, vy + sa * vFwd - sp * vSpan);
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx + ca * vFwd + cp * vSpan, vy + sa * vFwd + sp * vSpan);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  };

  // 2. Place 15 well-spaced leaves along the 5 twigs (leaving clear open sky gaps between sub-groups!)
  const leafPlacements: readonly [number, number, number, number, number][] = [
    // Top central terminal shoot (3 leaves)
    [0.5, 0.15, 0.145, 0.0, 1.0],
    [0.37, 0.21, 0.13, -0.48, 0.96],
    [0.63, 0.21, 0.13, 0.48, 0.96],

    // Upper-left fork (3 leaves)
    [0.17, 0.24, 0.14, -0.72, 0.99],
    [0.29, 0.33, 0.125, -0.35, 0.93],
    [0.14, 0.38, 0.125, -1.12, 0.95],

    // Upper-right fork (3 leaves)
    [0.83, 0.22, 0.14, 0.72, 0.99],
    [0.71, 0.31, 0.125, 0.35, 0.93],
    [0.86, 0.36, 0.125, 1.12, 0.95],

    // Lower-left twig (3 leaves)
    [0.13, 0.53, 0.14, -1.05, 0.97],
    [0.27, 0.59, 0.13, -0.55, 0.91],
    [0.24, 0.71, 0.12, -1.65, 0.92],

    // Lower-right twig (3 leaves)
    [0.87, 0.49, 0.14, 1.05, 0.97],
    [0.73, 0.56, 0.13, 0.55, 0.91],
    [0.76, 0.69, 0.12, 1.65, 0.92],
  ];

  for (const [x, y, r, rot, br] of leafPlacements) {
    drawRealisticMapleLeaf(x * size, y * size, r * size, rot, br);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// SMOOTH CATMULL-ROM TRUNKS & AIRY BOTANICAL LEAF SPRAYS (ZERO SOLID SPHERES!)
// ============================================================================

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
 * Builds one gracefully arched 2x2 botanical branchlet card (`nhánh lá uốn cong tự nhiên`)
 * that grows outward from a branch node at `(ax, ay, az)`.
 */
function buildCurvedBranchletCard(
  ax: number,
  ay: number,
  az: number,
  width: number,
  length: number,
  arch: number,
  yaw: number,
  pitch: number,
  roll: number,
  innerHex: number,
  outerHex: number,
  clusterCenter: Vector3,
): BufferGeometry {
  const segs = 2;
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
    const v = iy / segs; // v = 0 at branch base, v = 1 at outer leaf tip
    const lz = (0.12 - v) * length;
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const lx = (u - 0.5) * width;
      // Gentle natural arch along the branchlet length and across its width
      const archCurve = Math.sin(v * Math.PI) * arch - (u - 0.5) * (u - 0.5) * arch * 0.85;

      v3.set(lx, archCurve, lz).applyQuaternion(q);
      const wx = ax + v3.x;
      const wy = ay + v3.y;
      const wz = az + v3.z;

      const idx = iy * cols + ix;
      pos[idx * 3] = wx;
      pos[idx * 3 + 1] = wy;
      pos[idx * 3 + 2] = wz;

      // Map v=0 to the bottom of the texture (stem) and v=1 to the top (leaf tips)
      uv[idx * 2] = u;
      uv[idx * 2 + 1] = v;

      cTmp.lerpColors(cIn, cOut, v);
      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;

      const nx = wx - clusterCenter.x;
      const ny = wy - clusterCenter.y + 0.55;
      const nz = wz - clusterCenter.z;
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
 * Builds an airy, open 3D Botanical Foliage Spray ("tán lá có độ thoáng tự nhiên"):
 * - NO solid spheres or closed domes!
 * - Uses `frondCount` (4 to 5) radiating arched branchlet cards growing out from the branch tip,
 *   plus 2 gently tilted upper crown cards so the cluster has 3D volume from all angles
 *   while letting sky light and wooden branches show right through the canopy!
 */
function buildAiryBotanicalSpray(
  cx: number,
  cy: number,
  cz: number,
  rawRadius: number,
  droop: number,
  frondCount: number,
  rand: () => number,
): BufferGeometry {
  const radius = rawRadius * TREE_VISUAL_CONFIG.padSizeMultiplier;
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const shHex = 0xd4cdc0;
  const mdHex = 0xf0ece2;
  const brHex = 0xffffff;

  // 1. Radiating outer branchlet fronds fanning out like a real maple branch spray
  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const baseOffset = radius * 0.1;
    const w = radius * (0.95 + rand() * 0.18);
    const len = radius * (1.02 + (i % 2) * 0.16);
    const pitch = 0.2 + droop * 0.28 + (i % 2) * 0.12 + (rand() - 0.5) * 0.08;
    const roll = (rand() - 0.5) * 0.22;

    parts.push(
      buildCurvedBranchletCard(
        cx + Math.cos(a) * baseOffset,
        cy + (i % 2 === 0 ? 0.04 : -0.04),
        cz + Math.sin(a) * baseOffset,
        w,
        len,
        0.18,
        a,
        pitch,
        roll,
        shHex,
        brHex,
        center,
      ),
    );
  }

  // 2. Two upper/angled crown branchlet sprays for 3D height and silhouette depth
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI + 0.65 + (rand() - 0.5) * 0.35;
    const w = radius * (0.88 + rand() * 0.14);
    const len = radius * (0.92 + rand() * 0.14);
    parts.push(
      buildCurvedBranchletCard(
        cx,
        cy + 0.12 + i * 0.06,
        cz,
        w,
        len,
        0.2,
        a,
        -0.12 + droop * 0.18 + i * 0.16,
        (i === 0 ? 1 : -1) * 0.24,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: airy botanical spray");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"   // 1. Cổ thụ hậu cảnh & đỉnh đồi
  | "spreading" // 2. Cây phong tán xòe tầng mây
  | "rounded"   // 3. Cây phong tán vòm thoáng
  | "weeping"   // 4. Cây phong dáng rủ nhẹ
  | "curved"    // 5. Cây phong thân cong nghệ thuật
  | "small";    // 6. Cây phong nhỏ sát sân chùa

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
  // 1. Cổ thụ hậu cảnh (Base height 10.0m, well-separated tiered boughs)
  {
    id: "ancient",
    baseHeight: 10.0,
    trunkBaseR: 0.3,
    trunkTopR: 0.095,
    barkColors: [0x3d2518, 0x593926],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 1.3, -0.05],
      [-0.1, 2.7, 0.06],
      [-0.03, 4.1, 0.02],
      [0.04, 5.5, -0.03],
    ],
    boughs: [
      { angle: 0.2, startY: 2.3, midR: 1.5, midY: 3.3, endR: 2.85, endY: 4.0, radius: 0.13, padWidth: 2.2, droop: 0.08 },
      { angle: 1.45, startY: 2.7, midR: 1.45, midY: 3.8, endR: 2.75, endY: 4.6, radius: 0.12, padWidth: 2.1, droop: 0.06 },
      { angle: 2.75, startY: 2.4, midR: 1.55, midY: 3.5, endR: 2.95, endY: 4.2, radius: 0.13, padWidth: 2.25, droop: 0.08 },
      { angle: 4.0, startY: 3.0, midR: 1.4, midY: 4.2, endR: 2.65, endY: 5.0, radius: 0.11, padWidth: 2.05, droop: 0.05 },
      { angle: 5.25, startY: 3.3, midR: 1.35, midY: 4.5, endR: 2.55, endY: 5.4, radius: 0.1, padWidth: 2.0, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 6.5, z: 0.0, width: 2.4, droop: 0.04 },
      { x: -1.3, y: 5.7, z: 0.9, width: 2.05, droop: 0.05 },
      { x: 1.3, y: 5.8, z: -0.9, width: 2.05, droop: 0.05 },
    ],
  },

  // 2. Cây phong tán xòe (Base height 8.0m)
  {
    id: "spreading",
    baseHeight: 8.0,
    trunkBaseR: 0.24,
    trunkTopR: 0.08,
    barkColors: [0x452a1c, 0x633e2b],
    trunkCurve: [
      [0, 0, 0],
      [-0.07, 1.0, 0.05],
      [0.1, 2.1, -0.05],
      [0.05, 3.2, -0.02],
      [-0.03, 4.3, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 1.9, midR: 1.4, midY: 2.5, endR: 2.7, endY: 3.0, radius: 0.1, padWidth: 1.95, droop: 0.06 },
      { angle: 1.65, startY: 2.2, midR: 1.35, midY: 2.9, endR: 2.55, endY: 3.5, radius: 0.095, padWidth: 1.9, droop: 0.06 },
      { angle: 3.15, startY: 2.0, midR: 1.45, midY: 2.7, endR: 2.8, endY: 3.2, radius: 0.1, padWidth: 2.0, droop: 0.06 },
      { angle: 4.7, startY: 2.45, midR: 1.3, midY: 3.2, endR: 2.45, endY: 3.85, radius: 0.09, padWidth: 1.85, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 5.0, z: 0.0, width: 2.15, droop: 0.04 },
      { x: -1.05, y: 4.3, z: -0.7, width: 1.85, droop: 0.05 },
      { x: 1.05, y: 4.4, z: 0.7, width: 1.85, droop: 0.05 },
    ],
  },

  // 3. Cây phong tán vòm thoáng (Base height 7.2m)
  {
    id: "rounded",
    baseHeight: 7.2,
    trunkBaseR: 0.21,
    trunkTopR: 0.07,
    barkColors: [0x402d20, 0x5c4230],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.9, 0.03],
      [-0.06, 1.9, -0.04],
      [0.02, 2.9, 0.02],
      [0.0, 3.9, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 1.8, midR: 1.15, midY: 2.4, endR: 2.15, endY: 3.0, radius: 0.09, padWidth: 1.8, droop: 0.08 },
      { angle: 1.95, startY: 2.05, midR: 1.1, midY: 2.75, endR: 2.05, endY: 3.35, radius: 0.085, padWidth: 1.75, droop: 0.08 },
      { angle: 3.5, startY: 1.9, midR: 1.2, midY: 2.55, endR: 2.2, endY: 3.15, radius: 0.09, padWidth: 1.8, droop: 0.08 },
      { angle: 5.05, startY: 2.25, midR: 1.05, midY: 2.95, endR: 2.0, endY: 3.6, radius: 0.08, padWidth: 1.7, droop: 0.07 },
    ],
    crownPads: [
      { x: 0.0, y: 4.6, z: 0.0, width: 2.0, droop: 0.05 },
      { x: -0.85, y: 4.0, z: 0.65, width: 1.7, droop: 0.06 },
      { x: 0.85, y: 4.1, z: -0.65, width: 1.7, droop: 0.06 },
    ],
  },

  // 4. Cây phong dáng rủ nhẹ (Base height 6.8m)
  {
    id: "weeping",
    baseHeight: 6.8,
    trunkBaseR: 0.2,
    trunkTopR: 0.068,
    barkColors: [0x452a1e, 0x5e3b2b],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 0.95, -0.04],
      [0.15, 2.0, -0.08],
      [0.06, 3.0, -0.03],
      [-0.04, 3.85, 0.02],
    ],
    boughs: [
      { angle: 0.25, startY: 1.9, midR: 1.25, midY: 2.8, endR: 2.3, endY: 2.45, radius: 0.085, padWidth: 1.75, droop: 0.22 },
      { angle: 1.8, startY: 2.15, midR: 1.2, midY: 3.05, endR: 2.2, endY: 2.7, radius: 0.08, padWidth: 1.7, droop: 0.22 },
      { angle: 3.35, startY: 2.0, midR: 1.3, midY: 2.9, endR: 2.35, endY: 2.55, radius: 0.085, padWidth: 1.8, droop: 0.24 },
      { angle: 4.9, startY: 2.3, midR: 1.15, midY: 3.15, endR: 2.15, endY: 2.8, radius: 0.08, padWidth: 1.7, droop: 0.2 },
    ],
    crownPads: [
      { x: 0.0, y: 4.4, z: 0.0, width: 1.9, droop: 0.14 },
      { x: -0.85, y: 3.8, z: 0.55, width: 1.65, droop: 0.18 },
      { x: 0.85, y: 3.9, z: -0.55, width: 1.65, droop: 0.18 },
    ],
  },

  // 5. Cây phong thân cong nghệ thuật (Base height 6.2m)
  {
    id: "curved",
    baseHeight: 6.2,
    trunkBaseR: 0.19,
    trunkTopR: 0.062,
    barkColors: [0x473225, 0x634736],
    trunkCurve: [
      [0, 0, 0],
      [-0.18, 0.85, 0.1],
      [-0.25, 1.8, 0.14],
      [0.1, 2.7, -0.06],
      [0.18, 3.65, -0.1],
    ],
    boughs: [
      { angle: 0.5, startY: 1.7, midR: 1.1, midY: 2.2, endR: 2.0, endY: 2.65, radius: 0.08, padWidth: 1.65, droop: 0.08 },
      { angle: 2.4, startY: 2.1, midR: 1.05, midY: 2.7, endR: 1.95, endY: 3.15, radius: 0.075, padWidth: 1.6, droop: 0.06 },
      { angle: 4.3, startY: 2.45, midR: 1.1, midY: 3.05, endR: 2.0, endY: 3.5, radius: 0.07, padWidth: 1.6, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.15, y: 4.2, z: -0.08, width: 1.85, droop: 0.05 },
      { x: -0.7, y: 3.6, z: 0.45, width: 1.55, droop: 0.06 },
    ],
  },

  // 6. Cây phong nhỏ sát sân (Base height 5.2m)
  {
    id: "small",
    baseHeight: 5.2,
    trunkBaseR: 0.15,
    trunkTopR: 0.05,
    barkColors: [0x452e20, 0x61422e],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.7, -0.03],
      [-0.05, 1.5, 0.03],
      [0.02, 2.35, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.25, midR: 0.82, midY: 1.7, endR: 1.5, endY: 2.15, radius: 0.06, padWidth: 1.45, droop: 0.06 },
      { angle: 2.4, startY: 1.45, midR: 0.78, midY: 1.9, endR: 1.45, endY: 2.35, radius: 0.055, padWidth: 1.4, droop: 0.06 },
      { angle: 4.5, startY: 1.65, midR: 0.8, midY: 2.1, endR: 1.42, endY: 2.5, radius: 0.055, padWidth: 1.4, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.0, y: 3.05, z: 0.0, width: 1.6, droop: 0.04 },
    ],
  },
];

function buildArchetypeGeometry(spec: ArchetypeSpec, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  // 1. Smooth Catmull-Rom curved trunk with natural base flare
  const trunkPts = spec.trunkCurve.map(([x, y, z]) => new Vector3(x, y, z));
  const topPt = trunkPts[trunkPts.length - 1]!;
  barkParts.push(
    buildSmoothBranchTube(trunkPts, spec.trunkBaseR, spec.trunkTopR, 8, 7, spec.barkColors[0], spec.barkColors[1], true),
  );

  // 2. Smooth Catmull-Rom primary boughs & secondary twigs reaching right into the airy leaf sprays
  for (const b of spec.boughs) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.5, b.startY, sa * spec.trunkTopR * 0.5);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildSmoothBranchTube([p0, p1, p2], b.radius, b.radius * 0.26, 5, 5, spec.barkColors[0], spec.barkColors[1]),
    );

    // Airy botanical foliage spray at the primary bough tip
    leafParts.push(
      buildAiryBotanicalSpray(p2.x, p2.y + 0.05, p2.z, b.padWidth, b.droop, 4, rand),
    );

    // Secondary branch fork visibly splitting off the main bough
    const fAngle = b.angle + (rand() > 0.5 ? 0.58 : -0.58);
    const fReach = b.endR * 0.82;
    const fEndY = b.endY + 0.34 - b.droop * 0.2;
    const fp2 = new Vector3(Math.cos(fAngle) * fReach, fEndY, Math.sin(fAngle) * fReach);

    barkParts.push(
      buildSmoothBranchTube([p1, fp2], b.radius * 0.52, b.radius * 0.18, 4, 4, spec.barkColors[0], spec.barkColors[1]),
    );

    leafParts.push(
      buildAiryBotanicalSpray(fp2.x, fp2.y + 0.04, fp2.z, b.padWidth * 0.8, b.droop, 3, rand),
    );
  }

  // 3. Upper leader branches & airy crown sprays
  for (const cp of spec.crownPads) {
    const leaderEnd = new Vector3(cp.x, cp.y, cp.z);
    const leaderMid = new Vector3((topPt.x + cp.x) * 0.5, (topPt.y + cp.y) * 0.5, (topPt.z + cp.z) * 0.5);
    barkParts.push(
      buildSmoothBranchTube([topPt, leaderMid, leaderEnd], spec.trunkTopR * 0.85, spec.trunkTopR * 0.22, 4, 4, spec.barkColors[0], spec.barkColors[1]),
    );
    leafParts.push(buildAiryBotanicalSpray(cp.x, cp.y, cp.z, cp.width, cp.droop, 4, rand));
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
  barkParts.push(buildSmoothBranchTube(trunkPts, 0.32, 0.1, 8, 7, 0x3d2518, 0x593926, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.55, 3.85 + (i % 2) * 0.18, sa * 2.55);
    barkParts.push(buildSmoothBranchTube([p0, p1, p2], 0.12, 0.035, 5, 5, 0x452a1c, 0x633e2b));

    leafParts.push(
      buildAiryBotanicalSpray(p1.x, p1.y + 0.48, p1.z, 1.85, 0.05, 4, rand),
      buildAiryBotanicalSpray(p2.x, p2.y + 0.32, p2.z, 1.95, 0.06, 4, rand),
    );
  }

  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.15;
    const cy = c === 0 ? 6.0 : 5.15;
    leafParts.push(buildAiryBotanicalSpray(Math.cos(a) * rad, cy, Math.sin(a) * rad, 2.1, 0.04, 4, rand));
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
// 4-LAYER STEPPED HILLSIDE FOREST LAYOUT (AIRY SPACING, TALLER AT HORIZON -> SHORTER INWARD)
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
  readonly baseY: number;
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
  readonly variants: readonly number[];
}

/**
 * 4-Layer Stepped Hillside Forest (~112 trees total — airy & well-spaced so canopies never mash together):
 * - Tier 4 (Horizon Crest): 34 trees (14.5m – 18.5m tall, baseY = +2.6m)
 * - Tier 3 (Background Slope): 30 trees (11.0m – 14.0m tall, baseY = +1.0m)
 * - Tier 2 (Midground): 26 trees (8.0m – 10.5m tall, baseY = 0.0m)
 * - Tier 1 (Courtyard Edge): 22 trees (5.2m – 7.2m tall, baseY = 0.0m) — open spacing (~11m apart)
 */
const STEPPED_RINGS: readonly SteppedRingConfig[] = [
  {
    tier: 4,
    count: IS_MOBILE ? 28 : 34,
    ring: [1.36, 1.54],
    heightRange: [14.5, 18.5],
    spreadRange: [1.04, 1.18],
    baseY: 2.6,
    phaseOffset: 0.5,
    gateGapFactor: 0.42,
    variants: [0, 1, 2],
  },
  {
    tier: 3,
    count: IS_MOBILE ? 24 : 30,
    ring: [1.21, 1.34],
    heightRange: [11.0, 14.0],
    spreadRange: [1.0, 1.14],
    baseY: 1.0,
    phaseOffset: 0.0,
    gateGapFactor: 0.65,
    variants: [0, 1, 2, 3],
  },
  {
    tier: 2,
    count: IS_MOBILE ? 22 : 26,
    ring: [1.09, 1.19],
    heightRange: [8.0, 10.5],
    spreadRange: [0.98, 1.1],
    baseY: 0.0,
    phaseOffset: 0.5,
    gateGapFactor: 0.85,
    variants: [1, 2, 3, 4],
  },
  {
    tier: 1,
    count: IS_MOBILE ? 18 : 22,
    ring: [1.0, 1.07],
    heightRange: [5.2, 7.2],
    spreadRange: [0.94, 1.06],
    baseY: 0.0,
    phaseOffset: 0.25,
    gateGapFactor: 1.0,
    variants: [2, 3, 4, 5],
  },
];

function buildSteppedForestLayout(rand: () => number): TreeInstanceRecord[] {
  const records: TreeInstanceRecord[] = [];
  const tmpColor = new Color();
  let colorCounter = 0;
  let prevVariant = -1;
  const hMult = TREE_VISUAL_CONFIG.treeHeightMultiplier;

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
      const slotPos = k + 0.5 + cfg.phaseOffset + (rand() - 0.5) * 0.24;
      const u = (((slotPos % cfg.count) + cfg.count) % cfg.count) / cfg.count;
      const a = Math.PI / 2 + gap + u * arc;

      const r = cfg.ring[0] + rand() * (cfg.ring[1] - cfg.ring[0]);
      const p = ringPoint(a, r);

      const vIdx = pickNonRepeatingVariant(cfg.variants);
      const spec = ARCHETYPE_SPECS[vIdx]!;

      const targetHeight = (cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0])) * hMult;
      const sy = targetHeight / spec.baseHeight;
      const spread = cfg.spreadRange[0] + rand() * (cfg.spreadRange[1] - cfg.spreadRange[0]);
      const sx = sy * spread * (0.95 + rand() * 0.1);
      const sz = sy * spread * (0.95 + rand() * 0.1);
      const yaw = (k * 1.6180339 + cfg.tier * 0.9 + rand() * 0.4) * Math.PI * 2;

      pickTreeFoliageColor(colorCounter++, cfg.tier, tmpColor);

      records.push({
        variantIndex: vIdx,
        matrix: place(p.x, cfg.baseY, p.z, yaw, sx, sy, sz).clone(),
        color: tmpColor.clone(),
      });
    }
  }

  return records;
}

// ============================================================================
// DIAGONAL GOLDEN SUNLIGHT SHAFTS ("GOD RAYS")
// ============================================================================

function createForestSunbeams(scene: Scene, rand: () => number): {
  mesh: InstancedMesh;
  material: MeshBasicMaterial;
  dispose(): void;
} {
  const beamCount = IS_MOBILE ? 14 : 22;
  const geo = new PlaneGeometry(3.8, 20.0);
  geo.translate(0, 8.5, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255, 228, 155, 0.0)");
    g.addColorStop(0.22, "rgba(255, 212, 128, 0.30)");
    g.addColorStop(0.65, "rgba(255, 188, 95, 0.15)");
    g.addColorStop(1, "rgba(255, 170, 75, 0.0)");
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
    color: new Color(0xffcc70),
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geo, material, beamCount);
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let i = 0; i < beamCount; i++) {
    const u = (i + 0.5) / beamCount;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;
    const p = ringPoint(a, 1.02 + (i % 3) * 0.12);
    tmpEuler.set(-0.18, a + Math.PI * 0.25, -0.36, "YXZ");
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

  // 1. Build shared PBR Bark & Realistic 15-Leaf Open Botanical Branchlet Foliage materials.
  const mapleLeafTex = drawBotanicalBranchletTexture(1024);
  const mapleBarkMat = own(
    new MeshStandardMaterial({
      map: materials.wood.map,
      normalMap: materials.wood.normalMap,
      roughnessMap: materials.wood.roughnessMap,
      normalScale: new Vector2(1.25, 1.25),
      vertexColors: true,
      color: new Color(0x9e7d64),
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
      alphaTest: 0.36,
      transparent: false,
      roughness: 0.72,
      metalness: 0.0,
      emissive: new Color(0x1c0f06),
      emissiveIntensity: 0.05,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 6 Airy Botanical Tree Archetypes + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Bodhi/Maple Tree outside the gate.
  const wishTreeFoliageMat = own(mapleFoliageMat.clone());
  wishTreeFoliageMat.color.setHex(TREE_VISUAL_CONFIG.wishTreeColor);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the 4-Tier Stepped Hillside Forest with airy spacing.
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
      mesh.boundingSphere.radius += 6.0;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `maple-archetype:${spec.id}`;
    scene.add(mesh);
    forest.push(mesh);
  });

  // 4. Diagonal golden sunbeams streaming across the trees and courtyard.
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
      const leafEmissive = 0.04 + 0.06 * daylight;
      mapleFoliageMat.emissiveIntensity = leafEmissive;
      wishTreeFoliageMat.emissiveIntensity = leafEmissive;

      const beamAlpha = Math.max(0, (daylight - 0.3) / 0.7) * 0.18;
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
