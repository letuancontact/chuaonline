import {
  Box3,
  BoxGeometry,
  BufferAttribute,
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
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Scene,
  type Texture,
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

/** Normalised base height (metres) for `cothu.glb`, `cothu1.glb`, and the procedural Maple trees. */
const ANCIENT_BASE_HEIGHT = 7.6;
const MAPLE_BASE_HEIGHT = 7.8;

/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.25;

/**
 * Number of evenly spaced angular slots around the courtyard perimeter.
 * Every ring uses this exact angular grid with locked phase offsets (0.0 -> 0.5 -> 0.25 -> 0.75)
 * so front tree trunks and canopies interlock and hide the bases of the back layers.
 */
const PERIMETER_SLOTS = IS_MOBILE ? 20 : 24;

interface MapleRingSpec {
  readonly slots: number;
  readonly ring: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly phaseOffset: number;
  /** When true, only odd slots (`k % 2 === 1`) are placed because even slots hold `cothu.glb`. */
  readonly oddSlotsOnly?: boolean;
}

/**
 * High-LOD staggered rings:
 * - Ring 1 (phase 0.00, odd slots): interleaved 1-to-1 between the `cothu.glb` trees on the front line.
 * - Ring 2 (phase 0.50, all slots): placed at the exact midpoint between every pair of Ring 1 trunks.
 * - Ring 3 (phase 0.25, all slots): placed at the exact quarter-step gap between Ring 1 and Ring 2.
 */
const MAPLE_HIGH_RINGS: readonly MapleRingSpec[] = [
  {
    slots: PERIMETER_SLOTS,
    ring: [1.03, 1.08],
    scale: [1.08, 1.28],
    phaseOffset: 0.0,
    oddSlotsOnly: true,
  },
  {
    slots: PERIMETER_SLOTS,
    ring: [1.13, 1.21],
    scale: [1.16, 1.38],
    phaseOffset: 0.5,
  },
  {
    slots: PERIMETER_SLOTS,
    ring: [1.25, 1.35],
    scale: [1.26, 1.52],
    phaseOffset: 0.25,
  },
];

/**
 * Far-LOD staggered rings:
 * - Ring 4 (phase 0.75): fills the remaining three-quarter-step gap behind Ring 2 & Ring 3.
 * - Ring 5 (double density): seals the deep woodland horizon.
 */
const MAPLE_FAR_RINGS: readonly MapleRingSpec[] = [
  {
    slots: PERIMETER_SLOTS,
    ring: [1.39, 1.54],
    scale: [1.38, 1.68],
    phaseOffset: 0.75,
  },
  {
    slots: PERIMETER_SLOTS * 2,
    ring: [1.58, 1.95],
    scale: [1.52, 1.95],
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
 * 6. Xanh cốm non (Soft Spring Olive-Chartreuse)
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

interface PreparedAncientTree {
  geometry: BufferGeometry;
  materials: MeshStandardMaterial[];
  materialOrArray: Material | Material[];
  textures: Texture[];
}

type Object3DLike = {
  updateMatrixWorld(force?: boolean): void;
  traverse(cb: (node: unknown) => void): void;
};

/**
 * Extracts a normalized BufferGeometry slice for a sub-mesh or geometry material group.
 * Preserves 100% of original triangles, `position`, `normal`, `uv`, and vertex `color` (`COLOR_0`),
 * while compacting only the vertices referenced by `indexStart..indexCount`.
 */
function extractSingleGroupGeometry(
  src: BufferGeometry,
  worldMatrix: Matrix4,
  indexStart?: number,
  indexCount?: number,
): BufferGeometry | null {
  const posAttr = src.getAttribute("position");
  if (!posAttr || posAttr.count === 0) return null;

  const srcIndex = src.index;
  const totalIndices = srcIndex ? srcIndex.count : posAttr.count;
  const start = indexStart ?? 0;
  const count =
    indexCount !== undefined ? Math.min(indexCount, totalIndices - start) : totalIndices - start;
  if (count <= 0) return null;

  const vCount = posAttr.count;
  const isFullMesh = start === 0 && count === totalIndices;

  if (isFullMesh) {
    const g = new BufferGeometry();
    const posArr = new Float32Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      posArr[i * 3] = posAttr.getX(i);
      posArr[i * 3 + 1] = posAttr.getY(i);
      posArr[i * 3 + 2] = posAttr.getZ(i);
    }
    g.setAttribute("position", new Float32BufferAttribute(posArr, 3));

    const uvAttr = src.getAttribute("uv");
    const uvArr = new Float32Array(vCount * 2);
    if (uvAttr) {
      for (let i = 0; i < vCount; i++) {
        uvArr[i * 2] = uvAttr.getX(i);
        uvArr[i * 2 + 1] = uvAttr.getY(i);
      }
    }
    g.setAttribute("uv", new Float32BufferAttribute(uvArr, 2));

    const colAttr = src.getAttribute("color");
    const colArr = new Float32Array(vCount * 3);
    if (colAttr) {
      const tmpCol = new Color();
      for (let i = 0; i < vCount; i++) {
        tmpCol.fromBufferAttribute(colAttr, i);
        colArr[i * 3] = tmpCol.r;
        colArr[i * 3 + 1] = tmpCol.g;
        colArr[i * 3 + 2] = tmpCol.b;
      }
    } else {
      colArr.fill(1);
    }
    g.setAttribute("color", new Float32BufferAttribute(colArr, 3));

    const idxArr = new Uint32Array(count);
    if (srcIndex) {
      for (let i = 0; i < count; i++) idxArr[i] = srcIndex.getX(i);
    } else {
      for (let i = 0; i < count; i++) idxArr[i] = i;
    }
    g.setIndex(new BufferAttribute(idxArr, 1));

    const normAttr = src.getAttribute("normal");
    if (normAttr) {
      const normArr = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount; i++) {
        normArr[i * 3] = normAttr.getX(i);
        normArr[i * 3 + 1] = normAttr.getY(i);
        normArr[i * 3 + 2] = normAttr.getZ(i);
      }
      g.setAttribute("normal", new Float32BufferAttribute(normArr, 3));
    } else {
      g.computeVertexNormals();
    }

    g.applyMatrix4(worldMatrix);
    return g;
  }

  const remap = new Int32Array(vCount).fill(-1);
  const usedVertices: number[] = [];
  const idxArr = new Uint32Array(count);

  for (let i = 0; i < count; i++) {
    const origIdx = srcIndex ? srcIndex.getX(start + i) : start + i;
    let mapped = remap[origIdx] ?? -1;
    if (mapped === -1) {
      mapped = usedVertices.length;
      remap[origIdx] = mapped;
      usedVertices.push(origIdx);
    }
    idxArr[i] = mapped;
  }

  const outVCount = usedVertices.length;
  if (outVCount === 0) return null;

  const g = new BufferGeometry();
  const posArr = new Float32Array(outVCount * 3);
  for (let i = 0; i < outVCount; i++) {
    const srcIdx = usedVertices[i]!;
    posArr[i * 3] = posAttr.getX(srcIdx);
    posArr[i * 3 + 1] = posAttr.getY(srcIdx);
    posArr[i * 3 + 2] = posAttr.getZ(srcIdx);
  }
  g.setAttribute("position", new Float32BufferAttribute(posArr, 3));

  const uvAttr = src.getAttribute("uv");
  const uvArr = new Float32Array(outVCount * 2);
  if (uvAttr) {
    for (let i = 0; i < outVCount; i++) {
      const srcIdx = usedVertices[i]!;
      uvArr[i * 2] = uvAttr.getX(srcIdx);
      uvArr[i * 2 + 1] = uvAttr.getY(srcIdx);
    }
  }
  g.setAttribute("uv", new Float32BufferAttribute(uvArr, 2));

  const colAttr = src.getAttribute("color");
  const colArr = new Float32Array(outVCount * 3);
  if (colAttr) {
    const tmpCol = new Color();
    for (let i = 0; i < outVCount; i++) {
      const srcIdx = usedVertices[i]!;
      tmpCol.fromBufferAttribute(colAttr, srcIdx);
      colArr[i * 3] = tmpCol.r;
      colArr[i * 3 + 1] = tmpCol.g;
      colArr[i * 3 + 2] = tmpCol.b;
    }
  } else {
    colArr.fill(1);
  }
  g.setAttribute("color", new Float32BufferAttribute(colArr, 3));

  g.setIndex(new BufferAttribute(idxArr, 1));

  const normAttr = src.getAttribute("normal");
  if (normAttr) {
    const normArr = new Float32Array(outVCount * 3);
    for (let i = 0; i < outVCount; i++) {
      const srcIdx = usedVertices[i]!;
      normArr[i * 3] = normAttr.getX(srcIdx);
      normArr[i * 3 + 1] = normAttr.getY(srcIdx);
      normArr[i * 3 + 2] = normAttr.getZ(srcIdx);
    }
    g.setAttribute("normal", new Float32BufferAttribute(normArr, 3));
  } else {
    g.computeVertexNormals();
  }

  g.applyMatrix4(worldMatrix);
  return g;
}

function attachWindSwayShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float swayWeight = clamp((transformed.y - 2.2) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.042 * sin(uTime * 1.55 + leafPhase) + 0.018 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
  };
}

