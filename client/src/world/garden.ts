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

/** Normalised base height (metres) for `cothu.glb`, `cothu1.glb`, and the procedural Ancient Red Maple. */
const ANCIENT_BASE_HEIGHT = 7.6;
const MAPLE_BASE_HEIGHT = 7.8;

interface TierPlacementConfig {
  readonly count: number;
  readonly ring: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly spread: readonly [number, number];
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
}

/**
 * Tier 1A: Inner courtyard ring of 100% full-detail `models/cothu.glb` ancient trees,
 * individually frustum-culled so only the 2–3 trees in front of the camera are drawn.
 */
const ANCIENT_TIERS: readonly TierPlacementConfig[] = [
  {
    count: IS_MOBILE ? 10 : 12,
    ring: [1.03, 1.12],
    scale: [1.15, 1.42],
    spread: [1.15, 1.32],
    phaseOffset: 0.0,
    gateGapFactor: 1.0,
  },
];

/**
 * Tiers 1B, 2 & 3: High-detail Ancient Red Maple (`Cây Lá Đỏ Cổ Thụ` High-LOD) rings.
 * Tier 1B (`phaseOffset: 0.5`) slots directly between the Tier 1A `cothu.glb` trees so the courtyard
 * perimeter is lush and continuous, backed by Tiers 2 and 3.
 */
const RED_MAPLE_HIGH_TIERS: readonly TierPlacementConfig[] = [
  {
    count: IS_MOBILE ? 16 : 18,
    ring: [1.04, 1.16],
    scale: [1.08, 1.38],
    spread: [1.14, 1.32],
    phaseOffset: 0.5,
    gateGapFactor: 0.95,
  },
  {
    count: IS_MOBILE ? 20 : 24,
    ring: [1.16, 1.36],
    scale: [1.22, 1.56],
    spread: [1.18, 1.38],
    phaseOffset: 0.25,
    gateGapFactor: 0.82,
  },
  {
    count: IS_MOBILE ? 22 : 28,
    ring: [1.36, 1.66],
    scale: [1.38, 1.82],
    spread: [1.22, 1.44],
    phaseOffset: 0.75,
    gateGapFactor: 0.64,
  },
];

/**
 * Tiers 4 & 5: Distant multi-layered Red Maple woodland canopy rings (`Far-LOD`)
 * eliminating horizon gaps with natural branching silhouettes and layered leaf clouds.
 */
const RED_MAPLE_FAR_TIERS: readonly TierPlacementConfig[] = [
  {
    count: IS_MOBILE ? 36 : 48,
    ring: [1.62, 2.08],
    scale: [1.55, 2.08],
    spread: [1.25, 1.48],
    phaseOffset: 0.15,
    gateGapFactor: 0.46,
  },
  {
    count: IS_MOBILE ? 48 : 64,
    ring: [2.02, 2.68],
    scale: [1.75, 2.42],
    spread: [1.28, 1.54],
    phaseOffset: 0.65,
    gateGapFactor: 0.32,
  },
];

/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.26;

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
        float leafSway = swayWeight * (0.045 * sin(uTime * 1.55 + leafPhase) + 0.02 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
  };
}

