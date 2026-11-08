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
import { GATE } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { seeded } from "./random.ts";

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_WALL_X = 18;

/**
 * Placed OUTSIDE the temple gate (z = GATE_Z + 2.6) right at the far-left end
 * of the left perimeter wall (x = -GATE_WALL_X - 0.5 = -18.5).
 */
export const WISH_TREE_POS = {
  x: -GATE_WALL_X - 0.5,
  z: GATE_Z + 2.6,
} as const;

const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 16;
/** Scale applied to the normalized 7.6 m `cothu.glb` geometry so it fits the octagonal stone planter. */
const WISHING_TREE_SCALE = 0.88;
const WISHING_TREE_BASE_Y = 0.22;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

/** Shared `cothu.glb` geometry & material provided by `createGarden`. */
let cachedAncientTree: { geometry: BufferGeometry; material: MeshStandardMaterial } | null = null;
let activeTreeSlot: ((geometry: BufferGeometry, material: MeshStandardMaterial) => void) | null = null;

/**
 * Shares the normalized `cothu.glb` geometry and material from `garden.ts`
 * with the Wishing Tree so the model is loaded and stored in GPU memory only once.
 */
export function attachAncientTreeToWishingTree(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
): void {
  cachedAncientTree = { geometry, material };
  if (activeTreeSlot) {
    activeTreeSlot(geometry, material);
  }
}

function paintGeometry(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

function buildPlanterGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const baseStep = new CylinderGeometry(2.15, 2.25, 0.14, 8);
  baseStep.translate(0, 0.07, 0);
  parts.push(paintGeometry(baseStep, 0x7a7469));

  const curbWall = new CylinderGeometry(1.92, 2.0, 0.32, 8);
  curbWall.translate(0, 0.26, 0);
  parts.push(paintGeometry(curbWall, 0x918a7d));

  const topLip = new CylinderGeometry(2.04, 2.04, 0.07, 8);
  topLip.translate(0, 0.44, 0);
  parts.push(paintGeometry(topLip, 0xa8a092));

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * 1.96;
    const pz = Math.sin(a) * 1.96;
    const post = new CylinderGeometry(0.095, 0.11, 0.52, 6);
    post.translate(px, 0.27, pz);
    parts.push(paintGeometry(post, 0x9c9587));

    const cap = new SphereGeometry(0.1, 8, 6);
    cap.scale(1, 0.75, 1);
    cap.translate(px, 0.55, pz);
    parts.push(paintGeometry(cap, 0xb3ab9c));
  }

  const soil = new CylinderGeometry(1.82, 1.82, 0.36, 16);
  soil.translate(0, 0.2, 0);
  parts.push(paintGeometry(soil, 0x453424));

  const moss = new SphereGeometry(1.8, 14, 8);
  moss.scale(1, 0.2, 1);
  moss.translate(0, 0.34, 0);
  parts.push(paintGeometry(moss, 0x3b8038));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree planter");
  return merged;
}

interface HangSpot {
  x: number;
  y: number;
  z: number;
}

/** Generates anchor positions beneath the lower boughs of the `cothu.glb` canopy. */
function buildHangSpots(): HangSpot[] {
  const spots: HangSpot[] = [];
  const mainBoughs = 6;
  for (let i = 0; i < mainBoughs; i++) {
    const a = (i / mainBoughs) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const midY = 2.95 + (i % 3) * 0.16;
    const outerY = 3.35 + (i % 2) * 0.18;

    spots.push({ x: ca * 1.48, y: midY, z: sa * 1.48 });
    spots.push({ x: ca * 2.35, y: outerY, z: sa * 2.35 });

    for (const forkSide of [-1, 1] as const) {
      const fa = a + forkSide * 0.42;
      spots.push({
        x: Math.cos(fa) * 2.15,
        y: outerY - 0.12,
        z: Math.sin(fa) * 2.15,
      });
    }
  }
  return spots;
}

function buildTreeLanternsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 6;
  const radius = 2.15;
  const yTop = 3.48;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.28;
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;

    const cord = new CylinderGeometry(0.008, 0.008, 0.32, 5);
    cord.translate(lx, yTop - 0.16, lz);
    parts.push(paintGeometry(cord, 0x3b2818));

    const cap = new CylinderGeometry(0.09, 0.115, 0.04, 8);
    cap.translate(lx, yTop - 0.32, lz);
    parts.push(paintGeometry(cap, 0x4a2e1b));

    const glowCore = new SphereGeometry(0.098, 10, 8);
    glowCore.scale(1, 1.3, 1);
    glowCore.translate(lx, yTop - 0.43, lz);
    parts.push(paintGeometry(glowCore, 0xffdfa0));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree lanterns");
  return merged;
}

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

  const root = new Group();
  root.position.set(WISH_TREE_POS.x, 0, WISH_TREE_POS.z);
  root.name = "wishing-tree";

  const planterGeo = buildPlanterGeometry();
  const planterMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
  const planterMesh = new Mesh(planterGeo, planterMat);
  planterMesh.receiveShadow = true;
  planterMesh.castShadow = true;
  planterMesh.matrixAutoUpdate = false;
  planterMesh.updateMatrix();

  // Mount for the `cothu.glb` ancient tree model shared from `garden.ts`.
  let treeMesh: Mesh | null = null;
  const mountAncientTree = (geometry: BufferGeometry, material: MeshStandardMaterial): void => {
    if (treeMesh) {
      root.remove(treeMesh);
    }
    treeMesh = new Mesh(geometry, material);
    treeMesh.position.set(0, WISHING_TREE_BASE_Y, 0);
    treeMesh.scale.setScalar(WISHING_TREE_SCALE);
    treeMesh.castShadow = true;
    treeMesh.receiveShadow = true;
    treeMesh.name = "wishing-tree-ancient-model";
    treeMesh.matrixAutoUpdate = false;
    treeMesh.updateMatrix();
    root.add(treeMesh);
  };

  activeTreeSlot = mountAncientTree;
  if (cachedAncientTree) {
    mountAncientTree(cachedAncientTree.geometry, cachedAncientTree.material);
  }

  const lanternGeo = buildTreeLanternsGeometry();
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    emissive: new Color(0xffa438),
    emissiveIntensity: 0.85,
  });
  const lanternMesh = new Mesh(lanternGeo, lanternMat);
  lanternMesh.matrixAutoUpdate = false;
  lanternMesh.updateMatrix();

  const plaqueGeo = buildPlaqueGeometry();
  const plaqueMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.12,
    emissive: new Color(0x8a1c10),
    emissiveIntensity: 0.32,
  });
  const plaqueMesh = new InstancedMesh(plaqueGeo, plaqueMat, MAX_PLAQUES);
  plaqueMesh.frustumCulled = false;
  plaqueMesh.castShadow = true;
  plaqueMesh.name = "wishing-plaques";

  const hangSpots = buildHangSpots();
  const plaques: PlaqueState[] = Array.from({ length: MAX_PLAQUES }, (_, i) => {
    const anchor = hangSpots[i % hangSpots.length];
    const jitterAngle = (i / MAX_PLAQUES) * Math.PI * 2 + (rand() - 0.5) * 0.22;
    let px: number;
    let py: number;
    let pz: number;
    if (anchor && i < hangSpots.length) {
      px = anchor.x + (rand() - 0.5) * 0.26;
      py = anchor.y + (rand() - 0.5) * 0.14;
      pz = anchor.z + (rand() - 0.5) * 0.26;
    } else {
      const r = 1.65 + (i % 3) * 0.42 + (rand() - 0.5) * 0.22;
      px = Math.cos(jitterAngle) * r;
      pz = Math.sin(jitterAngle) * r;
      py = 2.95 + (i % 3) * 0.24 + (rand() - 0.5) * 0.16;
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
      scale: 0.96 + rand() * 0.24,
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

  root.add(planterMesh, lanternMesh, plaqueMesh);
  parent.add(root);

  registerCameraPreset("wishtree", {
    position: [WISH_TREE_POS.x + 5.8, 3.2, WISH_TREE_POS.z - 6.8],
    target: [WISH_TREE_POS.x, 3.0, WISH_TREE_POS.z],
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
      const night = Math.max(0, Math.min(1, 1 - daylight));
      lanternMat.emissiveIntensity = 0.75 + night * 1.65 + 0.1 * Math.sin(t * 2.8);
      plaqueMat.emissiveIntensity = 0.26 + night * 0.52;
      updatePlaques(t, dt);
    },
    dispose() {
      if (activeTreeSlot === mountAncientTree) {
        activeTreeSlot = null;
      }
      if (treeMesh) {
        root.remove(treeMesh);
        treeMesh = null;
      }
      parent.remove(root);
      plaqueMesh.dispose();
      for (const g of [planterGeo, lanternGeo, plaqueGeo]) g.dispose();
      for (const m of [planterMat, lanternMat, plaqueMat]) m.dispose();
    },
  };
}
