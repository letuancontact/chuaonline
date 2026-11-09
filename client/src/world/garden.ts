import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
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
  type Group,
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

/** Normalised base height (metres) for `cothu.glb` and `cothu1.glb` before per-instance scale variation. */
const ANCIENT_BASE_HEIGHT = 7.6;

/**
 * Clean, distortion-free triangle budgets per tree (tuned for mobile phones & integrated GPUs):
 * - Perimeter forest trees (64 instances at 48–98 m distance): 1,600 tris on Mobile, 2,400 on PC.
 * - Wishing Bodhi Tree (1 hero landmark outside the gate): 7,500 tris on Mobile, 12,000 on PC.
 */
const FOREST_TREE_TARGET_TRIS = IS_MOBILE ? 1600 : 2400;
const HERO_TREE_TARGET_TRIS = IS_MOBILE ? 7500 : 12000;

/**
 * 4-tier brick-staggered configuration for ancient trees (`models/cothu.glb`).
 * Each outer tier uses a locked phase offset (0.0 -> 0.5 -> 0.25 -> 0.75) with tight angular jitter
 * so all 4 tiers interlock without gaps while maintaining 60 FPS performance.
 */
interface AncientTierConfig {
  readonly count: number;
  readonly ring: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly spread: readonly [number, number];
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
}

const ANCIENT_TIERS: readonly AncientTierConfig[] = [
  // Tier 1: Courtyard perimeter ring framing the temple grounds
  {
    count: 14,
    ring: [1.03, 1.12],
    scale: [1.05, 1.35],
    spread: [1.1, 1.25],
    phaseOffset: 0.0,
    gateGapFactor: 1.0,
  },
  // Tier 2: Half-step staggered ring directly filling spaces between Tier 1 trees
  {
    count: 16,
    ring: [1.15, 1.34],
    scale: [1.2, 1.55],
    spread: [1.15, 1.32],
    phaseOffset: 0.5,
    gateGapFactor: 0.82,
  },
  // Tier 3: Quarter-step staggered mid-woodland canopy layer
  {
    count: 16,
    ring: [1.36, 1.66],
    scale: [1.38, 1.78],
    spread: [1.2, 1.38],
    phaseOffset: 0.25,
    gateGapFactor: 0.62,
  },
  // Tier 4: Three-quarter staggered deep ancient forest wall eliminating horizon gaps
  {
    count: 18,
    ring: [1.68, 2.1],
    scale: [1.55, 2.05],
    spread: [1.24, 1.44],
    phaseOffset: 0.75,
    gateGapFactor: 0.42,
  },
];

/** Deep-toned broad-canopy trees beyond Tier 4: overlaps radially at 2.02 so no seam appears. */
const FAR_TREE_COUNT = IS_MOBILE ? 140 : 180;
const FAR_RING = [2.02, 2.95] as const;
const FAR_HEIGHT = [12, 22] as const;
/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.26;

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_PILLAR_X = 3.4;
const GATE_WALL_X = 18;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const UP = new Vector3(0, 1, 0);

function box(batch: GeometryBatch<Key>, key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1, castShadow = true): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile, castShadow });
  g.dispose();
}

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromAxisAngle(UP, yaw), s3.set(sx, sy, sz));
}

/** Paint a solid vertex color onto a geometry. */
function colorGeo(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(arr, 3));
  return g;
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
 * Extracts ONLY the referenced vertices for a sub-mesh or geometry material group (`indexStart..indexCount`).
 * Prevents vertex buffer duplication when a multi-material GLB mesh has multiple primitive groups.
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

/**
 * Distortion-free triangle reducer for `cothu.glb` / `cothu1.glb`:
 * NEVER welds or mutates vertex positions/UVs/normals (preventing any purple spikes or stretched UVs).
 * Keeps the largest structural triangles (trunk, roots, main boughs) + a uniform stride of complete leaf quads.
 */
