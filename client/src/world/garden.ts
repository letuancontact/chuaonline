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

// ============================================================================
// AUTUMN COLOR DISTRIBUTION (25% Crimson / 25% Red-Orange / 20% Gold / 15% Apricot / 10% Russet / 5% Moss)
// ============================================================================

/**
 * 20-slot weighted palette table matching the exact requested autumn color ratios:
 * - 5 slots (25%): Đỏ thẫm & đỏ rượu vang (Deep Crimson & Wine Red)
 * - 5 slots (25%): Đỏ cam & cam cháy (Red-Orange & Burnt Orange)
 * - 4 slots (20%): Vàng nghệ & vàng hổ phách (Turmeric Gold & Amber)
 * - 3 slots (15%): Vàng cam nhạt (Soft Warm Apricot Gold)
 * - 2 slots (10%): Nâu đỏ trầm (Russet / Autumn Red-Brown)
 * - 1 slot  ( 5%): Xanh rêu / xanh vàng nhẹ (Moss Olive-Chartreuse)
 */
const AUTUMN_WEIGHTED_PALETTE: readonly number[] = [
  0x9e1b16, // Đỏ rượu vang (25%)
  0xde4820, // Đỏ cam (25%)
  0xe89c24, // Vàng nghệ (20%)
  0xb8221a, // Đỏ thẫm (25%)
  0xf2b441, // Vàng cam nhạt (15%)
  0xd43d1c, // Cam cháy (25%)
  0x8c2d19, // Nâu đỏ (10%)
  0xeb5a24, // Đỏ cam tươi (25%)
  0xdf8b1f, // Vàng hổ phách (20%)
  0x851612, // Đỏ rượu vang đậm (25%)
  0xf5be52, // Vàng cam nhạt (15%)
  0x889e3a, // Xanh rêu vàng nhẹ (5%)
  0xc9351c, // Cam cháy đậm (25%)
  0xe59622, // Vàng nghệ ấm (20%)
  0xa81e17, // Đỏ thẫm (25%)
  0x7d2816, // Nâu đỏ cổ thụ (10%)
  0xe34e22, // Đỏ cam (25%)
  0xeda328, // Vàng hổ phách sáng (20%)
  0xab1d16, // Đỏ thẫm (25%)
  0xf0af3c, // Vàng cam nhạt (15%)
];

/**
 * Picks a deterministic autumn color for a tree so adjacent trees never share the same hue,
 * and distant layers (Layer 3 & Layer 4) soften gently into warm autumn mist.
 */
function pickAutumnTreeColor(index: number, layer: 1 | 2 | 3 | 4, out: Color): Color {
  const step = (index * 7 + layer * 3) % AUTUMN_WEIGHTED_PALETTE.length;
  const baseHex = AUTUMN_WEIGHTED_PALETTE[step] ?? 0xc9351c;
  out.setHex(baseHex);

  if (layer === 3) {
    // Layer 3 (Background): slightly softer saturation, warm golden-russet atmospheric blend.
    out.lerp(new Color(0xd98a54), 0.16);
  } else if (layer === 4) {
    // Layer 4 (Distant Horizon): soft amber-brown & pale orange-red mist tone for 3D depth.
    out.lerp(new Color(0xd6986b), 0.34);
  }
  return out;
}