/**
 * Dedicated shader for the multi-colored Maple foliage (`DoubleSide` alpha-cutout leaf sprays):
 * 1. Applies gentle wind sway in the vertex shader.
 * 2. Keeps outward-domed canopy normals on both sides of `DoubleSide` leaf cards so backfaces never turn black.
 * 3. Adds warm sunlight translucency in the upper canopy so chartreuse, golden-orange, and crimson leaves glow softly.
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
        vCanopyLift = clamp((transformed.y - 2.4) / 5.2, 0.0, 1.0);
        float swayWeight = clamp((transformed.y - 2.2) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.042 * sin(uTime * 1.55 + leafPhase) + 0.018 * cos(uTime * 2.7 - leafPhase * 1.2));
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

/**
 * Extracts all sub-meshes and multi-material primitive groups from `cothu.glb` / `cothu1.glb`
 * with 100% original geometry, textures, and vertex colors intact.
 */
function prepareAncientTreeModel(
  root: Object3DLike,
  uTime: { value: number },
  targetHeight = ANCIENT_BASE_HEIGHT,
): PreparedAncientTree {
  const parts: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  const textures: Texture[] = [];
  const sourceGeoms = new Set<BufferGeometry>();
  const sourceMats = new Set<Material>();
  const aniso = maxAnisotropy();

  const trackTex = (tex: Texture | null | undefined, isColorMap = false): Texture | null => {
    if (!tex) return null;
    if (isColorMap) {
      tex.colorSpace = SRGBColorSpace;
    }
    tex.anisotropy = aniso;
    if (!textures.includes(tex)) textures.push(tex);
    return tex;
  };

  const buildPartMaterial = (
    rawMat: MeshStandardMaterial | undefined,
    hasVertexColors: boolean,
  ): MeshStandardMaterial => {
    const map = trackTex(rawMat?.map ?? rawMat?.emissiveMap, true);
    const normalMap = trackTex(rawMat?.normalMap, false);
    const roughnessMap = trackTex(rawMat?.roughnessMap, false);
    const alphaMap = trackTex(rawMat?.alphaMap, false);
    trackTex(rawMat?.metalnessMap, false);

    const color = rawMat?.color ? rawMat.color.clone() : new Color(0xffffff);
    if (color.r + color.g + color.b < 0.02) {
      if (rawMat?.emissive && rawMat.emissive.r + rawMat.emissive.g + rawMat.emissive.b > 0.02) {
        color.copy(rawMat.emissive);
      } else if (map) {
        color.setHex(0xffffff);
      }
    }

    const partMat = new MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap,
      alphaMap,
      color,
      vertexColors: hasVertexColors,
      transparent: Boolean(rawMat?.transparent && (!rawMat.alphaTest || rawMat.alphaTest === 0)),
      opacity: rawMat?.opacity ?? 1,
      alphaTest: rawMat && rawMat.alphaTest > 0 ? rawMat.alphaTest : 0,
      roughness: rawMat?.roughness !== undefined ? Math.max(0.55, rawMat.roughness) : 0.84,
      metalness: 0.0,
      emissive: new Color(0x09170b),
      emissiveIntensity: 0.05,
      side: DoubleSide,
    });
    attachWindSwayShader(partMat, uTime);
    return partMat;
  };

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const srcGeom = node.geometry as BufferGeometry;
    sourceGeoms.add(srcGeom);
    const hasVertexColors = Boolean(srcGeom.getAttribute("color"));

    if (Array.isArray(node.material) && srcGeom.groups.length > 0) {
      for (const grp of srcGeom.groups) {
        const rawMat = (node.material[grp.materialIndex] ?? node.material[0]) as
          | MeshStandardMaterial
          | undefined;
        if (rawMat) sourceMats.add(rawMat);
        const cleanGeom = extractSingleGroupGeometry(srcGeom, node.matrixWorld, grp.start, grp.count);
        if (cleanGeom) {
          parts.push(cleanGeom);
          materials.push(buildPartMaterial(rawMat, hasVertexColors));
        }
      }
    } else {
      const rawMat = (Array.isArray(node.material) ? node.material[0] : node.material) as
        | MeshStandardMaterial
        | undefined;
      if (Array.isArray(node.material)) {
        for (const m of node.material) if (m) sourceMats.add(m as Material);
      } else if (rawMat) {
        sourceMats.add(rawMat);
      }
      const cleanGeom = extractSingleGroupGeometry(srcGeom, node.matrixWorld);
      if (cleanGeom) {
        parts.push(cleanGeom);
        materials.push(buildPartMaterial(rawMat, hasVertexColors));
      }
    }
  });

  for (const m of sourceMats) m.dispose();
  for (const g of sourceGeoms) g.dispose();

  if (parts.length === 0) {
    throw new Error("GLB tree: no mesh geometry found");
  }

  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, true);
  if (parts.length > 1) {
    for (const p of parts) p.dispose();
  }
  if (!merged) throw new Error("GLB tree: failed to merge mesh geometries");

  merged.computeBoundingBox();
  const bbox = merged.boundingBox ?? new Box3();
  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;
  const rawHeight = Math.max(0.01, bbox.max.y - bbox.min.y);
  const normalizeScale = targetHeight / rawHeight;

  merged.translate(-cx, -bbox.min.y, -cz);
  merged.scale(normalizeScale, normalizeScale, normalizeScale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const materialOrArray: Material | Material[] =
    materials.length === 1 ? materials[0]! : materials;

  return { geometry: merged, materials, materialOrArray, textures };
}