function decimateTreeGeometryClean(src: BufferGeometry, targetTris: number): BufferGeometry {
  const idxAttr = src.index;
  const posAttr = src.getAttribute("position");
  if (!posAttr) return src;
  const totalIndices = idxAttr ? idxAttr.count : posAttr.count;
  const triCount = Math.floor(totalIndices / 3);
  if (triCount <= targetTris || targetTris <= 0) return src;

  const areas = new Float32Array(triCount);
  const order = new Uint32Array(triCount);

  for (let t = 0; t < triCount; t++) {
    order[t] = t;
    const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
    const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;

    const ax = posAttr.getX(i0), ay = posAttr.getY(i0), az = posAttr.getZ(i0);
    const bx = posAttr.getX(i1), by = posAttr.getY(i1), bz = posAttr.getZ(i1);
    const cx = posAttr.getX(i2), cy = posAttr.getY(i2), cz = posAttr.getZ(i2);

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    areas[t] = nx * nx + ny * ny + nz * nz;
  }

  // Sort triangles by area descending: the top 65% of the budget goes to the largest structural triangles
  // (trunk, roots, primary branches, and large canopy planes), and the remaining 35% samples evenly across the rest.
  order.sort((a, b) => areas[b]! - areas[a]!);

  const keepCount = Math.min(triCount, targetTris);
  const largeBudget = Math.floor(keepCount * 0.68);
  const sampleBudget = keepCount - largeBudget;

  const chosen = new Uint8Array(triCount);
  for (let i = 0; i < largeBudget; i++) {
    chosen[order[i]!] = 1;
  }

  if (sampleBudget > 0 && triCount > largeBudget) {
    const remaining = triCount - largeBudget;
    const step = remaining / sampleBudget;
    for (let s = 0; s < sampleBudget; s++) {
      const idx = largeBudget + Math.min(remaining - 1, Math.floor(s * step));
      chosen[order[idx]!] = 1;
    }
  }

  const vCount = posAttr.count;
  const remap = new Int32Array(vCount).fill(-1);
  const keptVerts: number[] = [];
  const outIndices = new Uint32Array(keepCount * 3);
  let outIdxPtr = 0;

  // Emit kept triangles in original index order so GPU vertex cache locality is preserved.
  for (let t = 0; t < triCount; t++) {
    if (!chosen[t]) continue;
    for (let k = 0; k < 3; k++) {
      const origV = idxAttr ? idxAttr.getX(t * 3 + k) : t * 3 + k;
      let mapped = remap[origV]!;
      if (mapped === -1) {
        mapped = keptVerts.length;
        remap[origV] = mapped;
        keptVerts.push(origV);
      }
      outIndices[outIdxPtr++] = mapped;
    }
  }

  const outVCount = keptVerts.length;
  const uvAttr = src.getAttribute("uv");
  const colAttr = src.getAttribute("color");
  const normAttr = src.getAttribute("normal");

  const outPos = new Float32Array(outVCount * 3);
  const outUv = new Float32Array(outVCount * 2);
  const outCol = new Float32Array(outVCount * 3);
  const outNorm = new Float32Array(outVCount * 3);
  const tmpCol = new Color();

  for (let i = 0; i < outVCount; i++) {
    const sIdx = keptVerts[i]!;
    outPos[i * 3] = posAttr.getX(sIdx);
    outPos[i * 3 + 1] = posAttr.getY(sIdx);
    outPos[i * 3 + 2] = posAttr.getZ(sIdx);
    if (uvAttr) {
      outUv[i * 2] = uvAttr.getX(sIdx);
      outUv[i * 2 + 1] = uvAttr.getY(sIdx);
    }
    if (colAttr) {
      tmpCol.fromBufferAttribute(colAttr, sIdx);
      outCol[i * 3] = tmpCol.r;
      outCol[i * 3 + 1] = tmpCol.g;
      outCol[i * 3 + 2] = tmpCol.b;
    } else {
      outCol[i * 3] = 1;
      outCol[i * 3 + 1] = 1;
      outCol[i * 3 + 2] = 1;
    }
    if (normAttr) {
      outNorm[i * 3] = normAttr.getX(sIdx);
      outNorm[i * 3 + 1] = normAttr.getY(sIdx);
      outNorm[i * 3 + 2] = normAttr.getZ(sIdx);
    }
  }

  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(outPos, 3));
  out.setAttribute("uv", new Float32BufferAttribute(outUv, 2));
  out.setAttribute("color", new Float32BufferAttribute(outCol, 3));
  out.setIndex(new BufferAttribute(outIndices.subarray(0, outIdxPtr), 1));
  if (normAttr) {
    out.setAttribute("normal", new Float32BufferAttribute(outNorm, 3));
  } else {
    out.computeVertexNormals();
  }

  src.dispose();
  return out;
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
        float swayWeight = clamp((transformed.y - 2.4) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.045 * sin(uTime * 1.55 + leafPhase) + 0.02 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
  };
}