// ============================================================================
// SHADERS: ASYNCHRONOUS GENTLE BREEZE & MULTI-TONE SUNLIT TRANSLUCENCY
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
        float branchWeight = clamp((transformed.y - 1.4) * 0.18, 0.0, 1.0);
        float treePhase = treePos.x * 0.37 + treePos.y * 0.53;
        float boughSway = branchWeight * 0.022 * sin(uTime * 1.05 + treePhase + transformed.x * 0.5);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Foliage shader:
 * - Asynchronous gentle breeze per tree and per leaf cluster (calm meditation pace).
 * - Preserves outward-domed normals on both sides of `DoubleSide` leaf fronds.
 * - Creates 2–3 distinct color tones on every single tree canopy:
 *   + Sun-facing & top crown (`vSunShift`): warm golden-orange highlight.
 *   + Shaded underside & inner crown (`vShadeShift`): deep reddish-brown shadow.
 *   + Backlit sunlight translucency through maple leaves.
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
        float heightNorm = clamp((transformed.y - 1.2) / 6.5, 0.0, 1.0);
        float sunSide = clamp(
          dot(normalize( vec3(transformed.x, max(0.2, transformed.y - 1.5), transformed.z) ), vec3(0.45, 0.78, 0.35)),
          0.0,
          1.0
        );
        vSunShift = clamp(heightNorm * 0.55 + sunSide * 0.55, 0.0, 1.0);
        vShadeShift = clamp((1.0 - heightNorm) * 0.65 + (1.0 - sunSide) * 0.35, 0.0, 1.0);

        float swayWeight = clamp((transformed.y - 1.2) * 0.22, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 1.15 + transformed.z * 1.05 + transformed.y * 0.7;
        float swayX = swayWeight * (0.032 * sin(uTime * 1.15 + treePhase + clusterPhase) + 0.014 * cos(uTime * 2.1 - clusterPhase));
        float swayZ = swayWeight * (0.026 * cos(uTime * 1.05 + treePhase * 1.3 + clusterPhase));
        transformed.x += swayX;
        transformed.y += (swayX + swayZ) * 0.12;
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
        // Multi-tone gradient within each tree's own canopy:
        // lower/inner canopy deepens toward reddish-brown; upper/sunlit canopy shifts toward warm golden-orange.
        vec3 deepRedBrown = diffuseColor.rgb * vec3(0.62, 0.42, 0.35);
        vec3 sunlitAmber = mix(diffuseColor.rgb, vec3(1.0, 0.76, 0.28), 0.32) * 1.16;
        diffuseColor.rgb = mix(diffuseColor.rgb, deepRedBrown, vShadeShift * 0.48);
        diffuseColor.rgb = mix(diffuseColor.rgb, sunlitAmber, vSunShift * 0.52);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `// Subsurface golden sunlight filtering through Japanese Maple leaves
        outgoingLight += diffuseColor.rgb * (0.07 + 0.16 * vSunShift);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// 5–7 LOBE PALMATE JAPANESE MAPLE LEAF ATLAS (`1024x1024`)
// ============================================================================

/**
 * Draws an airy, high-resolution 1024x1024 botanical branchlet spray of 5- and 7-lobed
 * Japanese Maple leaves (`Acer palmatum`) with delicate petioles, twigs, palmate veins,
 * and natural spacing between leaf clusters so light and branches show through.
 */
function drawMapleClusterTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0x5a91e77);

  // Fine branching woody twigs with petioles (leaf stems) reaching out to leaf groups.
  ctx.strokeStyle = "#422717";
  ctx.lineCap = "round";
  const branches: readonly [number, number, number, number, number, number, number][] = [
    [0.5, 0.88, 0.49, 0.54, 0.5, 0.16, 0.0075],
    [0.49, 0.7, 0.32, 0.6, 0.16, 0.46, 0.0055],
    [0.5, 0.66, 0.68, 0.56, 0.84, 0.42, 0.0055],
    [0.49, 0.46, 0.34, 0.36, 0.2, 0.24, 0.0048],
    [0.5, 0.42, 0.66, 0.32, 0.8, 0.22, 0.0048],
  ];
  for (const [x0, y0, cx, cy, x1, y1, w] of branches) {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * cx, size * cy, size * x1, size * y1);
    ctx.stroke();
  }

  /**
   * Draws a single authentic 5- or 7-lobed palmate Japanese Maple leaf (hand-shaped with sharp acuminate tips,
   * deep V-sinuses, serrated margins, and a slender petiole stem).
   */
  const drawJapaneseMapleLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    lobes: 5 | 7,
    innerLum: string,
    outerLum: string,
    tipLum: string,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Slender petiole stem
    ctx.strokeStyle = "#5c341d";
    ctx.lineWidth = Math.max(1.2, radius * 0.032);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.42);
    ctx.quadraticCurveTo(radius * 0.04, radius * 0.24, 0, radius * 0.06);
    ctx.stroke();

    const angles7 = [-1.96, -1.32, -0.64, 0, 0.64, 1.32, 1.96] as const;
    const lengths7 = [0.44, 0.76, 0.96, 1.12, 0.96, 0.76, 0.44] as const;
    const widths7 = [0.11, 0.16, 0.19, 0.21, 0.19, 0.16, 0.11] as const;

    const angles5 = [-1.42, -0.68, 0, 0.68, 1.42] as const;
    const lengths5 = [0.68, 0.95, 1.12, 0.95, 0.68] as const;
    const widths5 = [0.15, 0.19, 0.21, 0.19, 0.15] as const;

    const lobeAngles = lobes === 7 ? angles7 : angles5;
    const lobeLengths = lobes === 7 ? lengths7 : lengths5;
    const lobeWidths = lobes === 7 ? widths7 : widths5;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.1);

    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]!;
      const wid = radius * lobeWidths[i]!;
      const perp = a + Math.PI * 0.5;

      const tipX = Math.cos(a) * len;
      const tipY = Math.sin(a) * len;

      // Serrated teeth along the left edge of the lobe
      const l1x = Math.cos(a) * (len * 0.38) - Math.cos(perp) * (wid * 0.78);
      const l1y = Math.sin(a) * (len * 0.38) - Math.sin(perp) * (wid * 0.78);
      const l2x = Math.cos(a) * (len * 0.62) - Math.cos(perp) * (wid * 0.92);
      const l2y = Math.sin(a) * (len * 0.62) - Math.sin(perp) * (wid * 0.92);
      const l3x = Math.cos(a) * (len * 0.82) - Math.cos(perp) * (wid * 0.44);
      const l3y = Math.sin(a) * (len * 0.82) - Math.sin(perp) * (wid * 0.44);

      // Serrated teeth along the right edge of the lobe
      const r3x = Math.cos(a) * (len * 0.82) + Math.cos(perp) * (wid * 0.44);
      const r3y = Math.sin(a) * (len * 0.82) + Math.sin(perp) * (wid * 0.44);
      const r2x = Math.cos(a) * (len * 0.62) + Math.cos(perp) * (wid * 0.92);
      const r2y = Math.sin(a) * (len * 0.62) + Math.sin(perp) * (wid * 0.92);
      const r1x = Math.cos(a) * (len * 0.38) + Math.cos(perp) * (wid * 0.78);
      const r1y = Math.sin(a) * (len * 0.38) + Math.sin(perp) * (wid * 0.78);

      ctx.lineTo(l1x, l1y);
      ctx.lineTo(l2x, l2y);
      ctx.lineTo(l3x, l3y);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(r3x, r3y);
      ctx.lineTo(r2x, r2y);
      ctx.lineTo(r1x, r1y);

      // Deep palmate sinus between lobes so each leaf reads unmistakably as a Japanese Maple hand leaf
      if (i < lobeAngles.length - 1) {
        const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
        const midA = (a + nextA) * 0.5;
        const notchR = radius * 0.22;
        ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
      }
    }

    ctx.closePath();

    const grad = ctx.createRadialGradient(0, 0, radius * 0.06, 0, -radius * 0.15, radius * 1.08);
    grad.addColorStop(0, innerLum);
    grad.addColorStop(0.65, outerLum);
    grad.addColorStop(1, tipLum);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.2, radius * 0.025);
    ctx.strokeStyle = "rgba(56, 32, 18, 0.62)";
    ctx.stroke();

    // Fine palmate veins radiating into each lobe
    ctx.strokeStyle = "rgba(255, 248, 225, 0.52)";
    ctx.lineWidth = Math.max(0.9, radius * 0.018);
    for (let i = 0; i < lobeAngles.length; i++) {
      const a = lobeAngles[i]! - Math.PI * 0.5;
      const len = radius * lobeLengths[i]! * 0.86;
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.06);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    ctx.restore();
  };

  // Arrange leaves into 5 natural sub-bouquets along the twigs (leaving breathing gaps between bouquets!).
  const bouquetCenters: readonly [number, number, number][] = [
    [0.5, 0.22, 0.18],
    [0.24, 0.34, 0.17],
    [0.76, 0.32, 0.17],
    [0.22, 0.56, 0.18],
    [0.78, 0.54, 0.18],
    [0.5, 0.52, 0.19],
  ];

  const backTones: readonly [string, string, string][] = [
    ["#b8aa96", "#d6c8b4", "#a89882"],
    ["#c2b4a0", "#dfd2be", "#b2a28c"],
  ];
  const frontTones: readonly [string, string, string][] = [
    ["#ded4c3", "#f7f0e4", "#ffffff"],
    ["#d6ccba", "#f0e8da", "#fcf8f0"],
    ["#e6dece", "#faf5eb", "#ffffff"],
  ];

  // Pass 1: Shaded under-leaves in each bouquet
  for (let b = 0; b < bouquetCenters.length; b++) {
    const [bx, by, bSpread] = bouquetCenters[b]!;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + b * 0.9 + (rand() - 0.5) * 0.4;
      const d = (0.25 + rand() * 0.55) * bSpread * size;
      const lx = bx * size + Math.cos(a) * d;
      const ly = by * size + Math.sin(a) * d;
      const r = (0.082 + rand() * 0.036) * size;
      const pal = backTones[(b + k) % backTones.length]!;
      drawJapaneseMapleLeaf(lx, ly, r, a + Math.PI * 0.5 + (rand() - 0.5) * 0.5, k % 2 === 0 ? 7 : 5, pal[0], pal[1], pal[2]);
    }
  }

  // Pass 2: Sunlit upper leaves in each bouquet (varied sizes)
  for (let b = 0; b < bouquetCenters.length; b++) {
    const [bx, by, bSpread] = bouquetCenters[b]!;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.52 + b * 1.1 + (rand() - 0.5) * 0.35;
      const d = (0.1 + rand() * 0.48) * bSpread * size;
      const lx = bx * size + Math.cos(a) * d;
      const ly = by * size + Math.sin(a) * d;
      const r = (0.088 + rand() * 0.04) * size;
      const pal = frontTones[(b + k) % frontTones.length]!;
      drawJapaneseMapleLeaf(lx, ly, r, a + Math.PI * 0.5 + (rand() - 0.5) * 0.45, 7, pal[0], pal[1], pal[2]);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// PROCEDURAL 3D TREE BUILDERS: 8 DISTINCT JAPANESE MAPLE ARCHETYPES
// ============================================================================

/**
 * Builds a curved tubular trunk or branch spline with natural bark crevices, flared base,
 * and rich bark vertex colors (dark brown, reddish-brown, or weathered grey-brown).
 */
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

/**
 * Builds one arched leaf-frond card.
 */
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
    -0.5, -0.03, -0.5,
    0.5, -0.03, -0.5,
    0.5, -0.03, 0.5,
    -0.5, -0.03, 0.5,
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
 * Builds an airy, layered Japanese Maple Foliage Tier ("tầng mây lá phong"):
 * - Flat/domed horizontal layering (never a sphere, never a vertical wall) so branches remain visible between tiers.
 * - Irregular protruding outer leaf sprays (`mép tán lá không đều, có những nhánh lá nhô ra`).
 * - Optional weeping droop (`droop > 0`) for cascading maple varieties.
 */
function buildLayeredMaplePad(
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

  const shHex = 0x736358;
  const mdHex = 0xd6cdc0;
  const brHex = 0xfffdf6;

  // Inner shaded base fronds
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI + rand() * 0.9;
    const d = width * (0.14 + rand() * 0.14);
    const s = width * (0.72 + rand() * 0.18);
    parts.push(
      buildArchedLeafFrond(
        cx + Math.cos(a) * d,
        cy - 0.08 - droop * 0.12,
        cz + Math.sin(a) * d,
        s,
        s * 0.92,
        0.15,
        a,
        0.22 + droop * 0.35,
        (rand() - 0.5) * 0.22,
        shHex,
        mdHex,
        center,
      ),
    );
  }

  // Irregular outer radiating fronds with protruding branchlet tips
  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.38;
    const isProtruding = i % 2 === 0;
    const reach = width * (isProtruding ? 0.42 + rand() * 0.22 : 0.24 + rand() * 0.16);
    const s = width * (isProtruding ? 0.68 + rand() * 0.2 : 0.76 + rand() * 0.18);
    const dy = (isProtruding ? -0.04 : 0.08) - droop * (0.18 + rand() * 0.15) + (rand() - 0.5) * 0.06;
    const pitch = 0.18 + droop * 0.48 + (rand() - 0.5) * 0.16;

    parts.push(
      buildArchedLeafFrond(
        cx + Math.cos(a) * reach,
        cy + dy,
        cz + Math.sin(a) * reach,
        s,
        s * (0.88 + rand() * 0.2),
        0.16,
        a + (rand() - 0.5) * 0.3,
        pitch,
        (rand() - 0.5) * 0.24,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  // Sunlit top crown frond
  const topS = width * (0.7 + rand() * 0.18);
  parts.push(
    buildArchedLeafFrond(
      cx + (rand() - 0.5) * 0.12,
      cy + 0.16,
      cz + (rand() - 0.5) * 0.12,
      topS,
      topS,
      0.18,
      rand() * Math.PI * 2,
      (rand() - 0.5) * 0.16,
      (rand() - 0.5) * 0.16,
      mdHex,
      brHex,
      center,
    ),
  );

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: layered maple pad");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"   // 1. Cây phong cổ thụ (10–13m, thân lớn, tán cực rộng)
  | "spreading" // 2. Cây phong tán xòe (7–9m, cành vươn ngang)
  | "rounded"   // 3. Cây phong tán tròn (6–8m, nhiều tầng lá)
  | "weeping"   // 4. Cây phong dáng rủ (6–8m, tán rủ nhẹ)
  | "curved"    // 5. Cây phong thân cong (5–7m)
  | "small"     // 6. Cây phong nhỏ (3.5–5m)
  | "airy"      // 7. Cây phong tán thưa (5–7m, nhìn rõ nhánh)
  | "shrub";    // 8. Cây phong bụi (2–3m, tạo lớp cây thấp)

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
  // 1. Cây phong cổ thụ (11.5m base height, wide gnarled trunk, 5 wide spreading tiers)
  {
    id: "ancient",
    baseHeight: 11.5,
    trunkBaseR: 0.42,
    trunkTopR: 0.14,
    barkColors: [0x3b2618, 0x5c3d28],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 1.4, -0.06],
      [-0.12, 3.1, 0.08],
      [-0.04, 4.8, 0.02],
      [0.05, 6.4, -0.04],
    ],
    boughs: [
      { angle: 0.2, startY: 3.0, midR: 2.1, midY: 4.1, endR: 4.2, endY: 4.8, radius: 0.18, padWidth: 2.3, droop: 0.08, subForks: 2 },
      { angle: 1.45, startY: 3.4, midR: 1.9, midY: 4.6, endR: 3.9, endY: 5.4, radius: 0.17, padWidth: 2.2, droop: 0.06, subForks: 2 },
      { angle: 2.75, startY: 3.2, midR: 2.2, midY: 4.3, endR: 4.4, endY: 5.1, radius: 0.18, padWidth: 2.35, droop: 0.08, subForks: 2 },
      { angle: 4.0, startY: 3.8, midR: 1.8, midY: 5.1, endR: 3.7, endY: 6.1, radius: 0.16, padWidth: 2.1, droop: 0.05, subForks: 2 },
      { angle: 5.25, startY: 4.2, midR: 1.7, midY: 5.6, endR: 3.5, endY: 6.6, radius: 0.15, padWidth: 2.0, droop: 0.05, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 8.2, z: 0.0, width: 2.5, droop: 0.04 },
      { x: -1.6, y: 7.4, z: 1.1, width: 2.1, droop: 0.05 },
      { x: 1.5, y: 7.5, z: -1.2, width: 2.1, droop: 0.05 },
      { x: 0.4, y: 7.8, z: 1.6, width: 1.95, droop: 0.04 },
    ],
  },

  // 2. Cây phong tán xòe (8.2m base height, wide horizontal boughs)
  {
    id: "spreading",
    baseHeight: 8.2,
    trunkBaseR: 0.28,
    trunkTopR: 0.095,
    barkColors: [0x4a2c1d, 0x694330],
    trunkCurve: [
      [0, 0, 0],
      [-0.07, 1.1, 0.05],
      [0.11, 2.3, -0.06],
      [0.06, 3.6, -0.03],
      [-0.04, 4.7, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 2.2, midR: 1.9, midY: 2.8, endR: 3.8, endY: 3.2, radius: 0.13, padWidth: 2.05, droop: 0.06, subForks: 2 },
      { angle: 1.65, startY: 2.5, midR: 1.8, midY: 3.3, endR: 3.6, endY: 3.8, radius: 0.12, padWidth: 1.95, droop: 0.06, subForks: 2 },
      { angle: 3.15, startY: 2.35, midR: 2.0, midY: 3.0, endR: 3.9, endY: 3.5, radius: 0.13, padWidth: 2.1, droop: 0.06, subForks: 2 },
      { angle: 4.7, startY: 2.8, midR: 1.7, midY: 3.7, endR: 3.4, endY: 4.3, radius: 0.11, padWidth: 1.85, droop: 0.05, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 5.6, z: 0.0, width: 2.2, droop: 0.04 },
      { x: -1.4, y: 5.0, z: -0.8, width: 1.85, droop: 0.05 },
      { x: 1.4, y: 5.1, z: 0.9, width: 1.85, droop: 0.05 },
    ],
  },

  // 3. Cây phong tán tròn (7.2m base height, balanced 4-tier dome)
  {
    id: "rounded",
    baseHeight: 7.2,
    trunkBaseR: 0.24,
    trunkTopR: 0.085,
    barkColors: [0x423126, 0x5e4738],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 1.0, 0.03],
      [-0.06, 2.2, -0.04],
      [0.02, 3.4, 0.02],
      [0.0, 4.4, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 2.1, midR: 1.4, midY: 2.9, endR: 2.6, endY: 3.5, radius: 0.11, padWidth: 1.8, droop: 0.08, subForks: 2 },
      { angle: 1.95, startY: 2.3, midR: 1.35, midY: 3.2, endR: 2.5, endY: 3.8, radius: 0.1, padWidth: 1.75, droop: 0.08, subForks: 2 },
      { angle: 3.5, startY: 2.2, midR: 1.45, midY: 3.0, endR: 2.7, endY: 3.6, radius: 0.11, padWidth: 1.85, droop: 0.08, subForks: 2 },
      { angle: 5.05, startY: 2.5, midR: 1.3, midY: 3.4, endR: 2.4, endY: 4.1, radius: 0.1, padWidth: 1.7, droop: 0.07, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 5.3, z: 0.0, width: 2.0, droop: 0.05 },
      { x: -0.9, y: 4.7, z: 0.8, width: 1.75, droop: 0.06 },
      { x: 0.9, y: 4.8, z: -0.8, width: 1.75, droop: 0.06 },
    ],
  },

  // 4. Cây phong dáng rủ (7.0m base height, arching & cascading boughs)
  {
    id: "weeping",
    baseHeight: 7.0,
    trunkBaseR: 0.23,
    trunkTopR: 0.08,
    barkColors: [0x472b20, 0x633e2f],
    trunkCurve: [
      [0, 0, 0],
      [0.09, 1.1, -0.05],
      [0.18, 2.3, -0.1],
      [0.08, 3.5, -0.04],
      [-0.05, 4.4, 0.03],
    ],
    boughs: [
      { angle: 0.25, startY: 2.3, midR: 1.6, midY: 3.4, endR: 2.9, endY: 2.6, radius: 0.1, padWidth: 1.75, droop: 0.42, subForks: 2 },
      { angle: 1.8, startY: 2.5, midR: 1.5, midY: 3.6, endR: 2.8, endY: 2.8, radius: 0.095, padWidth: 1.7, droop: 0.42, subForks: 2 },
      { angle: 3.35, startY: 2.4, midR: 1.65, midY: 3.5, endR: 3.0, endY: 2.7, radius: 0.1, padWidth: 1.8, droop: 0.45, subForks: 2 },
      { angle: 4.9, startY: 2.7, midR: 1.45, midY: 3.8, endR: 2.7, endY: 3.0, radius: 0.09, padWidth: 1.65, droop: 0.38, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 5.0, z: 0.0, width: 1.9, droop: 0.28 },
      { x: -1.1, y: 4.3, z: 0.6, width: 1.65, droop: 0.35 },
      { x: 1.1, y: 4.4, z: -0.7, width: 1.65, droop: 0.35 },
    ],
  },

  // 5. Cây phong thân cong (6.2m base height, expressive S-curve trunk)
  {
    id: "curved",
    baseHeight: 6.2,
    trunkBaseR: 0.21,
    trunkTopR: 0.075,
    barkColors: [0x4c372b, 0x6b4f3f],
    trunkCurve: [
      [0, 0, 0],
      [-0.22, 0.95, 0.12],
      [-0.32, 2.0, 0.18],
      [0.14, 3.1, -0.08],
      [0.26, 4.1, -0.14],
    ],
    boughs: [
      { angle: 0.6, startY: 2.0, midR: 1.4, midY: 2.6, endR: 2.5, endY: 3.0, radius: 0.095, padWidth: 1.65, droop: 0.1, subForks: 1 },
      { angle: 2.5, startY: 2.5, midR: 1.3, midY: 3.2, endR: 2.4, endY: 3.6, radius: 0.09, padWidth: 1.6, droop: 0.08, subForks: 2 },
      { angle: 4.4, startY: 2.9, midR: 1.35, midY: 3.6, endR: 2.45, endY: 4.0, radius: 0.085, padWidth: 1.6, droop: 0.08, subForks: 1 },
    ],
    crownPads: [
      { x: 0.25, y: 4.7, z: -0.15, width: 1.85, droop: 0.06 },
      { x: -0.8, y: 4.2, z: 0.5, width: 1.55, droop: 0.08 },
    ],
  },

  // 6. Cây phong nhỏ (4.3m base height, graceful young maple)
  {
    id: "small",
    baseHeight: 4.3,
    trunkBaseR: 0.15,
    trunkTopR: 0.055,
    barkColors: [0x4a3324, 0x664834],
    trunkCurve: [
      [0, 0, 0],
      [0.06, 0.8, -0.04],
      [-0.05, 1.7, 0.03],
      [0.03, 2.6, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.4, midR: 0.95, midY: 1.9, endR: 1.75, endY: 2.3, radius: 0.07, padWidth: 1.35, droop: 0.08, subForks: 1 },
      { angle: 2.4, startY: 1.6, midR: 0.9, midY: 2.1, endR: 1.7, endY: 2.5, radius: 0.065, padWidth: 1.3, droop: 0.08, subForks: 1 },
      { angle: 4.5, startY: 1.75, midR: 0.92, midY: 2.3, endR: 1.65, endY: 2.7, radius: 0.065, padWidth: 1.3, droop: 0.08, subForks: 1 },
    ],
    crownPads: [
      { x: 0.0, y: 3.2, z: 0.0, width: 1.5, droop: 0.05 },
    ],
  },

  // 7. Cây phong tán thưa (6.2m base height, open-branch structure clearly visible)
  {
    id: "airy",
    baseHeight: 6.2,
    trunkBaseR: 0.22,
    trunkTopR: 0.075,
    barkColors: [0x3d281c, 0x5c3f2e],
    trunkCurve: [
      [0, 0, 0],
      [0.1, 1.1, 0.06],
      [-0.08, 2.3, -0.05],
      [-0.14, 3.4, -0.08],
      [0.04, 4.3, 0.02],
    ],
    boughs: [
      { angle: 0.15, startY: 1.9, midR: 1.5, midY: 2.6, endR: 2.8, endY: 3.1, radius: 0.095, padWidth: 1.25, droop: 0.05, subForks: 2 },
      { angle: 1.75, startY: 2.3, midR: 1.4, midY: 3.1, endR: 2.6, endY: 3.7, radius: 0.09, padWidth: 1.2, droop: 0.05, subForks: 2 },
      { angle: 3.3, startY: 2.1, midR: 1.55, midY: 2.8, endR: 2.9, endY: 3.4, radius: 0.095, padWidth: 1.25, droop: 0.05, subForks: 2 },
      { angle: 4.85, startY: 2.6, midR: 1.35, midY: 3.4, endR: 2.5, endY: 4.1, radius: 0.085, padWidth: 1.18, droop: 0.05, subForks: 2 },
    ],
    crownPads: [
      { x: 0.0, y: 4.9, z: 0.0, width: 1.35, droop: 0.04 },
    ],
  },

  // 8. Cây phong bụi (2.6m base height, low multi-stem shrub)
  {
    id: "shrub",
    baseHeight: 2.6,
    trunkBaseR: 0.11,
    trunkTopR: 0.04,
    barkColors: [0x453022, 0x5e4332],
    trunkCurve: [
      [0, 0, 0],
      [0.04, 0.5, -0.03],
      [-0.03, 1.1, 0.02],
      [0.0, 1.6, 0.0],
    ],
    boughs: [
      { angle: 0.5, startY: 0.35, midR: 0.7, midY: 0.85, endR: 1.35, endY: 1.25, radius: 0.055, padWidth: 1.15, droop: 0.12, subForks: 1 },
      { angle: 2.6, startY: 0.4, midR: 0.68, midY: 0.9, endR: 1.3, endY: 1.35, radius: 0.055, padWidth: 1.15, droop: 0.12, subForks: 1 },
      { angle: 4.7, startY: 0.38, midR: 0.72, midY: 0.88, endR: 1.38, endY: 1.3, radius: 0.055, padWidth: 1.15, droop: 0.12, subForks: 1 },
    ],
    crownPads: [
      { x: 0.0, y: 1.85, z: 0.0, width: 1.3, droop: 0.08 },
    ],
  },
];

/**
 * Builds the 2-group BufferGeometry (Group 0 = Bark, Group 1 = Foliage) for one of the 8 Maple Archetypes.
 */
function buildArchetypeGeometry(spec: ArchetypeSpec, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  // 1. Main curved trunk with flared base ("gốc cây hơi bè rộng")
  const trunkPts = spec.trunkCurve.map(([x, y, z]) => new Vector3(x, y, z));
  const n = trunkPts.length;
  const trunkRadii = trunkPts.map((_, i) => {
    const t = i / Math.max(1, n - 1);
    const flare = i === 0 ? 1.32 : 1.0;
    return (spec.trunkBaseR * (1 - t) + spec.trunkTopR * t) * flare;
  });
  barkParts.push(
    buildCurvedBranchSegment(trunkPts, trunkRadii, spec.id === "ancient" ? 6 : 5, spec.barkColors[0], spec.barkColors[1], true),
  );

  // Flared root buttresses for large trees (Ancient & Spreading)
  if (spec.id === "ancient" || spec.id === "spreading") {
    const rootCount = spec.id === "ancient" ? 4 : 3;
    for (let r = 0; r < rootCount; r++) {
      const a = (r / rootCount) * Math.PI * 2 + 0.4;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rPts = [
        new Vector3(ca * spec.trunkBaseR * 0.45, 0.65, sa * spec.trunkBaseR * 0.45),
        new Vector3(ca * spec.trunkBaseR * 1.15, 0.25, sa * spec.trunkBaseR * 1.15),
        new Vector3(ca * spec.trunkBaseR * 1.75, 0.0, sa * spec.trunkBaseR * 1.75),
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

  // 2. Primary boughs, secondary twigs, and layered foliage pads (with gaps so trunk & branches show through!)
  for (const b of spec.boughs) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.6, b.startY, sa * spec.trunkTopR * 0.6);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildCurvedBranchSegment([p0, p1, p2], [b.radius, b.radius * 0.66, b.radius * 0.32], 4, spec.barkColors[0], spec.barkColors[1]),
    );

    // Primary bough tip foliage pad
    leafParts.push(
      buildLayeredMaplePad(p2.x, p2.y + 0.08, p2.z, b.padWidth, b.droop, 4, rand),
    );

    // Secondary branch forks radiating out in different directions
    for (let f = 0; f < b.subForks; f++) {
      const side = f === 0 ? -1 : 1;
      const fAngle = b.angle + side * (0.48 + rand() * 0.14);
      const fca = Math.cos(fAngle);
      const fsa = Math.sin(fAngle);
      const fReach = b.endR * (0.88 + rand() * 0.22);
      const fEndY = b.endY + (f === 0 ? 0.35 : -0.22) - b.droop * 0.4;

      const fp1 = new Vector3((p1.x + fca * fReach) * 0.5, (p1.y + fEndY) * 0.52, (p1.z + fsa * fReach) * 0.5);
      const fp2 = new Vector3(fca * fReach, fEndY, fsa * fReach);

      barkParts.push(
        buildCurvedBranchSegment([p1, fp1, fp2], [b.radius * 0.55, b.radius * 0.32, 0.025], 3, spec.barkColors[0], spec.barkColors[1]),
      );

      leafParts.push(
        buildLayeredMaplePad(fp2.x, fp2.y + 0.06, fp2.z, b.padWidth * 0.82, b.droop, 3, rand),
      );
    }
  }

  // 3. Upper crown pads
  for (const cp of spec.crownPads) {
    leafParts.push(buildLayeredMaplePad(cp.x, cp.y, cp.z, cp.width, cp.droop, 4, rand));
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
 * Builds the dedicated Golden-Crimson Wishing Tree geometry for `wishing-tree.ts`
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
  barkParts.push(buildCurvedBranchSegment(trunkPts, [0.34, 0.25, 0.2, 0.15, 0.1], 6, 0x3b2618, 0x5c3d28, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.65, 3.85 + (i % 2) * 0.18, sa * 2.65);
    barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [0.13, 0.09, 0.04], 4, 0x4a3121, 0x694732));

    leafParts.push(
      buildLayeredMaplePad(p1.x, p1.y + 0.55, p1.z, 1.55, 0.06, 4, rand),
      buildLayeredMaplePad(p2.x, p2.y + 0.35, p2.z, 1.65, 0.08, 4, rand),
    );
  }

  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.25;
    const cy = c === 0 ? 6.15 : 5.25;
    leafParts.push(buildLayeredMaplePad(Math.cos(a) * rad, cy, Math.sin(a) * rad, 1.75, 0.05, 4, rand));
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
// 4-LAYER SPATIAL FOREST LAYOUT & CAMERA-FRAMED PLACEMENT
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

/**
 * Generates the 4 spatial layers of the Japanese Maple Autumn Forest:
 * - Layer 1 (Foreground): Large Ancient & Spreading Maples framing the left and right edges of the camera view.
 * - Layer 2 (Midground): Main perimeter around the courtyard (5–9m trees mixed with low shrubs, irregular spacing, alternating heights).
 * - Layer 3 (Background): Continuous multi-layered forest behind the Hall, East Pond, and West Garden.
 * - Layer 4 (Distant Horizon): Smaller, softer-toned trees along the horizon line.
 */
function buildFourLayerForestLayout(rand: () => number): TreeInstanceRecord[] {
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

  const addTree = (
    variantIdx: number,
    x: number,
    z: number,
    scaleMult: number,
    layer: 1 | 2 | 3 | 4,
    forcedHex?: number,
  ): void => {
    const yaw = rand() * Math.PI * 2;
    const sx = scaleMult * (0.92 + rand() * 0.18);
    const sz = scaleMult * (0.92 + rand() * 0.18);
    if (forcedHex !== undefined) {
      tmpColor.setHex(forcedHex);
    } else {
      pickAutumnTreeColor(colorCounter++, layer, tmpColor);
    }
    records.push({
      variantIndex: variantIdx,
      matrix: place(x, 0, z, yaw, sx, scaleMult, sz).clone(),
      color: tmpColor.clone(),
    });
  };

  // --------------------------------------------------------------------------
  // LAYER 1 – CÂY TIỀN CẢNH (Foreground Framing Trees on Left & Right Camera Edges)
  // Large Ancient (0) & Spreading (1) Maples framing the left (-X) and right (+X) sides.
  // --------------------------------------------------------------------------
  const foregroundAnchors: readonly { a: number; r: number; variant: number; scale: number; hex: number }[] = [
    // Left camera edge (-X, near gate & west garden border) — Crimson & Red-Orange
    { a: Math.PI * 0.64, r: 1.01, variant: 0, scale: 1.05, hex: 0xb8221a },
    { a: Math.PI * 0.74, r: 1.02, variant: 1, scale: 1.12, hex: 0xde4820 },
    { a: Math.PI * 0.85, r: 1.01, variant: 0, scale: 0.98, hex: 0x9e1b16 },
    { a: Math.PI * 0.96, r: 1.03, variant: 3, scale: 1.08, hex: 0xe89c24 },
    // Right camera edge (+X, near gate & east pond border) — Red-Orange & Golden-Red
    { a: Math.PI * 0.36, r: 1.01, variant: 0, scale: 1.06, hex: 0xd43d1c },
    { a: Math.PI * 0.26, r: 1.02, variant: 1, scale: 1.1, hex: 0xe89c24 },
    { a: Math.PI * 0.15, r: 1.01, variant: 0, scale: 1.0, hex: 0xeb5a24 },
    { a: Math.PI * 0.04, r: 1.03, variant: 4, scale: 1.12, hex: 0xb8221a },
  ];

  for (const fg of foregroundAnchors) {
    const p = ringPoint(fg.a, fg.r);
    addTree(fg.variant, p.x, p.z, fg.scale, 1, fg.hex);
    // Companion low Maple Shrub (7) or Small Maple (5) nestled near the foreground giant's base
    const subA = fg.a + (rand() - 0.5) * 0.06;
    const subP = ringPoint(subA, fg.r + 0.03);
    addTree(7, subP.x, subP.z, 0.85 + rand() * 0.35, 1);
  }

  // --------------------------------------------------------------------------
  // LAYER 2 – CÂY TRUNG CẢNH (Main Courtyard Perimeter — Irregular Spacing, Mixed Heights)
  // Uses Variants 1..7 (Spreading, Rounded, Weeping, Curved, Small, Airy, Shrub).
  // --------------------------------------------------------------------------
  const midCount = IS_MOBILE ? 36 : 46;
  const midArc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  const midVariantsTall = [1, 2, 3, 4, 6] as const;
  const midVariantsLow = [5, 6, 7] as const;

  let cursor = 0;
  for (let i = 0; i < midCount; i++) {
    // Non-uniform, organic angular step (0.55x to 1.45x average step) so trees cluster naturally with breathing gaps
    const stepWeight = 0.55 + rand() * 0.9;
    cursor += stepWeight;
    const u = (cursor / (midCount * 1.0)) % 1;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * midArc;
    const r = 1.04 + rand() * 0.18;
    const p = ringPoint(a, r);

    // Alternate tall (6–9m) and lower (2.5–6m) trees
    const pool = i % 3 === 0 ? midVariantsLow : midVariantsTall;
    const vIdx = pickNonRepeatingVariant(pool);
    const scaleMult = 0.78 + rand() * 0.48;
    addTree(vIdx, p.x, p.z, scaleMult, 2);
  }

  // --------------------------------------------------------------------------
  // LAYER 3 – CÂY HẬU CẢNH (Continuous Background Forest behind Hall & Pavilions)
  // Extra density in the northern semicircle (`a` in `π..2π`, behind the Hall & flanking gardens)
  // so looking past the temple reveals a continuous, multi-layered Japanese Maple forest.
  // --------------------------------------------------------------------------
  const bgCount = IS_MOBILE ? 44 : 58;
  const bgArc = Math.PI * 2 - 2 * (GATE_GAP_RAD * 0.75);
  const bgVariants = [0, 1, 2, 3, 4, 6] as const;

  for (let i = 0; i < bgCount; i++) {
    const u = (i + 0.5 + (rand() - 0.5) * 0.35) / bgCount;
    const a = Math.PI / 2 + GATE_GAP_RAD * 0.75 + u * bgArc;
    const r = 1.24 + (i % 3) * 0.11 + rand() * 0.12;
    const p = ringPoint(a, r);

    const vIdx = pickNonRepeatingVariant(bgVariants);
    const scaleMult = 0.85 + rand() * 0.45;
    addTree(vIdx, p.x, p.z, scaleMult, 3);
  }

  // --------------------------------------------------------------------------
  // LAYER 4 – RỪNG XA (Distant Horizon Forest — Soft Silhouette & Atmospheric Depth)
  // --------------------------------------------------------------------------
  const farCount = IS_MOBILE ? 48 : 64;
  const farArc = Math.PI * 2 - 2 * (GATE_GAP_RAD * 0.5);
  const farVariants = [0, 1, 2, 5] as const;

  for (let i = 0; i < farCount; i++) {
    const u = (i + (i % 2) * 0.35 + (rand() - 0.5) * 0.28) / farCount;
    const a = Math.PI / 2 + GATE_GAP_RAD * 0.5 + u * farArc;
    const r = 1.6 + rand() * 0.58;
    const p = ringPoint(a, r);

    const vIdx = pickNonRepeatingVariant(farVariants);
    const scaleMult = 0.82 + rand() * 0.42;
    addTree(vIdx, p.x, p.z, scaleMult, 4);
  }

  return records;
}

// ============================================================================
// GOLDEN SUNLIGHT SHAFTS FILTERING THROUGH THE AUTUMN FOREST
// ============================================================================

function createForestSunbeams(scene: Scene, rand: () => number): {
  mesh: InstancedMesh;
  material: MeshBasicMaterial;
  dispose(): void;
} {
  const beamCount = IS_MOBILE ? 14 : 22;
  const geo = new PlaneGeometry(3.2, 14.0);
  geo.translate(0, 6.5, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255, 214, 135, 0.0)");
    g.addColorStop(0.25, "rgba(255, 208, 122, 0.32)");
    g.addColorStop(0.7, "rgba(255, 188, 96, 0.16)");
    g.addColorStop(1, "rgba(255, 175, 80, 0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 256);

    // Soft horizontal edge fade
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
    color: new Color(0xffcf7a),
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
    const p = ringPoint(a, 1.06 + (i % 3) * 0.14);
    // Slanted along the daytime sun vector (0.45, 0.82, 0.35)
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

  // 1. Build shared PBR Bark & 5–7 Lobed Japanese Maple Foliage materials.
  const mapleLeafTex = drawMapleClusterTexture(1024);
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
      alphaTest: 0.28,
      transparent: false,
      roughness: 0.72,
      metalness: 0.0,
      emissive: new Color(0x241005),
      emissiveIntensity: 0.07,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 8 distinct Japanese Maple Archetype geometries + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Maple/Bodhi Tree onto the octagonal planter outside the gate.
  const wishTreeFoliageMat = own(mapleFoliageMat.clone());
  wishTreeFoliageMat.color.setHex(0xe34520);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the 4-layer Japanese Maple Autumn Forest across the 8 archetypes.
  const allRecords = buildFourLayerForestLayout(rand);
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
    // Tall foreground/midground archetypes cast soft canopy shadows onto the temple lawn!
    mesh.castShadow = !IS_MOBILE && (vIdx === 0 || vIdx === 1 || vIdx === 2);
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius += 4.0;
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
      const leafEmissive = 0.04 + 0.08 * daylight;
      mapleFoliageMat.emissiveIntensity = leafEmissive;
      wishTreeFoliageMat.emissiveIntensity = leafEmissive;

      // Sunbeams shine gently by day and fade out at night.
      const beamAlpha = Math.max(0, (daylight - 0.35) / 0.65) * 0.16;
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
