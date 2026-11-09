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
// BẢNG TÙY CHỈNH HÌNH ẢNH CÂY & MÀU LÁ (CHỈNH SỬA TRỰC TIẾP TẠI ĐÂY)
// ============================================================================
export const TREE_VISUAL_CONFIG = {
  /**
   * Hệ số độ rộng/dày của từng vòm tán lá:
   * - 1.08 = tán cây phồng dày, giao nhau tạo mái rừng liền mạch như ảnh mẫu Screenshot (158).
   */
  padSizeMultiplier: 1.08,

  /**
   * Hệ số kích thước từng chiếc lá phong bên trong texture (0.75..0.95):
   */
  leafDetailScale: 0.84,

  /**
   * Hệ số chiều cao tổng thể của các tầng cây (1.0 = chuẩn theo 5 lớp từ thấp lên cao).
   */
  treeHeightMultiplier: 1.0,

  /**
   * Màu lá của Cây Bồ Đề Ước Nguyện ngoài cổng tam quan (mã màu Hex).
   */
  wishTreeColor: 0xf2a829,

  /**
   * BẢNG MÀU LÁ MÙA THU TRONG RỪNG (Khớp theo tông màu ảnh mẫu Screenshot 158):
   * Đan xen Đỏ thẫm, Đỏ tươi, Cam cháy, Vàng nghệ, Vàng cam nhạt và Xanh rêu/xanh cốm.
   */
  foliagePalette: [
    0xd61f19, // 1. Đỏ phong tươi thẫm (Crimson Red)
    0xf25c19, // 2. Đỏ cam / Cam lửa (Flame Orange)
    0xf5b825, // 3. Vàng thu rực sáng (Golden Yellow)
    0xb81614, // 4. Đỏ rượu vang đậm (Deep Wine Red)
    0x63872b, // 5. Xanh rêu cổ thụ (Temple Moss Green)
    0xeb7a24, // 6. Vàng cam ấm (Warm Autumn Orange)
    0xd92b1c, // 7. Đỏ son (Scarlet Maple)
    0xf7ca38, // 8. Vàng nắng ấm (Sunlit Gold)
    0xc43c1e, // 9. Cam cháy đậm (Burnt Orange-Red)
    0x82a332, // 10. Xanh vàng nõn chuối dịu (Olive Chartreuse)
    0xe89628, // 11. Vàng hổ phách (Amber Gold)
    0x9e1c16, // 12. Đỏ nâu trầm (Russet Crimson)
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

function pickTreeFoliageColor(index: number, ringTier: number, out: Color): Color {
  const palette = TREE_VISUAL_CONFIG.foliagePalette;
  const step = (index * 5 + ringTier * 3) % palette.length;
  const baseHex = palette[step] ?? 0xd61f19;
  out.setHex(baseHex);

  // Like Screenshot (158), upper hillside background tiers (Tier 4 & Tier 5) blend into
  // warm sunlit peach-amber / golden-terracotta mist for deep 3D atmospheric perspective!
  if (ringTier === 4) {
    out.lerp(new Color(0xe08b56), 0.22);
  } else if (ringTier >= 5) {
    out.lerp(new Color(0xe69c68), 0.38);
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
        float boughSway = branchWeight * 0.016 * sin(uTime * 0.95 + treePhase + transformed.x * 0.4);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Stylized Foliage Shader matching Screenshot (158):
 * - Rich warm shadow at the bottom of each canopy lobe, glowing sunlit rim at the top.
 * - Preserves outward-domed normals on both sides of `DoubleSide` leaf cards.
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
        vCanopyGrad = clamp(heightNorm * 0.48 + sunSide * 0.52, 0.0, 1.0);
        vRimLight = pow(sunSide, 1.6) * heightNorm;

        float swayWeight = clamp((transformed.y - 1.2) * 0.18, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 0.95 + transformed.z * 0.9 + transformed.y * 0.55;
        float swayX = swayWeight * (0.022 * sin(uTime * 1.05 + treePhase + clusterPhase) + 0.009 * cos(uTime * 1.9 - clusterPhase));
        float swayZ = swayWeight * (0.018 * cos(uTime * 0.95 + treePhase * 1.2 + clusterPhase));
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
        // Rich stylized gradient: deep warm underside shadow -> saturated mid-crown -> glowing sunlit top
        vec3 lowerShade = diffuseColor.rgb * vec3(0.55, 0.46, 0.44);
        vec3 upperSun = mix(diffuseColor.rgb * 1.20, vec3(1.0, 0.88, 0.52), 0.24);
        diffuseColor.rgb = mix(lowerShade, upperSun, vCanopyGrad);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb * 0.98, 0.34) + vec3(1.0, 0.82, 0.46) * (vRimLight * 0.16);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// DENSE, FULL-BODIED 7-LOBED MAPLE CLUSTER TEXTURE (`1024x1024` — 52 OVERLAPPING LEAVES)
// ============================================================================

/**
 * Draws a dense, full-coverage 1024x1024 cluster of 52 overlapping 7-lobed Japanese Maple leaves.
 * The interior 80% is completely filled with layered leaves (zero transparent holes in the middle!),
 * while the outer rim has crisp, scalloped 7-lobed maple leaf tips.
 */
function drawCrispMapleSprigTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0x918273);
  const leafScale = TREE_VISUAL_CONFIG.leafDetailScale;

  /**
   * Draws one 7-lobed palmate Japanese Maple leaf with graceful pointed lobes,
   * deep palmate notches, and bright veins.
   */
  const drawDelicateMapleLeaf = (
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

    const lobeAngles = [-1.88, -1.26, -0.62, 0, 0.62, 1.26, 1.88] as const;
    const lobeLengths = [0.48, 0.78, 0.96, 1.12, 0.96, 0.78, 0.48] as const;
    const lobeWidths = [0.16, 0.21, 0.24, 0.26, 0.24, 0.21, 0.16] as const;

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

    const b0 = Math.round(212 * brightness);
    const b1 = Math.round(240 * brightness);
    const b2 = Math.min(255, Math.round(255 * brightness));

    const grad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.15, radius * 1.05);
    grad.addColorStop(0, `rgb(${b0}, ${b0 - 4}, ${b0 - 10})`);
    grad.addColorStop(0.65, `rgb(${b1}, ${b1 - 2}, ${b1 - 5})`);
    grad.addColorStop(1, `rgb(${b2}, ${b2}, ${b2})`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle tonal leaf contour so overlapping leaves read clearly
    ctx.lineWidth = Math.max(1.2, radius * 0.024);
    ctx.strokeStyle = `rgba(${Math.round(170 * brightness)}, ${Math.round(158 * brightness)}, ${Math.round(145 * brightness)}, 0.48)`;
    ctx.stroke();

    // Luminous palmate veins
    ctx.strokeStyle = "rgba(255, 255, 242, 0.54)";
    ctx.lineWidth = Math.max(1.0, radius * 0.02);
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

  // Pass 1: Solid inner base of 20 overlapping leaves so the core of the cluster has ZERO holes
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const d = Math.sqrt(i / 20) * 0.28 * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.5 + Math.sin(a) * d;
    const r = (0.17 + rand() * 0.03) * size;
    drawDelicateMapleLeaf(lx, ly, r, a + Math.PI * 0.5 + (rand() - 0.5) * 0.5, 0.84 + (i % 3) * 0.03);
  }

  // Pass 2: Mid-ring of 18 overlapping maple leaves fanning outward
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.18 + (rand() - 0.5) * 0.22;
    const d = (0.2 + rand() * 0.15) * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.5 + Math.sin(a) * d;
    const r = (0.165 + rand() * 0.03) * size;
    drawDelicateMapleLeaf(lx, ly, r, a + Math.PI * 0.5 + (rand() - 0.5) * 0.45, 0.92 + (i % 2) * 0.04);
  }

  // Pass 3: Sunlit top & outer rim fan of 14 crisp maple leaves
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.35 + (rand() - 0.5) * 0.2;
    const d = (0.08 + (i % 3) * 0.11 + rand() * 0.06) * size;
    const lx = size * 0.5 + Math.cos(a) * d;
    const ly = size * 0.5 + Math.sin(a) * d;
    const r = (0.16 + rand() * 0.028) * size;
    drawDelicateMapleLeaf(lx, ly, r, a + Math.PI * 0.5 + (rand() - 0.5) * 0.4, 0.98 + (i % 2) * 0.02);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// SMOOTH CATMULL-ROM TRUNKS & VOLUMETRIC PLUSH FOLIAGE DOMES
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
 * Builds a closed, organic 3D foliage cushion dome (fluted/lobed ellipsoid with radial UVs)
 * so the interior of each foliage pad is 100% solid and plush from every viewing angle (never paper-thin!).
 */
function buildPlushCanopyDome(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  seed: number,
): BufferGeometry {
  const g = new SphereGeometry(1, 10, 6);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const vCount = pos.count;
  const cols = new Float32Array(vCount * 3);

  const cBot = new Color(0xc7bfb2);
  const cTop = new Color(0xffffff);
  const cTmp = new Color();

  for (let i = 0; i < vCount; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Organic leaf-clump lobes so it reads as a cluster of foliage puffs, never a geometric sphere
    const angle = Math.atan2(z, x);
    const lobe =
      1.0 +
      0.14 * Math.sin(angle * 5 + seed) * Math.cos(y * 2.6 + seed * 0.7) +
      0.08 * Math.cos(angle * 3 - y * 3.4 + seed * 1.3);

    // Flatten the bottom slightly like a real tree canopy pad
    const yShaped = y < 0 ? y * 0.62 : y;

    const px = cx + x * rx * lobe;
    const py = cy + yShaped * ry * lobe;
    const pz = cz + z * rz * lobe;
    pos.setXYZ(i, px, py, pz);

    // Map UVs to the dense interior of the maple leaf texture (0.18..0.82) so the dome is 100% covered in leaves
    uv.setXY(i, 0.5 + x * 0.32, 0.5 + z * 0.32);

    const shadeT = Math.max(0, Math.min(1, (y + 0.8) / 1.8));
    cTmp.lerpColors(cBot, cTop, shadeT);
    cols[i * 3] = cTmp.r;
    cols[i * 3 + 1] = cTmp.g;
    cols[i * 3 + 2] = cTmp.b;
  }

  g.setAttribute("color", new Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Builds a curved 2x2 leaf-sprig shell placed around the plush dome to give crisp,
 * scalloped 7-lobe maple leaf edges along the silhouette.
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
      const ny = wy - padCenter.y + 0.45;
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
 * Builds a plush, volumetric 3D Canopy Lobe matching Screenshot (158):
 * - Solid organic 3D foliage cushion dome inside (`buildPlushCanopyDome`) so it is never sparse or see-through.
 * - Surrounded by shingled curved maple-sprig shells (`buildCurvedSprigShell`) for a leafy, ruffled outline.
 */
function buildSculptedFoliagePad(
  cx: number,
  cy: number,
  cz: number,
  rawWidth: number,
  droop: number,
  rimSprigs: number,
  rand: () => number,
): BufferGeometry {
  const width = rawWidth * TREE_VISUAL_CONFIG.padSizeMultiplier;
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const mdHex = 0xede8df;
  const brHex = 0xffffff;

  // 1. Solid 3D organic plush dome core (eliminates all sparse gaps!)
  parts.push(
    buildPlushCanopyDome(
      cx,
      cy,
      cz,
      width * 0.56,
      width * (0.36 + droop * 0.08),
      width * 0.56,
      rand() * 100,
    ),
  );

  // 2. Outer rim maple-leaf sprigs fanning around the plush dome for a natural leafy silhouette
  for (let i = 0; i < rimSprigs; i++) {
    const a = (i / rimSprigs) * Math.PI * 2 + (rand() - 0.5) * 0.24;
    const reach = width * (0.34 + (i % 2) * 0.08);
    const s = width * (0.68 + rand() * 0.12);
    const dy = (i % 2 === 0 ? -0.04 : 0.08) - droop * 0.1;
    const pitch = 0.42 + droop * 0.22 + (rand() - 0.5) * 0.12;

    parts.push(
      buildCurvedSprigShell(
        cx + Math.cos(a) * reach,
        cy + dy,
        cz + Math.sin(a) * reach,
        s,
        s * 0.92,
        0.18,
        a,
        pitch,
        (rand() - 0.5) * 0.15,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  // 3. Top crown leaf cap
  parts.push(
    buildCurvedSprigShell(
      cx,
      cy + width * 0.28,
      cz,
      width * 0.78,
      width * 0.78,
      0.18,
      rand() * Math.PI * 2,
      (rand() - 0.5) * 0.12,
      (rand() - 0.5) * 0.12,
      mdHex,
      brHex,
      center,
    ),
  );

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: sculpted foliage pad");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"   // 1. Đại thụ hậu cảnh & đỉnh đồi
  | "spreading" // 2. Cây phong tán xòe rộng
  | "rounded"   // 3. Cây phong tán vòm tròn đầy đặn
  | "weeping"   // 4. Cây phong dáng rủ
  | "curved"    // 5. Cây phong thân cong
  | "small";    // 6. Cây phong sát sân chùa

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
  // 1. Cổ thụ hậu cảnh (Base height 10.0m, full overlapping crown)
  {
    id: "ancient",
    baseHeight: 10.0,
    trunkBaseR: 0.32,
    trunkTopR: 0.11,
    barkColors: [0x3d2518, 0x593926],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 1.3, -0.05],
      [-0.1, 2.7, 0.06],
      [-0.03, 4.1, 0.02],
      [0.04, 5.4, -0.03],
    ],
    boughs: [
      { angle: 0.2, startY: 2.3, midR: 1.4, midY: 3.3, endR: 2.65, endY: 4.1, radius: 0.14, padWidth: 2.75, droop: 0.08 },
      { angle: 1.45, startY: 2.6, midR: 1.35, midY: 3.7, endR: 2.55, endY: 4.5, radius: 0.13, padWidth: 2.65, droop: 0.06 },
      { angle: 2.75, startY: 2.4, midR: 1.45, midY: 3.5, endR: 2.7, endY: 4.3, radius: 0.14, padWidth: 2.8, droop: 0.08 },
      { angle: 4.0, startY: 2.8, midR: 1.3, midY: 4.0, endR: 2.45, endY: 4.8, radius: 0.12, padWidth: 2.6, droop: 0.05 },
      { angle: 5.25, startY: 3.0, midR: 1.25, midY: 4.2, endR: 2.4, endY: 5.1, radius: 0.11, padWidth: 2.55, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 6.4, z: 0.0, width: 3.3, droop: 0.04 },
      { x: -1.35, y: 5.5, z: 0.95, width: 2.8, droop: 0.05 },
      { x: 1.35, y: 5.6, z: -0.95, width: 2.8, droop: 0.05 },
      { x: 0.0, y: 5.4, z: 1.45, width: 2.65, droop: 0.05 },
    ],
  },

  // 2. Cây phong tán xòe (Base height 8.0m)
  {
    id: "spreading",
    baseHeight: 8.0,
    trunkBaseR: 0.25,
    trunkTopR: 0.085,
    barkColors: [0x452a1c, 0x633e2b],
    trunkCurve: [
      [0, 0, 0],
      [-0.07, 1.0, 0.05],
      [0.1, 2.1, -0.05],
      [0.05, 3.2, -0.02],
      [-0.03, 4.2, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 1.9, midR: 1.3, midY: 2.5, endR: 2.45, endY: 3.1, radius: 0.11, padWidth: 2.45, droop: 0.06 },
      { angle: 1.65, startY: 2.15, midR: 1.25, midY: 2.85, endR: 2.35, endY: 3.5, radius: 0.1, padWidth: 2.35, droop: 0.06 },
      { angle: 3.15, startY: 2.0, midR: 1.35, midY: 2.65, endR: 2.5, endY: 3.2, radius: 0.11, padWidth: 2.5, droop: 0.06 },
      { angle: 4.7, startY: 2.35, midR: 1.2, midY: 3.1, endR: 2.25, endY: 3.7, radius: 0.095, padWidth: 2.3, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 4.9, z: 0.0, width: 2.85, droop: 0.04 },
      { x: -1.1, y: 4.15, z: -0.75, width: 2.4, droop: 0.05 },
      { x: 1.1, y: 4.25, z: 0.75, width: 2.4, droop: 0.05 },
    ],
  },

  // 3. Cây phong tán tròn (Base height 7.2m)
  {
    id: "rounded",
    baseHeight: 7.2,
    trunkBaseR: 0.22,
    trunkTopR: 0.075,
    barkColors: [0x402d20, 0x5c4230],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.9, 0.03],
      [-0.06, 1.9, -0.04],
      [0.02, 2.9, 0.02],
      [0.0, 3.8, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 1.8, midR: 1.1, midY: 2.4, endR: 1.95, endY: 3.0, radius: 0.095, padWidth: 2.25, droop: 0.08 },
      { angle: 1.95, startY: 2.0, midR: 1.05, midY: 2.7, endR: 1.9, endY: 3.3, radius: 0.09, padWidth: 2.2, droop: 0.08 },
      { angle: 3.5, startY: 1.9, midR: 1.15, midY: 2.5, endR: 2.0, endY: 3.1, radius: 0.095, padWidth: 2.3, droop: 0.08 },
      { angle: 5.05, startY: 2.15, midR: 1.0, midY: 2.85, endR: 1.85, endY: 3.5, radius: 0.085, padWidth: 2.15, droop: 0.07 },
    ],
    crownPads: [
      { x: 0.0, y: 4.5, z: 0.0, width: 2.65, droop: 0.05 },
      { x: -0.9, y: 3.85, z: 0.7, width: 2.25, droop: 0.06 },
      { x: 0.9, y: 3.95, z: -0.7, width: 2.25, droop: 0.06 },
    ],
  },

  // 4. Cây phong dáng rủ nhẹ (Base height 6.8m)
  {
    id: "weeping",
    baseHeight: 6.8,
    trunkBaseR: 0.21,
    trunkTopR: 0.07,
    barkColors: [0x452a1e, 0x5e3b2b],
    trunkCurve: [
      [0, 0, 0],
      [0.08, 0.95, -0.04],
      [0.15, 2.0, -0.08],
      [0.06, 3.0, -0.03],
      [-0.04, 3.8, 0.02],
    ],
    boughs: [
      { angle: 0.25, startY: 1.9, midR: 1.15, midY: 2.8, endR: 2.1, endY: 2.5, radius: 0.09, padWidth: 2.2, droop: 0.2 },
      { angle: 1.8, startY: 2.1, midR: 1.1, midY: 3.0, endR: 2.0, endY: 2.7, radius: 0.085, padWidth: 2.15, droop: 0.2 },
      { angle: 3.35, startY: 2.0, midR: 1.2, midY: 2.9, endR: 2.15, endY: 2.6, radius: 0.09, padWidth: 2.25, droop: 0.22 },
      { angle: 4.9, startY: 2.25, midR: 1.05, midY: 3.1, endR: 1.95, endY: 2.8, radius: 0.085, padWidth: 2.1, droop: 0.18 },
    ],
    crownPads: [
      { x: 0.0, y: 4.35, z: 0.0, width: 2.55, droop: 0.12 },
      { x: -0.9, y: 3.7, z: 0.6, width: 2.15, droop: 0.16 },
      { x: 0.9, y: 3.8, z: -0.6, width: 2.15, droop: 0.16 },
    ],
  },

  // 5. Cây phong thân cong nghệ thuật (Base height 6.2m)
  {
    id: "curved",
    baseHeight: 6.2,
    trunkBaseR: 0.2,
    trunkTopR: 0.065,
    barkColors: [0x473225, 0x634736],
    trunkCurve: [
      [0, 0, 0],
      [-0.18, 0.85, 0.1],
      [-0.25, 1.8, 0.14],
      [0.1, 2.7, -0.06],
      [0.18, 3.6, -0.1],
    ],
    boughs: [
      { angle: 0.5, startY: 1.7, midR: 1.05, midY: 2.2, endR: 1.85, endY: 2.65, radius: 0.085, padWidth: 2.05, droop: 0.08 },
      { angle: 2.4, startY: 2.05, midR: 1.0, midY: 2.65, endR: 1.8, endY: 3.1, radius: 0.08, padWidth: 2.0, droop: 0.06 },
      { angle: 4.3, startY: 2.35, midR: 1.05, midY: 2.95, endR: 1.85, endY: 3.4, radius: 0.075, padWidth: 2.0, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.15, y: 4.15, z: -0.08, width: 2.35, droop: 0.05 },
      { x: -0.75, y: 3.55, z: 0.5, width: 1.95, droop: 0.06 },
    ],
  },

  // 6. Cây phong nhỏ sát sân (Base height 5.2m)
  {
    id: "small",
    baseHeight: 5.2,
    trunkBaseR: 0.16,
    trunkTopR: 0.055,
    barkColors: [0x452e20, 0x61422e],
    trunkCurve: [
      [0, 0, 0],
      [0.05, 0.7, -0.03],
      [-0.05, 1.5, 0.03],
      [0.02, 2.3, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.25, midR: 0.8, midY: 1.7, endR: 1.4, endY: 2.15, radius: 0.065, padWidth: 1.8, droop: 0.06 },
      { angle: 2.4, startY: 1.45, midR: 0.75, midY: 1.9, endR: 1.35, endY: 2.35, radius: 0.06, padWidth: 1.75, droop: 0.06 },
      { angle: 4.5, startY: 1.6, midR: 0.78, midY: 2.05, endR: 1.35, endY: 2.45, radius: 0.06, padWidth: 1.75, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.0, y: 3.0, z: 0.0, width: 2.05, droop: 0.04 },
      { x: -0.55, y: 2.65, z: 0.4, width: 1.7, droop: 0.05 },
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
    buildSmoothBranchTube(trunkPts, spec.trunkBaseR, spec.trunkTopR, 8, 7, spec.barkColors[0], spec.barkColors[1], true),
  );

  // 2. Smooth Catmull-Rom primary boughs & secondary forks + plush overlapping foliage domes
  for (const b of spec.boughs) {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.5, b.startY, sa * spec.trunkTopR * 0.5);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildSmoothBranchTube([p0, p1, p2], b.radius, b.radius * 0.3, 5, 5, spec.barkColors[0], spec.barkColors[1]),
    );

    // Plush foliage dome at the bough tip
    leafParts.push(
      buildSculptedFoliagePad(p2.x, p2.y + 0.08, p2.z, b.padWidth, b.droop, 4, rand),
    );

    // Secondary fork for rich multi-tiered crown volume
    const fAngle = b.angle + (rand() > 0.5 ? 0.56 : -0.56);
    const fReach = b.endR * 0.82;
    const fEndY = b.endY + 0.32 - b.droop * 0.2;
    const fp2 = new Vector3(Math.cos(fAngle) * fReach, fEndY, Math.sin(fAngle) * fReach);

    barkParts.push(
      buildSmoothBranchTube([p1, fp2], b.radius * 0.55, b.radius * 0.22, 4, 4, spec.barkColors[0], spec.barkColors[1]),
    );

    leafParts.push(
      buildSculptedFoliagePad(fp2.x, fp2.y + 0.06, fp2.z, b.padWidth * 0.86, b.droop, 3, rand),
    );
  }

  // 3. Upper crown domes overlapping the side boughs so the tree top is full and rounded
  for (const cp of spec.crownPads) {
    leafParts.push(buildSculptedFoliagePad(cp.x, cp.y, cp.z, cp.width, cp.droop, 4, rand));
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
  barkParts.push(buildSmoothBranchTube(trunkPts, 0.34, 0.11, 8, 7, 0x3d2518, 0x593926, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.55, 3.85 + (i % 2) * 0.18, sa * 2.55);
    barkParts.push(buildSmoothBranchTube([p0, p1, p2], 0.13, 0.04, 5, 5, 0x452a1c, 0x633e2b));

    leafParts.push(
      buildSculptedFoliagePad(p1.x, p1.y + 0.55, p1.z, 2.0, 0.05, 4, rand),
      buildSculptedFoliagePad(p2.x, p2.y + 0.35, p2.z, 2.15, 0.06, 4, rand),
    );
  }

  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.2;
    const cy = c === 0 ? 6.05 : 5.15;
    leafParts.push(buildSculptedFoliagePad(Math.cos(a) * rad, cy, Math.sin(a) * rad, 2.35, 0.04, 4, rand));
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
// 5-LAYER HILLSIDE AMPHITHEATER FOREST LAYOUT (MATCHING SCREENSHOT 158)
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
  /** Vertical hillside elevation (metres) so back tiers rise up to the top of the screen like Screenshot 158! */
  readonly baseY: number;
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
  readonly variants: readonly number[];
}

/**
 * 5-Layer Hillside Amphitheater Forest matching `Screenshot (158).jpg`:
 * - Tier 1 (Courtyard Edge): 42 trees (5.4m – 7.4m tall, y=0) — crisp trunks & overlapping autumn crowns.
 * - Tier 2 (Low Midground): 46 trees (8.2m – 10.8m tall, y=0) — staggered directly behind Tier 1.
 * - Tier 3 (High Midground): 50 trees (11.5m – 15.0m tall, y=+0.8m) — rising clearly above Tier 2.
 * - Tier 4 (Hillside Background): 54 trees (15.5m – 20.5m tall, y=+2.4m) — rising high behind the pavilion & Hall.
 * - Tier 5 (Mountain Crest Backdrop): 58 trees (21.0m – 27.5m tall, y=+4.8m) — warm sunlit mountain-slope canopy filling the upper sky!
 */
const STEPPED_RINGS: readonly SteppedRingConfig[] = [
  {
    tier: 5,
    count: IS_MOBILE ? 46 : 58,
    ring: [1.42, 1.62],
    heightRange: [21.0, 27.5],
    spreadRange: [1.18, 1.35],
    baseY: 4.8,
    phaseOffset: 0.5,
    gateGapFactor: 0.35,
    variants: [0, 1, 2],
  },
  {
    tier: 4,
    count: IS_MOBILE ? 44 : 54,
    ring: [1.28, 1.42],
    heightRange: [15.5, 20.5],
    spreadRange: [1.14, 1.28],
    baseY: 2.4,
    phaseOffset: 0.0,
    gateGapFactor: 0.52,
    variants: [0, 1, 2, 3],
  },
  {
    tier: 3,
    count: IS_MOBILE ? 40 : 50,
    ring: [1.16, 1.27],
    heightRange: [11.5, 15.0],
    spreadRange: [1.08, 1.22],
    baseY: 0.8,
    phaseOffset: 0.5,
    gateGapFactor: 0.72,
    variants: [1, 2, 3, 4],
  },
  {
    tier: 2,
    count: IS_MOBILE ? 38 : 46,
    ring: [1.07, 1.15],
    heightRange: [8.2, 10.8],
    spreadRange: [1.04, 1.18],
    baseY: 0.0,
    phaseOffset: 0.25,
    gateGapFactor: 0.88,
    variants: [1, 2, 3, 4],
  },
  {
    tier: 1,
    count: IS_MOBILE ? 34 : 42,
    ring: [0.99, 1.06],
    heightRange: [5.4, 7.4],
    spreadRange: [1.02, 1.14],
    baseY: 0.0,
    phaseOffset: 0.75,
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
// DIAGONAL GOLDEN SUNLIGHT SHAFTS ("GOD RAYS" FROM SCREENSHOT 158)
// ============================================================================

function createForestSunbeams(scene: Scene, rand: () => number): {
  mesh: InstancedMesh;
  material: MeshBasicMaterial;
  dispose(): void;
} {
  const beamCount = IS_MOBILE ? 18 : 28;
  const geo = new PlaneGeometry(4.2, 22.0);
  geo.translate(0, 9.5, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255, 228, 155, 0.0)");
    g.addColorStop(0.22, "rgba(255, 212, 128, 0.34)");
    g.addColorStop(0.65, "rgba(255, 188, 95, 0.18)");
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
    opacity: 0.22,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geo, material, beamCount);
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let i = 0; i < beamCount; i++) {
    const u = (i + 0.5) / beamCount;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;
    const p = ringPoint(a, 0.96 + (i % 3) * 0.12);
    // Slanted diagonal sunbeams matching Screenshot (158)
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

  // 1. Build shared PBR Bark & Dense 52-Leaf Maple Cluster Foliage materials.
  const mapleLeafTex = drawCrispMapleSprigTexture(1024);
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
      alphaTest: 0.28,
      transparent: false,
      roughness: 0.72,
      metalness: 0.0,
      emissive: new Color(0x1f1006),
      emissiveIntensity: 0.06,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 6 Plush Volumetric Tree Archetypes + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Bodhi/Maple Tree outside the gate.
  const wishTreeFoliageMat = own(mapleFoliageMat.clone());
  wishTreeFoliageMat.color.setHex(TREE_VISUAL_CONFIG.wishTreeColor);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the 5-Tier Hillside Amphitheater Forest matching Screenshot (158).
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

  // 4. Diagonal golden sunbeams streaming across the trees and pavilion like Screenshot (158).
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

      const beamAlpha = Math.max(0, (daylight - 0.3) / 0.7) * 0.2;
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