/**
 * Extracts all sub-meshes and multi-material primitive groups from `cothu.glb` / `cothu1.glb`,
 * preserving each part's exact original material transparency/color, baseColor/emissive texture,
 * and vertex colors while reducing triangle count cleanly without any UV or vertex distortion.
 */
function prepareAncientTreeModel(
  root: Object3DLike,
  uTime: { value: number },
  targetTotalTris: number,
): PreparedAncientTree {
  const rawParts: { geom: BufferGeometry; mat: MeshStandardMaterial; tris: number }[] = [];
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

  let totalRawTris = 0;

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
          const idx = cleanGeom.index;
          const pos = cleanGeom.getAttribute("position");
          const tris = Math.floor((idx ? idx.count : pos.count) / 3);
          totalRawTris += tris;
          rawParts.push({ geom: cleanGeom, mat: buildPartMaterial(rawMat, hasVertexColors), tris });
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
        const idx = cleanGeom.index;
        const pos = cleanGeom.getAttribute("position");
        const tris = Math.floor((idx ? idx.count : pos.count) / 3);
        totalRawTris += tris;
        rawParts.push({ geom: cleanGeom, mat: buildPartMaterial(rawMat, hasVertexColors), tris });
      }
    }
  });

  for (const m of sourceMats) m.dispose();
  for (const g of sourceGeoms) g.dispose();

  if (rawParts.length === 0) {
    throw new Error("cothu.glb: no mesh geometry found");
  }

  const parts: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];

  for (const entry of rawParts) {
    const share = totalRawTris > 0 ? entry.tris / totalRawTris : 1;
    const partTarget = Math.max(250, Math.round(targetTotalTris * share));
    const decimated = decimateTreeGeometryClean(entry.geom, partTarget);
    parts.push(decimated);
    materials.push(entry.mat);
  }

  // Merge with `useGroups = true` so every sub-mesh retains its own material (bark, branches, leaves).
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, true);
  if (parts.length > 1) {
    for (const p of parts) p.dispose();
  }
  if (!merged) throw new Error("cothu.glb: failed to merge mesh geometries");

  // Align bottom (`min.y`) to y = 0, centre X/Z at 0, and scale height to ANCIENT_BASE_HEIGHT (7.6 m).
  merged.computeBoundingBox();
  const bbox = merged.boundingBox ?? new Box3();
  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;
  const rawHeight = Math.max(0.01, bbox.max.y - bbox.min.y);
  const normalizeScale = ANCIENT_BASE_HEIGHT / rawHeight;

  merged.translate(-cx, -bbox.min.y, -cz);
  merged.scale(normalizeScale, normalizeScale, normalizeScale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const materialOrArray: Material | Material[] =
    materials.length === 1 ? materials[0]! : materials;

  return { geometry: merged, materials, materialOrArray, textures };
}

/** Distant broad-canopy tree (unit height) for the outer forest ring. */
function createFarCanopyTreeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = colorGeo(new CylinderGeometry(0.042, 0.072, 0.38, 5).translate(0, 0.19, 0), 0x2b1d12);
  const subShade = colorGeo(new SphereGeometry(0.38, 6, 4).scale(1.32, 0.52, 1.32).translate(0, 0.44, 0), 0x102413);
  const lowL = colorGeo(new SphereGeometry(0.36, 6, 4).scale(1.25, 0.58, 1.25).translate(-0.12, 0.54, 0.07), 0x152e19);
  const lowR = colorGeo(new SphereGeometry(0.36, 6, 4).scale(1.28, 0.6, 1.28).translate(0.12, 0.6, -0.06), 0x1a381f);
  const top = colorGeo(new SphereGeometry(0.34, 6, 4).scale(1.2, 0.62, 1.2).translate(0, 0.75, 0), 0x214226);
  parts.push(trunk, subShade, lowL, lowR, top);
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: far canopy trees");
  return merged;
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
      mesh.boundingSphere.radius += 2.5;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `${namePrefix}:${label}`;
    meshes.push(mesh);
  }
  return meshes;
}

