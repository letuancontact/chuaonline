import {
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
import { registerCameraPreset } from "../debug/params.ts";
import { seeded } from "./random.ts";

/** Southwest courtyard location, balancing the Lotus Pond on the east and clear of the main Hall. */
export const WISH_TREE_POS = { x: -12.8, z: 11.5 } as const;

const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 14;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

function paintGeometry(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** Builds the octagonal stone planter bed and soil mound around the Bodhi tree's roots. */
function buildPlanterGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  const outerRim = new CylinderGeometry(2.35, 2.5, 0.36, 16);
  outerRim.translate(0, 0.18, 0);
  parts.push(paintGeometry(outerRim, 0x847e72));

  const topLip = new CylinderGeometry(2.46, 2.46, 0.07, 16);
  topLip.translate(0, 0.37, 0);
  parts.push(paintGeometry(topLip, 0x9a9386));

  const soil = new CylinderGeometry(2.18, 2.22, 0.32, 16);
  soil.translate(0, 0.17, 0);
  parts.push(paintGeometry(soil, 0x3b2d1f));

  const mossMound = new SphereGeometry(2.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  mossMound.scale(1, 0.18, 1);
  mossMound.translate(0, 0.3, 0);
  parts.push(paintGeometry(mossMound, 0x3d5230));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree planter");
  return merged;
}

/** Builds the gnarled ancient Bodhi trunk, surface roots, and spreading boughs. */
function buildTrunkGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Main trunk rising from the planter bed
  const lowerTrunk = new CylinderGeometry(0.46, 0.68, 1.8, 10);
  lowerTrunk.translate(0, 1.1, 0);
  parts.push(paintGeometry(lowerTrunk, 0x4d3828));

  const midTrunk = new CylinderGeometry(0.36, 0.48, 1.4, 10);
  midTrunk.rotateZ(0.06);
  midTrunk.translate(-0.04, 2.45, 0);
  parts.push(paintGeometry(midTrunk, 0x563f2d));

  // 5 spreading surface roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const root = new CylinderGeometry(0.12, 0.24, 1.35, 7);
    root.rotateZ(0.92);
    root.rotateY(a);
    root.translate(Math.cos(a) * 0.72, 0.52, Math.sin(a) * 0.72);
    parts.push(paintGeometry(root, 0x463223));
  }

  // 6 primary boughs reaching outward to hold the canopy and wishing plaques
  const boughSpecs: readonly (readonly [number, number, number, number])[] = [
    [0.0, 2.35, 0.78, 2.2],
    [1.05, 2.45, 0.74, 2.15],
    [2.1, 2.4, 0.76, 2.25],
    [3.14, 2.5, 0.72, 2.1],
    [4.2, 2.38, 0.78, 2.2],
    [5.25, 2.48, 0.75, 2.15],
  ];

  for (const [yaw, yStart, tilt, len] of boughSpecs) {
    const bough = new CylinderGeometry(0.11, 0.25, len, 8);
    bough.translate(0, len * 0.5, 0);
    bough.rotateZ(tilt);
    bough.rotateY(yaw);
    bough.translate(0, yStart, 0);
    parts.push(paintGeometry(bough, 0x523b2a));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree trunk");
  return merged;
}

/** Builds the multi-layered sacred Bodhi foliage canopy with green and golden-leaf highlights. */
function buildCanopyGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const clusters: readonly (readonly [number, number, number, number, number, number])[] = [
    // [x, y, z, rx, ry, hexColor]
    [0, 4.35, 0, 2.35, 1.25, 0x3b6e3c],
    [0, 5.05, 0, 1.65, 0.95, 0x628b38],
    [1.75, 3.65, 0.4, 1.55, 0.92, 0x2f5c34],
    [-1.75, 3.6, -0.35, 1.6, 0.92, 0x346337],
    [0.45, 3.7, 1.75, 1.55, 0.9, 0x396b3a],
    [-0.45, 3.65, -1.75, 1.55, 0.9, 0x2e5932],
    [1.35, 3.85, -1.35, 1.45, 0.88, 0x45753c],
    [-1.35, 3.8, 1.35, 1.45, 0.88, 0x497a3e],
    [2.35, 3.25, -0.2, 1.2, 0.74, 0x3d6d3b],
    [-2.35, 3.22, 0.25, 1.2, 0.74, 0x366436],
    [0.2, 3.25, 2.35, 1.2, 0.74, 0x42733d],
    [-0.2, 3.22, -2.35, 1.2, 0.74, 0x336035],
    [1.65, 3.3, 1.55, 1.18, 0.72, 0x588239],
    [-1.65, 3.28, -1.55, 1.18, 0.72, 0x527c38],
  ];

  for (const [x, y, z, rHoriz, rVert, color] of clusters) {
    const sphere = new SphereGeometry(1, 12, 8);
    sphere.scale(rHoriz, rVert, rHoriz);
    sphere.translate(x, y, z);
    parts.push(paintGeometry(sphere, color));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree canopy");
  return merged;
}

/** Builds 6 warm golden temple lanterns hanging beneath the main boughs. */
function buildTreeLanternsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 6;
  const radius = 2.05;
  const yTop = 3.05;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.52;
    const lx = Math.cos(a) * radius;
    const lz = Math.sin(a) * radius;

    const cord = new CylinderGeometry(0.008, 0.008, 0.28, 5);
    cord.translate(lx, yTop - 0.14, lz);
    parts.push(paintGeometry(cord, 0x3b2818));

    const cap = new CylinderGeometry(0.09, 0.11, 0.04, 8);
    cap.translate(lx, yTop - 0.28, lz);
    parts.push(paintGeometry(cap, 0x4a2e1b));

    const glowCore = new SphereGeometry(0.095, 10, 8);
    glowCore.scale(1, 1.28, 1);
    glowCore.translate(lx, yTop - 0.39, lz);
    parts.push(paintGeometry(glowCore, 0xffdfa0));
  }

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: wishing tree lanterns");
  return merged;
}