// ============================================================================
// SLENDER MULTI-TONE TEMPLE MAPLE TREE (CHARTREUSE / CRIMSON / GOLDEN-ORANGE)
// ============================================================================

/**
 * Draws a high-resolution 512x512 botanical texture of a 7-lobed serrated Maple branchlet
 * in a clean, high-luminance neutral-warm value range.
 * Because the texture carries pure botanical shading & veins (without baking a dark red tint),
 * `instanceColor` can tint any tree into luminous Chartreuse (`vàng nõn chuối`),
 * Golden-Orange (`vàng cam`), or Temple Crimson (`đỏ phong`) without muddying the colors!
 */
function drawMapleClusterTexture(size = 512): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0xca71ad0);

  // Delicate dark-wood twig stems radiating from the lower-centre petiole attachment.
  ctx.strokeStyle = "#4a2c18";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.009;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.88);
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

  /** Draws one 7-lobe serrated palmately-lobed maple leaf at (cx, cy). */
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
    const lobeLengths = [0.45, 0.75, 0.94, 1.05, 0.94, 0.75, 0.45] as const;
    const lobeWidths = [0.15, 0.21, 0.24, 0.26, 0.24, 0.21, 0.15] as const;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.15);

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
        const notchR = radius * 0.27;
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
    ctx.strokeStyle = "rgba(64, 42, 24, 0.65)";
    ctx.stroke();

    // Palmate primary veins.
    ctx.strokeStyle = "rgba(255, 252, 235, 0.52)";
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

  // Layer 1: Shaded background leaves in the spray.
  const backShades: readonly [string, string, string][] = [
    ["#b8ae9e", "#d4cbb8", "#aba08e"],
    ["#c2b8a7", "#ded5c3", "#b5aa98"],
  ];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + (rand() - 0.5) * 0.26;
    const dist = (0.12 + rand() * 0.2) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.49 + Math.sin(angle) * dist;
    const r = (0.11 + rand() * 0.04) * size;
    const pal = backShades[i % backShades.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.65, pal[0], pal[1], pal[2]);
  }

  // Layer 2: Sunlit foreground leaves in the spray.
  const frontShades: readonly [string, string, string][] = [
    ["#ded6c6", "#f5efe2", "#ffffff"],
    ["#d6cebe", "#ede6d8", "#faf6ed"],
    ["#e6dfd1", "#faf5ea", "#ffffff"],
  ];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + 0.17 + (rand() - 0.5) * 0.24;
    const dist = (0.05 + rand() * 0.19) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.48 + Math.sin(angle) * dist;
    const r = (0.115 + rand() * 0.044) * size;
    const pal = frontShades[i % frontShades.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.55, pal[0], pal[1], pal[2]);
  }

  drawPalmateMapleLeaf(size * 0.48, size * 0.46, size * 0.135, -0.32, "#e3dcd0", "#f7f2e6", "#ffffff");
  drawPalmateMapleLeaf(size * 0.53, size * 0.51, size * 0.128, 0.38, "#dbd3c5", "#f2ece0", "#fcfaf5");

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
 * Builds one curved, umbrella-arched maple leaf spray card ("nhánh lá nhỏ uốn vòm").
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
    -0.5, -0.04, -0.5,
    0.5, -0.04, -0.5,
    0.5, -0.04, 0.5,
    -0.5, -0.04, 0.5,
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
 * Builds a multi-layered Maple Foliage Cloud Pad ("chòm tán lá đa tầng").
 * Uses neutral-warm vertex shading (`shadowHex -> midHex -> brightHex`) so `instanceColor`
 * tints each tree cleanly into Chartreuse, Golden-Orange, or Crimson while keeping rich internal depth.
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

  // 1. Lower/inner shaded layer for canopy depth.
  const innerCount = highDetail ? 2 : 1;
  for (let i = 0; i < innerCount; i++) {
    const a = (i / innerCount) * Math.PI * 2 + rand() * 0.8;
    const d = radius * (0.16 + rand() * 0.14);
    const sx = radius * (0.96 + rand() * 0.22);
    const sz = radius * (0.94 + rand() * 0.22);
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy - 0.1 + (rand() - 0.5) * 0.06,
        cz + Math.sin(a) * d,
        sx,
        sz,
        0.16,
        a + rand() * 0.5,
        0.35 + (rand() - 0.5) * 0.22,
        (rand() - 0.5) * 0.3,
        shadowHex,
        midHex,
        center,
      ),
    );
  }

  // 2. Mid-ring shingled leaf sprays fanning outward.
  const midCount = highDetail ? 4 : 2;
  for (let i = 0; i < midCount; i++) {
    const a = (i / midCount) * Math.PI * 2 + 0.35 + (rand() - 0.5) * 0.28;
    const d = radius * (0.34 + rand() * 0.24);
    const sx = radius * (0.85 + rand() * 0.24);
    const sz = radius * (0.85 + rand() * 0.24);
    const pitch = 0.26 + rand() * 0.22;
    const roll = (rand() - 0.5) * 0.28;
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy + 0.04 + (rand() - 0.5) * 0.08,
        cz + Math.sin(a) * d,
        sx,
        sz,
        0.18,
        a,
        pitch,
        roll,
        midHex,
        brightHex,
        center,
      ),
    );
  }

  // 3. Upper sunlit crown spray.
  if (highDetail) {
    const a = rand() * Math.PI * 2;
    const sx = radius * (0.82 + rand() * 0.2);
    const sz = radius * (0.82 + rand() * 0.2);
    parts.push(
      buildArchedLeafSpray(
        cx,
        cy + 0.22,
        cz,
        sx,
        sz,
        0.2,
        a,
        (rand() - 0.5) * 0.25,
        (rand() - 0.5) * 0.25,
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
  /** High-LOD merged 2-group geometry (group 0 = slender bark trunk/branches, group 1 = foliage clouds). */
  highGeo: BufferGeometry;
  /** Far-LOD merged 2-group geometry for distant forest rings. */
  farGeo: BufferGeometry;
}

/**
 * Generates the slender, lightweight Temple Maple Tree in High-LOD (~820 tris) and Far-LOD (~240 tris),
 * grounded at `(0, 0, 0)` with Y-up and normalized to `MAPLE_BASE_HEIGHT` (7.8 m).
 */
function createAncientRedMapleGeometries(): MapleTreeGeometries {
  const rand = seeded(0x7e4a91e);

  const buildLOD = (highDetail: boolean): BufferGeometry => {
    const barkParts: BufferGeometry[] = [];
    const leafParts: BufferGeometry[] = [];
    const radialSegs = highDetail ? 5 : 4;
    const subSegs = highDetail ? 4 : 3;

    // 1. Slender, graceful S-curved main trunk (radius 0.22 m at base tapering to 0.085 m).
    const trunkPts = [
      new Vector3(0.0, 0.0, 0.0),
      new Vector3(0.05, 0.85, -0.04),
      new Vector3(-0.06, 1.75, 0.04),
      new Vector3(-0.02, 2.55, 0.02),
      new Vector3(0.02, 3.35, -0.02),
    ];
    const trunkRadii = [0.22, 0.17, 0.14, 0.11, 0.085];
    barkParts.push(buildCurvedBranchSegment(trunkPts, trunkRadii, radialSegs, 0x3b281b, 0x5c402c));

    // 2. Five graceful spreading boughs + secondary forks + wide layered foliage clouds.
    const boughSpecs = [
      { angle: 0.15, startY: 2.4, reach: 2.85, topY: 4.5, r0: 0.095, sway: 0.22 },
      { angle: 1.4, startY: 2.6, reach: 2.7, topY: 4.8, r0: 0.09, sway: -0.2 },
      { angle: 2.66, startY: 2.5, reach: 2.9, topY: 4.6, r0: 0.095, sway: 0.2 },
      { angle: 3.92, startY: 2.75, reach: 2.65, topY: 5.05, r0: 0.085, sway: -0.22 },
      { angle: 5.18, startY: 2.95, reach: 2.5, topY: 5.4, r0: 0.08, sway: 0.18 },
    ] as const;

    // Neutral-warm vertex shading levels so `instanceColor` controls the hue (Chartreuse / Orange-Gold / Red) cleanly.
    const shHex = 0x6e6256;
    const mdHex = 0xcfc6b8;
    const brHex = 0xfffdf5;
    const warmAccentHex = 0xffe8b8;

    for (let b = 0; b < boughSpecs.length; b++) {
      const spec = boughSpecs[b]!;
      const ca = Math.cos(spec.angle);
      const sa = Math.sin(spec.angle);
      const pa = spec.angle + Math.PI * 0.5;
      const cpa = Math.cos(pa);
      const spa = Math.sin(pa);

      const p0 = new Vector3(ca * 0.06, spec.startY, sa * 0.06);
      const p1 = new Vector3(
        ca * (spec.reach * 0.48) + cpa * spec.sway,
        spec.startY + (spec.topY - spec.startY) * 0.54,
        sa * (spec.reach * 0.48) + spa * spec.sway,
      );
      const p2 = new Vector3(ca * spec.reach, spec.topY, sa * spec.reach);

      barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [spec.r0, spec.r0 * 0.65, spec.r0 * 0.34], subSegs, 0x543a28, 0x694934));

      const forkSides = [-0.46, 0.46] as const;
      for (let f = 0; f < forkSides.length; f++) {
        const side = forkSides[f]!;
        const fAngle = spec.angle + side;
        const fca = Math.cos(fAngle);
        const fsa = Math.sin(fAngle);
        const fReach = spec.reach * (0.98 + (f % 2) * 0.2);
        const fTopY = spec.topY + 0.45 + f * 0.26;

        const fp0 = p1.clone();
        const fp1 = new Vector3(
          (fp0.x + fca * fReach) * 0.52,
          (fp0.y + fTopY) * 0.54,
          (fp0.z + fsa * fReach) * 0.52,
        );
        const fp2 = new Vector3(fca * fReach, fTopY, fsa * fReach);

        if (highDetail) {
          barkParts.push(buildCurvedBranchSegment([fp0, fp1, fp2], [spec.r0 * 0.5, spec.r0 * 0.28, 0.025], 3, 0x5c402c, 0x473020));
        }

        leafParts.push(
          buildMapleCloudPad(
            fp2.x,
            fp2.y + 0.14,
            fp2.z,
            1.28 + rand() * 0.24,
            shHex,
            mdHex,
            (b + f) % 2 === 0 ? brHex : warmAccentHex,
            rand,
            highDetail,
          ),
        );
      }

      // Interior cloud pad nestled along the primary bough.
      leafParts.push(
        buildMapleCloudPad(
          p2.x * 0.8,
          p2.y + 0.2,
          p2.z * 0.8,
          1.18,
          0x594e43,
          0xb8afa2,
          mdHex,
          rand,
          false,
        ),
      );
    }

    // 3. Slender upper crown apex branch & top canopy clouds (y = 5.4 m .. 7.6 m).
    const crownPts = [
      new Vector3(0.02, 3.25, -0.02),
      new Vector3(-0.08, 4.65, 0.05),
      new Vector3(0.0, 6.55, 0.0),
    ];
    barkParts.push(buildCurvedBranchSegment(crownPts, [0.085, 0.055, 0.025], subSegs, 0x543a28, 0x452e1e));

    const crownPads = highDetail ? 5 : 3;
    for (let c = 0; c < crownPads; c++) {
      const ca = (c / crownPads) * Math.PI * 2 + 0.4;
      const rad = c === 0 ? 0.1 : 0.95 + (c % 2) * 0.52;
      const cy = 5.8 + (1 - rad / 2.2) * 1.1 + (rand() - 0.5) * 0.18;
      leafParts.push(
        buildMapleCloudPad(
          Math.cos(ca) * rad,
          cy,
          Math.sin(ca) * rad,
          1.25 + rand() * 0.2,
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

  return {
    highGeo: buildLOD(true),
    farGeo: buildLOD(false),
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
      if (spec.oddSlotsOnly && k % 2 === 0) continue;

      // Tight angular jitter (±0.035 of a slot) keeps the quincunx interlocking alignment exact.
      const slotPos = k + 0.5 + spec.phaseOffset + (rand() - 0.5) * 0.07;
      const u = (((slotPos % spec.slots) + spec.slots) % spec.slots) / spec.slots;
      const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;

      const r = spec.ring[0] + (0.25 + 0.5 * rand()) * (spec.ring[1] - spec.ring[0]);
      const p = ringPoint(a, r);

      const sc = spec.scale[0] + rand() * (spec.scale[1] - spec.scale[0]);
      // Keep horizontal scale close to `sc` so the tree trunk stays slender and never bloats.
      const sx = sc * (0.98 + rand() * 0.08);
      const sz = sc * (0.98 + rand() * 0.08);
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

export async function createGarden(scene: Scene, assets: Assets, materials: Materials, regions: Regions): Promise<Garden> {
  const [cothuGltf, wishTreeGltf] = await Promise.all([
    assets.model("models/cothu.glb"),
    assets.model("models/cothu1.glb").catch((err: unknown) => {
      console.warn("[garden] Fallback to models/cothu.glb for Wishing Tree:", err);
      return null;
    }),
  ]);
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

  // 1. Prepare `models/cothu.glb` with 100% original geometry, textures, and materials intact.
  const preparedTree = prepareAncientTreeModel(cothuGltf.scene, uTreeTime);
  for (const mat of preparedTree.materials) own(mat);

  // 2. Prepare `models/cothu1.glb` with 100% original geometry for the Wishing Tree outside the gate.
  let preparedWishTree: PreparedAncientTree | null = null;
  if (wishTreeGltf) {
    try {
      preparedWishTree = prepareAncientTreeModel(wishTreeGltf.scene, uTreeTime);
      for (const mat of preparedWishTree.materials) own(mat);
    } catch (err) {
      console.warn("[garden] Fallback to models/cothu.glb for Wishing Tree:", err);
      preparedWishTree = null;
    }
  }
  const activeWishTree = preparedWishTree ?? preparedTree;
  attachAncientTreeToWishingTree(
    activeWishTree.geometry,
    activeWishTree.materialOrArray,
  );

  // Place `cothu.glb` on the EVEN slots (`k % 2 === 0`) of Ring 1 so they alternate 1-to-1 with the Maple trees.
  const ancientTreeMeshes: Mesh[] = [];
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let k = 0; k < PERIMETER_SLOTS; k += 2) {
    const slotPos = k + 0.5 + (rand() - 0.5) * 0.06;
    const u = (((slotPos % PERIMETER_SLOTS) + PERIMETER_SLOTS) % PERIMETER_SLOTS) / PERIMETER_SLOTS;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;
    const r = 1.03 + rand() * 0.05;
    const p = ringPoint(a, r);
    const sc = 1.12 + rand() * 0.25;
    const sx = sc * (1.06 + rand() * 0.12);
    const sz = sc * (1.06 + rand() * 0.12);
    const yaw = (k * 1.6180339 + rand() * 0.35) * Math.PI * 2;

    const treeMesh = new Mesh(preparedTree.geometry, preparedTree.materialOrArray);
    treeMesh.position.set(p.x, 0, p.z);
    treeMesh.rotation.y = yaw;
    treeMesh.scale.set(sx, sc, sz);
    treeMesh.castShadow = false;
    treeMesh.receiveShadow = true;
    treeMesh.frustumCulled = true;
    treeMesh.matrixAutoUpdate = false;
    treeMesh.updateMatrix();
    treeMesh.updateMatrixWorld(true);
    treeMesh.name = `ancient-tree:${k}`;
    scene.add(treeMesh);
    ancientTreeMeshes.push(treeMesh);
  }

  // 3. Build the slender, multi-tone Temple Maple trees (Chartreuse / Maple Red / Golden-Orange).
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
        float swayWeight = clamp((transformed.y - 2.2) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.042 * sin(uTime * 1.55 + leafPhase) + 0.018 * cos(uTime * 2.7 - leafPhase * 1.2));
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
      alphaTest: 0.32,
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
      const treeEmissive = 0.04 + 0.05 * daylight;
      for (const mat of preparedTree.materials) {
        mat.emissiveIntensity = treeEmissive;
      }
      if (preparedWishTree) {
        for (const mat of preparedWishTree.materials) {
          mat.emissiveIntensity = treeEmissive;
        }
      }
      mapleFoliageMat.emissiveIntensity = 0.04 + 0.06 * daylight;
    },
    dispose() {
      for (const g of built) {
        g.removeFromParent();
        disposeGroupGeometry(g);
      }
      for (const m of ancientTreeMeshes) {
        scene.remove(m);
      }
      for (const o of forest) {
        scene.remove(o);
        o.dispose();
      }
      preparedTree.geometry.dispose();
      for (const tex of preparedTree.textures) tex.dispose();
      if (preparedWishTree) {
        preparedWishTree.geometry.dispose();
        for (const tex of preparedWishTree.textures) tex.dispose();
      }
      generatedMaple.highGeo.dispose();
      generatedMaple.farGeo.dispose();
      mapleLeafTex.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