/**
 * Dedicated shader for the Ancient Red Maple foliage (`DoubleSide` alpha-cutout leaf sprays):
 * 1. Applies gentle wind sway in the vertex shader.
 * 2. Prevents Three.js's default `DoubleSide` backface normal flip from turning the back side of angled
 *    leaf cards black, keeping hemisphere lighting smooth and adding warm sunlight translucency.
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
        float leafSway = swayWeight * (0.045 * sin(uTime * 1.55 + leafPhase) + 0.02 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCanopyLift;")
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        // Preserve the outward-domed canopy normal on both sides of DoubleSide leaf cards
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `// Warm autumn sunlight translucency through upper-canopy maple leaves
        outgoingLight += diffuseColor.rgb * (0.08 + 0.14 * vCanopyLift);
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
// ANCIENT RED MAPLE TREE ("CÂY LÁ ĐỎ CỔ THỤ" — PROCEDURAL 3D BOTANICAL MODEL)
// ============================================================================

/**
 * Draws a high-resolution 512x512 botanical texture of a Japanese/East-Asian Red Maple
 * branchlet (`Acer palmatum`) with 5-lobed and 7-lobed serrated leaves, fine palmate veins,
 * woody twig stems, and a clean transparent border so card edges never clip.
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
  ctx.strokeStyle = "#3b2012";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.01;
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

  /** Draws one 7-lobe serrated palmately-lobed maple leaf at (cx, cy), kept safely inside the canvas bounds. */
  const drawPalmateMapleLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    innerHex: string,
    outerHex: string,
    tipHex: string,
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
    grad.addColorStop(0, innerHex);
    grad.addColorStop(0.66, outerHex);
    grad.addColorStop(1, tipHex);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.4, radius * 0.032);
    ctx.strokeStyle = "rgba(52, 10, 6, 0.76)";
    ctx.stroke();

    // Palmate primary veins.
    ctx.strokeStyle = "rgba(255, 208, 150, 0.44)";
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

  // Layer 1: Deeper shadow crimson & burgundy maple leaves in the background of the spray.
  const backPalette: readonly [string, string, string][] = [
    ["#851a12", "#ab2518", "#6e120c"],
    ["#941f15", "#ba2c1b", "#7a160f"],
    ["#781510", "#9e2116", "#610f0a"],
  ];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2 + (rand() - 0.5) * 0.26;
    const dist = (0.12 + rand() * 0.2) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.49 + Math.sin(angle) * dist;
    const r = (0.11 + rand() * 0.042) * size;
    const pal = backPalette[i % backPalette.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.65, pal[0], pal[1], pal[2]);
  }

  // Layer 2: Foreground bright scarlet, vermilion, red-orange & subtle amber-gold maple leaves.
  const frontPalette: readonly [string, string, string][] = [
    ["#bf281a", "#e03f20", "#f27228"],
    ["#b32117", "#d4341d", "#e85b22"],
    ["#cc311c", "#eb5023", "#f7922b"],
    ["#a31d14", "#c72a1a", "#de4920"],
  ];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + 0.17 + (rand() - 0.5) * 0.24;
    const dist = (0.05 + rand() * 0.19) * size;
    const lx = size * 0.5 + Math.cos(angle) * dist;
    const ly = size * 0.48 + Math.sin(angle) * dist;
    const r = (0.115 + rand() * 0.045) * size;
    const pal = frontPalette[i % frontPalette.length]!;
    drawPalmateMapleLeaf(lx, ly, r, angle + Math.PI * 0.5 + (rand() - 0.5) * 0.55, pal[0], pal[1], pal[2]);
  }

  // Central crown leaves so the spray centre is dense and lush.
  drawPalmateMapleLeaf(size * 0.48, size * 0.46, size * 0.135, -0.32, "#c92c1b", "#e84922", "#f5842a");
  drawPalmateMapleLeaf(size * 0.53, size * 0.51, size * 0.128, 0.38, "#b52317", "#db391e", "#ed6724");

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/**
 * Builds a curved, multi-segment tubular branch or trunk spline with longitudinal bark flutes
 * and natural vertex color shading (mossy dark base → aged temple bark).
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

    const rBase = radii[i]!;
    const tFrac = i / Math.max(1, rings - 1);
    cTmp.lerpColors(c0, c1, tFrac);

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

      // Bark flutes/crevices on the trunk and main boughs.
      const flute = 1 + 0.085 * (1 - tFrac * 0.6) * Math.sin(theta * 5 + tFrac * 3.4);
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

      uv[idx * 2] = uFrac * 2.5;
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
 * Multiple small/medium sprays are layered together by `buildMapleCloudPad` to form organic foliage clouds.
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

  // 5-vertex arched dome quad lying mostly horizontal/tilted like real Japanese maple leaf layers.
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

  // Smooth hemisphere normals radiating from `cloudCenter` so the entire foliage pad shades as a cohesive botanical volume.
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
 * Builds a multi-layered East-Asian Maple Foliage Cloud Pad ("chòm tán lá đỏ đa tầng"):
 * - Shaded inner/lower leaf sprays (`shadowHex`) for canopy depth.
 * - Dense mid-layer sprays (`midHex`) fanned out organically.
 * - Sunlit upper & outward-reaching sprays (`brightHex`) with varied angles and sizes.
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

  // 1. Lower/inner shadow layer (gives deep crimson/burgundy interior depth).
  const innerCount = highDetail ? 3 : 2;
  for (let i = 0; i < innerCount; i++) {
    const a = (i / innerCount) * Math.PI * 2 + rand() * 0.8;
    const d = radius * (0.18 + rand() * 0.16);
    const sx = radius * (0.95 + rand() * 0.25);
    const sz = radius * (0.92 + rand() * 0.25);
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy - 0.12 + (rand() - 0.5) * 0.08,
        cz + Math.sin(a) * d,
        sx,
        sz,
        0.16,
        a + rand() * 0.5,
        0.38 + (rand() - 0.5) * 0.25,
        (rand() - 0.5) * 0.35,
        shadowHex,
        midHex,
        center,
      ),
    );
  }

  // 2. Mid-ring shingled leaf sprays fanning outward like real maple branchlets.
  const midCount = highDetail ? 5 : 2;
  for (let i = 0; i < midCount; i++) {
    const a = (i / midCount) * Math.PI * 2 + 0.35 + (rand() - 0.5) * 0.3;
    const d = radius * (0.35 + rand() * 0.28);
    const sx = radius * (0.82 + rand() * 0.28);
    const sz = radius * (0.82 + rand() * 0.28);
    // Pitch outward along `a` so sprays cascade naturally like umbrella shingles.
    const pitch = 0.28 + rand() * 0.24;
    const roll = (rand() - 0.5) * 0.32;
    parts.push(
      buildArchedLeafSpray(
        cx + Math.cos(a) * d,
        cy + 0.04 + (rand() - 0.5) * 0.1,
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

  // 3. Upper sunlit crown & outward-reaching accent sprays (highDetail).
  if (highDetail) {
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + rand() * 1.1;
      const d = radius * (0.12 + rand() * 0.22);
      const sx = radius * (0.78 + rand() * 0.22);
      const sz = radius * (0.78 + rand() * 0.22);
      parts.push(
        buildArchedLeafSpray(
          cx + Math.cos(a) * d,
          cy + 0.22 + i * 0.08,
          cz + Math.sin(a) * d,
          sx,
          sz,
          0.2,
          a + 0.7,
          (rand() - 0.5) * 0.3,
          (rand() - 0.5) * 0.3,
          midHex,
          brightHex,
          center,
        ),
      );
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: maple cloud pad");
  return merged;
}

interface MapleTreeGeometries {
  /** High-LOD merged 2-group geometry (group 0 = bark trunk/branches, group 1 = maple leaf clusters). */
  highGeo: BufferGeometry;
  /** Far-LOD merged 2-group geometry for distant forest rings. */
  farGeo: BufferGeometry;
}