/** Two columns of irregular flagstones along the stone path (castShadow = false: flat 5cm ground slabs). */
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

  // 1. Prepare `models/cothu.glb` preserving exact original vertex UVs/colors/materials without spikes.
  const uTreeTime = { value: 0 };
  const preparedTree = prepareAncientTreeModel(cothuGltf.scene, uTreeTime, FOREST_TREE_TARGET_TRIS);
  for (const mat of preparedTree.materials) own(mat);

  // 2. Prepare `models/cothu1.glb` specifically for the Wishing Tree outside the gate.
  let preparedWishTree: PreparedAncientTree | null = null;
  if (wishTreeGltf) {
    try {
      preparedWishTree = prepareAncientTreeModel(wishTreeGltf.scene, uTreeTime, HERO_TREE_TARGET_TRIS);
      for (const mat of preparedWishTree.materials) own(mat);
    } catch (err) {
      console.warn("[garden] Fallback to models/cothu.glb for Wishing Tree:", err);
      preparedWishTree = null;
    }
  }
  const activeWishTree = preparedWishTree ?? preparedTree;
  attachAncientTreeToWishingTree(
    activeWishTree.geometry,
    activeWishTree.materialOrArray as unknown as MeshStandardMaterial,
  );

  const ancientItems: { x: number; z: number; matrix: Matrix4 }[] = [];
  for (const tier of ANCIENT_TIERS) {
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

      ancientItems.push({ x: p.x, z: p.z, matrix: place(p.x, 0, p.z, yaw, sx, sc, sz).clone() });
    }
  }

  // Distant broad-canopy forest ring beyond Tier 4 with darkened, non-glowing PBR foliage.
  const farGeo = createFarCanopyTreeGeometry();
  const farMat = own(
    new MeshStandardMaterial({
      vertexColors: true,
      color: new Color(0x829985),
      roughness: 0.94,
      metalness: 0.0,
    }),
  );
  const farItems: { x: number; z: number; matrix: Matrix4 }[] = [];
  const farGap = GATE_GAP_RAD * 0.3;
  const farArc = Math.PI * 2 - 2 * farGap;
  for (let i = 0; i < FAR_TREE_COUNT; i++) {
    const slot = i + (i % 3) * 0.33 + (rand() - 0.5) * 0.28;
    const a = Math.PI / 2 + farGap + (((slot % FAR_TREE_COUNT) + FAR_TREE_COUNT) % FAR_TREE_COUNT / FAR_TREE_COUNT) * farArc;
    const p = ringPoint(a, FAR_RING[0] + rand() * (FAR_RING[1] - FAR_RING[0]));
    const h = FAR_HEIGHT[0] + rand() * (FAR_HEIGHT[1] - FAR_HEIGHT[0]);
    const w = h * (1.05 + rand() * 0.38);
    farItems.push({ x: p.x, z: p.z, matrix: place(p.x, 0, p.z, rand() * Math.PI * 2, w, h, w).clone() });
  }

  const forest: InstancedMesh[] = [
    ...buildHemisphereInstancedMeshes("ancient-trees", preparedTree.geometry, preparedTree.materialOrArray, ancientItems, false),
    ...buildHemisphereInstancedMeshes("far-trees", farGeo, farMat, farItems, false),
  ];
  for (const o of forest) {
    scene.add(o);
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
      preparedTree.geometry.dispose();
      for (const tex of preparedTree.textures) tex.dispose();
      if (preparedWishTree) {
        preparedWishTree.geometry.dispose();
        for (const tex of preparedWishTree.textures) tex.dispose();
      }
      farGeo.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