/**
 * Single 3D Wishing Plaque & Silk Ribbon with its origin at (0, 0, 0) (the branch knot)
 * so rotating the instance matrix swings the plaque and tassel naturally like a pendulum.
 */
function buildPlaqueGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // 1. Golden silk hanging cord from y = 0 down to y = -0.10
  const cord = new CylinderGeometry(0.005, 0.005, 0.1, 5);
  cord.translate(0, -0.05, 0);
  parts.push(paintGeometry(cord, 0xf2c96d));

  // 2. Top gold-bronze clasp rim
  const topCap = new CylinderGeometry(0.048, 0.052, 0.022, 6);
  topCap.scale(1, 1, 0.28);
  topCap.translate(0, -0.11, 0);
  parts.push(paintGeometry(topCap, 0xe0aa3e));

  // 3. Vermilion-red lacquered wishing tablet body
  const tablet = new CylinderGeometry(0.05, 0.046, 0.21, 6);
  tablet.scale(1, 1, 0.22);
  tablet.translate(0, -0.22, 0);
  parts.push(paintGeometry(tablet, 0xc92a1d));

  // 4. Central vertical gold inscription stripe on front & back
  const inscription = new CylinderGeometry(0.016, 0.016, 0.16, 6);
  inscription.scale(1, 1, 0.28);
  inscription.translate(0, -0.22, 0);
  parts.push(paintGeometry(inscription, 0xffdf80));

  // 5. Bottom gold-bronze clasp rim
  const botCap = new CylinderGeometry(0.046, 0.042, 0.02, 6);
  botCap.scale(1, 1, 0.28);
  botCap.translate(0, -0.33, 0);
  parts.push(paintGeometry(botCap, 0xe0aa3e));

  // 6. Fluttering crimson silk tassel hanging below the plaque
  const tassel = new CylinderGeometry(0.012, 0.028, 0.17, 6);
  tassel.scale(1, 1, 0.2);
  tassel.translate(0, -0.42, 0);
  parts.push(paintGeometry(tassel, 0xe03b2b));

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

  const trunkGeo = buildTrunkGeometry();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.03 });
  const trunkMesh = new Mesh(trunkGeo, trunkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;

  const canopyGeo = buildCanopyGeometry();
  const canopyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
  const canopyMesh = new Mesh(canopyGeo, canopyMat);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;

  const lanternGeo = buildTreeLanternsGeometry();
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    emissive: new Color(0xffa438),
    emissiveIntensity: 0.75,
  });
  const lanternMesh = new Mesh(lanternGeo, lanternMat);

  const plaqueGeo = buildPlaqueGeometry();
  const plaqueMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.12,
    emissive: new Color(0x8a1c10),
    emissiveIntensity: 0.28,
  });
  const plaqueMesh = new InstancedMesh(plaqueGeo, plaqueMat, MAX_PLAQUES);
  plaqueMesh.frustumCulled = false;
  plaqueMesh.castShadow = true;
  plaqueMesh.name = "wishing-plaques";

  const plaques: PlaqueState[] = Array.from({ length: MAX_PLAQUES }, (_, i) => {
    const ring = i < 20 ? 0 : 1;
    const idxInRing = ring === 0 ? i : i - 20;
    const countInRing = ring === 0 ? 20 : 16;
    const angle = (idxInRing / countInRing) * Math.PI * 2 + (ring * 0.24) + (rand() - 0.5) * 0.14;
    const radius = ring === 0 ? 2.15 + (rand() - 0.5) * 0.45 : 1.45 + (rand() - 0.5) * 0.35;
    const y = ring === 0 ? 2.68 + (rand() - 0.5) * 0.36 : 2.38 + (rand() - 0.5) * 0.28;
    return {
      active: i < INITIAL_PLAQUES,
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      baseYaw: -angle + Math.PI * 0.5 + (rand() - 0.5) * 0.5,
      phase: rand() * Math.PI * 2,
      freq: 1.65 + rand() * 0.75,
      scale: 0.92 + rand() * 0.24,
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
      const breeze = 0.11 + p.impulse * 0.34;
      const pitch = Math.sin(t * p.freq + p.phase) * breeze;
      const roll = Math.cos(t * (p.freq * 0.78) + p.phase * 1.3) * (breeze * 0.65);
      const yaw = p.baseYaw + Math.sin(t * 0.9 + p.phase) * (0.14 + p.impulse * 0.2);

      tmpEuler.set(pitch, yaw, roll, "YXZ");
      q.setFromEuler(tmpEuler);
      const sc = p.scale * (1 + p.impulse * 0.16);
      plaqueMesh.setMatrixAt(i, m4.compose(v3.set(p.x, p.y, p.z), q, s3.setScalar(sc)));
    }
    plaqueMesh.instanceMatrix.needsUpdate = true;
  };

  updatePlaques(0, 0);

  for (const m of [planterMesh, trunkMesh, canopyMesh, lanternMesh]) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }
  root.add(planterMesh, trunkMesh, canopyMesh, lanternMesh, plaqueMesh);
  parent.add(root);

  registerCameraPreset("wishtree", {
    position: [WISH_TREE_POS.x + 6.2, 2.8, WISH_TREE_POS.z + 6.8],
    target: [WISH_TREE_POS.x, 2.4, WISH_TREE_POS.z],
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
      lanternMat.emissiveIntensity = 0.65 + night * 1.55 + 0.1 * Math.sin(t * 2.8);
      plaqueMat.emissiveIntensity = 0.22 + night * 0.48;
      updatePlaques(t, dt);
    },
    dispose() {
      parent.remove(root);
      plaqueMesh.dispose();
      for (const g of [planterGeo, trunkGeo, canopyGeo, lanternGeo, plaqueGeo]) g.dispose();
      for (const m of [planterMat, trunkMat, canopyMat, lanternMat, plaqueMat]) m.dispose();
    },
  };
}