/**
 * Generates the complete Ancient Red Maple Tree (`Cây Lá Đỏ Cổ Thụ`) in High-LOD and Far-LOD,
 * grounded at `(0, 0, 0)` with Y-up and normalized to `MAPLE_BASE_HEIGHT` (7.8 m).
 */
function createAncientRedMapleGeometries(): MapleTreeGeometries {
  const rand = seeded(0x7e4a91e);

  const buildLOD = (highDetail: boolean): BufferGeometry => {
    const barkParts: BufferGeometry[] = [];
    const leafParts: BufferGeometry[] = [];
    const radialSegs = highDetail ? 7 : 4;
    const subSegs = highDetail ? 5 : 3;

    // 1. Gnarled S-curved main trunk from y = 0.0 m to y = 3.25 m.
    const trunkPts = [
      new Vector3(0.0, 0.0, 0.0),
      new Vector3(0.07, 0.78, -0.05),
      new Vector3(-0.09, 1.58, 0.06),
      new Vector3(-0.04, 2.38, 0.02),
      new Vector3(0.04, 3.22, -0.03),
    ];
    const trunkRadii = [0.58, 0.44, 0.36, 0.3, 0.22];
    barkParts.push(buildCurvedBranchSegment(trunkPts, trunkRadii, radialSegs, 0x382518, 0x5c402c));

    // 2. Flared buttress roots ("rễ bạnh cổ thụ") anchoring the base into the temple soil.
    const rootCount = highDetail ? 6 : 3;
    for (let r = 0; r < rootCount; r++) {
      const a = (r / rootCount) * Math.PI * 2 + 0.32;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rPts = [
        new Vector3(ca * 0.24, 0.82, sa * 0.24),
        new Vector3(ca * 0.58, 0.34, sa * 0.58),
        new Vector3(ca * 0.96, 0.0, sa * 0.96),
      ];
      barkParts.push(buildCurvedBranchSegment(rPts, [0.19, 0.14, 0.065], subSegs, 0x453020, 0x2b1c12));
    }

    // 3. Six primary spreading boughs + secondary & tertiary forks + layered foliage clouds.
    const boughSpecs = [
      { angle: 0.12, startY: 2.3, reach: 3.05, topY: 4.45, r0: 0.21, sway: 0.3 },
      { angle: 1.18, startY: 2.5, reach: 2.85, topY: 4.75, r0: 0.19, sway: -0.25 },
      { angle: 2.24, startY: 2.4, reach: 3.1, topY: 4.55, r0: 0.21, sway: 0.24 },
      { angle: 3.32, startY: 2.65, reach: 2.75, topY: 4.95, r0: 0.19, sway: -0.28 },
      { angle: 4.38, startY: 2.5, reach: 2.95, topY: 4.7, r0: 0.2, sway: 0.22 },
      { angle: 5.42, startY: 2.85, reach: 2.55, topY: 5.35, r0: 0.18, sway: -0.2 },
    ] as const;

    const shadowColors = [0x4d100c, 0x5c130e, 0x691610, 0x54120d] as const;
    const midColors = [0xa82116, 0xb82619, 0xc42d1c, 0x9e1e14] as const;
    const brightColors = [0xd9381e, 0xe64d22, 0xf06826, 0xde4120, 0xe37b26] as const;

    for (let b = 0; b < boughSpecs.length; b++) {
      const spec = boughSpecs[b]!;
      const ca = Math.cos(spec.angle);
      const sa = Math.sin(spec.angle);
      const pa = spec.angle + Math.PI * 0.5;
      const cpa = Math.cos(pa);
      const spa = Math.sin(pa);

      const p0 = new Vector3(ca * 0.12, spec.startY, sa * 0.12);
      const p1 = new Vector3(
        ca * (spec.reach * 0.48) + cpa * spec.sway,
        spec.startY + (spec.topY - spec.startY) * 0.54,
        sa * (spec.reach * 0.48) + spa * spec.sway,
      );
      const p2 = new Vector3(ca * spec.reach, spec.topY, sa * spec.reach);

      barkParts.push(buildCurvedBranchSegment([p0, p1, p2], [spec.r0, spec.r0 * 0.68, spec.r0 * 0.36], subSegs, 0x543a28, 0x694934));

      // Secondary branch forks off each main bough.
      const forkSides = highDetail ? ([-0.52, 0.52, 0.08] as const) : ([-0.48, 0.48] as const);
      for (let f = 0; f < forkSides.length; f++) {
        const side = forkSides[f]!;
        const fAngle = spec.angle + side;
        const fca = Math.cos(fAngle);
        const fsa = Math.sin(fAngle);
        const fReach = spec.reach * (0.96 + (f % 2) * 0.24);
        const fTopY = spec.topY + 0.48 + f * 0.28;

        const fp0 = f === 2 ? p2.clone() : p1.clone();
        const fp1 = new Vector3(
          (fp0.x + fca * fReach) * 0.52,
          (fp0.y + fTopY) * 0.54,
          (fp0.z + fsa * fReach) * 0.52,
        );
        const fp2 = new Vector3(fca * fReach, fTopY, fsa * fReach);

        if (highDetail || f < 2) {
          barkParts.push(buildCurvedBranchSegment([fp0, fp1, fp2], [spec.r0 * 0.52, spec.r0 * 0.3, 0.045], Math.max(3, subSegs - 1), 0x5c402c, 0x473020));
        }

        const shCol = shadowColors[(b + f) % shadowColors.length]!;
        const mdCol = midColors[(b + f) % midColors.length]!;
        const brCol = brightColors[(b * 2 + f) % brightColors.length]!;

        // Main cloud pad at the secondary branch tip.
        leafParts.push(
          buildMapleCloudPad(
            fp2.x,
            fp2.y + 0.14,
            fp2.z,
            1.15 + rand() * 0.25,
            shCol,
            mdCol,
            brCol,
            rand,
            highDetail,
          ),
        );

        // Outward-reaching lateral spray pad ("nhánh lá vươn ra ngoài tạo độ rộng cho tán").
        if (highDetail && f < 2) {
          const extReach = fReach + 0.78 + rand() * 0.32;
          const extAngle = fAngle + (f === 0 ? -0.18 : 0.18);
          leafParts.push(
            buildMapleCloudPad(
              Math.cos(extAngle) * extReach,
              fTopY - 0.18 + (rand() - 0.5) * 0.22,
              Math.sin(extAngle) * extReach,
              0.92 + rand() * 0.2,
              shCol,
              mdCol,
              brightColors[(b + f + 2) % brightColors.length]!,
              rand,
              false,
            ),
          );
        }
      }

      // Interior shaded cloud pad nestled along the primary bough (creates depth while leaving gaps to see branches).
      leafParts.push(
        buildMapleCloudPad(
          p2.x * 0.78,
          p2.y + 0.22,
          p2.z * 0.78,
          1.08,
          0x420c09,
          0x991d14,
          0xc92e1c,
          rand,
           false,
        ),
      );
    }

    // 4. Upper crown apex branch & multi-layered top canopy clouds (y = 5.5 m .. 7.6 m).
    const crownPts = [
      new Vector3(0.04, 3.1, -0.03),
      new Vector3(-0.14, 4.5, 0.09),
      new Vector3(0.09, 5.85, -0.06),
      new Vector3(0.0, 6.8, 0.0),
    ];
    barkParts.push(buildCurvedBranchSegment(crownPts, [0.21, 0.15, 0.1, 0.045], subSegs, 0x543a28, 0x452e1e));

    const crownPads = highDetail ? 7 : 4;
    for (let c = 0; c < crownPads; c++) {
      const ca = (c / crownPads) * Math.PI * 2 + 0.38;
      const rad = c === 0 ? 0.12 : 0.92 + (c % 2) * 0.62;
      const cy = 5.85 + (1 - rad / 2.2) * 1.15 + (rand() - 0.5) * 0.2;
      leafParts.push(
        buildMapleCloudPad(
          Math.cos(ca) * rad,
          cy,
          Math.sin(ca) * rad,
          1.18 + rand() * 0.22,
          shadowColors[c % shadowColors.length]!,
          midColors[c % midColors.length]!,
          brightColors[c % brightColors.length]!,
          rand,
          highDetail,
        ),
      );
    }

    const mergedBark = mergeGeometries(barkParts, false);
    const mergedLeaves = mergeGeometries(leafParts, false);
    for (const g of barkParts) g.dispose();
    for (const g of leafParts) g.dispose();
    if (!mergedBark || !mergedLeaves) throw new Error("merge: ancient red maple");

    // Combine into a single 2-group BufferGeometry: group 0 = Bark, group 1 = Maple Foliage.
    const combined = mergeGeometries([mergedBark, mergedLeaves], true);
    mergedBark.dispose();
    mergedLeaves.dispose();
    if (!combined) throw new Error("merge: ancient red maple combined");

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

/**
 * Splits a ring of tree instances into North (z <= BOUNDARY.z) and South (z > BOUNDARY.z) halves
 * so frustum culling skips the half behind the camera while keeping draw calls minimal.
 */
function buildHemisphereInstancedMeshes(
  namePrefix: string,
  geometry: BufferGeometry,
  material: Material | Material[],
  items: readonly { x: number; z: number; matrix: Matrix4 }[],
  receiveShadow: boolean,
): InstancedMesh[] {
  const north: Matrix4[] = [];
  const south: Matrix4[] = [];
  for (const item of items) {
    if (item.z <= BOUNDARY.z) north.push(item.matrix);
    else south.push(item.matrix);
  }

  const meshes: InstancedMesh[] = [];
  const pairs: readonly [string, Matrix4[]][] = [
    ["north", north],
    ["south", south],
  ];
  for (const [label, list] of pairs) {
    if (list.length === 0) continue;
    const mesh = new InstancedMesh(geometry, material, list.length);
    list.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
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

function generateTierItems(
  tiers: readonly TierPlacementConfig[],
  rand: () => number,
): { x: number; z: number; matrix: Matrix4 }[] {
  const items: { x: number; z: number; matrix: Matrix4 }[] = [];
  for (const tier of tiers) {
    const gap = GATE_GAP_RAD * tier.gateGapFactor;
    const tierArc = Math.PI * 2 - 2 * gap;
    for (let k = 0; k < tier.count; k++) {
      const slot = k + 0.5 + tier.phaseOffset + (rand() - 0.5) * 0.22;
      const wrappedSlot = ((slot % tier.count) + tier.count) % tier.count;
      const a = Math.PI / 2 + gap + (wrappedSlot / tier.count) * tierArc;

      const radialT = (k % 2) * 0.45 + rand() * 0.55;
      const r = tier.ring[0] + radialT * (tier.ring[1] - tier.ring[0]);
      const p = ringPoint(a, r);

      const sc = tier.scale[0] + rand() * (tier.scale[1] - tier.scale[0]);
      const spreadFactor = tier.spread[0] + rand() * (tier.spread[1] - tier.spread[0]);
      const sx = sc * spreadFactor;
      const sz = sc * (spreadFactor * (0.94 + rand() * 0.12));
      const yaw = (k * 1.6180339 + rand() * 0.65) * Math.PI * 2;

      items.push({ x: p.x, z: p.z, matrix: place(p.x, 0, p.z, yaw, sx, sc, sz).clone() });
    }
  }
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

  // Place each Tier 1A `cothu.glb` ancient tree as an individually frustum-culled Mesh.
  const ancientTreeMeshes: Mesh[] = [];
  const tier1Items = generateTierItems(ANCIENT_TIERS, rand);
  for (let i = 0; i < tier1Items.length; i++) {
    const item = tier1Items[i]!;
    const treeMesh = new Mesh(preparedTree.geometry, preparedTree.materialOrArray);
    treeMesh.matrix.copy(item.matrix);
    treeMesh.matrix.decompose(treeMesh.position, treeMesh.quaternion, treeMesh.scale);
    treeMesh.castShadow = false;
    treeMesh.receiveShadow = true;
    treeMesh.frustumCulled = true;
    treeMesh.matrixAutoUpdate = false;
    treeMesh.updateMatrix();
    treeMesh.updateMatrixWorld(true);
    treeMesh.name = `ancient-tree:${i}`;
    scene.add(treeMesh);
    ancientTreeMeshes.push(treeMesh);
  }

  // 3. Build the procedural 3D Ancient Red Maple Tree (`Cây Lá Đỏ Cổ Thụ`) in High-LOD and Far-LOD.
  const mapleLeafTex = drawMapleClusterTexture(512);
  const mapleBarkMat = own(
    new MeshStandardMaterial({
      map: materials.wood.map,
      normalMap: materials.wood.normalMap,
      roughnessMap: materials.wood.roughnessMap,
      normalScale: new Vector2(1.4, 1.4),
      vertexColors: true,
      color: new Color(0x9e7c62),
      roughness: 0.88,
      metalness: 0.0,
    }),
  );
  attachWindSwayShader(mapleBarkMat, uTreeTime);

  const mapleFoliageMat = own(
    new MeshStandardMaterial({
      map: mapleLeafTex,
      vertexColors: true,
      color: new Color(0xffffff),
      alphaTest: 0.32,
      transparent: false,
      roughness: 0.74,
      metalness: 0.0,
      emissive: new Color(0x290704),
      emissiveIntensity: 0.08,
      side: DoubleSide,
    }),
  );
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const generatedMaple = createAncientRedMapleGeometries();
  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  const highMapleItems = generateTierItems(RED_MAPLE_HIGH_TIERS, rand);
  const farMapleItems = generateTierItems(RED_MAPLE_FAR_TIERS, rand);

  const forest: InstancedMesh[] = [
    ...buildHemisphereInstancedMeshes("red-maple-high", generatedMaple.highGeo, mapleMats, highMapleItems, true),
    ...buildHemisphereInstancedMeshes("red-maple-far", generatedMaple.farGeo, mapleMats, farMapleItems, false),
  ];

  // Subtle per-tree autumn tint variation across the forest.
  const tintPalette = [0xffffff, 0xffded6, 0xffe8d1, 0xf7cfc6, 0xffd6cc] as const;
  const tintCol = new Color();
  for (const mesh of forest) {
    for (let i = 0; i < mesh.count; i++) {
      const hex = tintPalette[i % tintPalette.length] ?? 0xffffff;
      mesh.setColorAt(i, tintCol.setHex(hex));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      mapleFoliageMat.emissiveIntensity = 0.05 + 0.07 * daylight;
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
