import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import { HALL, POND } from "@santinh/shared";
import { radialTexture } from "../engine/radial-texture.ts";
import { seeded } from "./random.ts";

const FIREFLY_COUNT = 40;
const LEAF_COUNT = 42;
const BUTTERFLY_COUNT = 14;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

/** Returns true if (x, z) lies inside the main temple hall plus a safety margin. */
function insideHall(x: number, z: number, pad = 2.0): boolean {
  return x > HALL.xMin - pad && x < HALL.xMax + pad && z > HALL.zMin - pad && z < HALL.zMax + pad;
}

/** Picks an outdoor courtyard/garden point strictly outside the main hall. */
function pickOutdoorPoint(rand: () => number): { x: number; z: number } {
  for (let attempt = 0; attempt < 16; attempt++) {
    const x = (rand() - 0.5) * 44;
    const z = -10 + rand() * 42;
    if (!insideHall(x, z, 2.2)) return { x, z };
  }
  return { x: POND.x + (rand() - 0.5) * 12, z: POND.z + (rand() - 0.5) * 14 };
}

interface FireflyData {
  ax: number;
  ay: number;
  az: number;
  rx: number;
  rz: number;
  speed: number;
  phase: number;
}

interface LeafData {
  ox: number;
  oz: number;
  y: number;
  fallSpeed: number;
  swayAmp: number;
  swayFreq: number;
  rx: number;
  ry: number;
  rz: number;
  phase: number;
  scale: number;
}

interface ButterflyData {
  cx: number;
  cz: number;
  radius: number;
  angle: number;
  speed: number;
  y: number;
  amplitude: number;
  frequency: number;
  phase: number;
}

function buildLeafGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  // Diamond-heart Bodhi leaf silhouette (two triangles meeting at the central vein).
  const positions = new Float32Array([
    0, 0.14, 0, -0.075, 0.02, 0.01, 0, -0.11, 0,
    0, 0.14, 0, 0, -0.11, 0, 0.075, 0.02, -0.01,
  ]);
  const gold = new Color(0xe0a83e);
  const amber = new Color(0xc97a2b);
  const colors = new Float32Array([
    gold.r, gold.g, gold.b, amber.r, amber.g, amber.b, gold.r, gold.g, gold.b,
    gold.r, gold.g, gold.b, gold.r, gold.g, gold.b, amber.r, amber.g, amber.b,
  ]);
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function buildButterflyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  // Left and right angled wings meeting at the body centreline (Z = forward).
  const positions = new Float32Array([
    // Left forewing & hindwing
    0, 0, 0.05, -0.11, 0.04, 0.06, -0.08, 0.02, -0.06,
    0, 0, 0.05, -0.08, 0.02, -0.06, 0, 0, -0.05,
    // Right forewing & hindwing
    0, 0, 0.05, 0.08, 0.02, -0.06, 0.11, 0.04, 0.06,
    0, 0, 0.05, 0, 0, -0.05, 0.08, 0.02, -0.06,
  ]);
  const inner = new Color(0xffe270);
  const tip = new Color(0xff9e44);
  const colors = new Float32Array([
    inner.r, inner.g, inner.b, tip.r, tip.g, tip.b, tip.r, tip.g, tip.b,
    inner.r, inner.g, inner.b, tip.r, tip.g, tip.b, inner.r, inner.g, inner.b,
    inner.r, inner.g, inner.b, tip.r, tip.g, tip.b, tip.r, tip.g, tip.b,
    inner.r, inner.g, inner.b, inner.r, inner.g, inner.b, tip.r, tip.g, tip.b,
  ]);
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export interface Nature {
  update(dt: number, t: number, daylight: number): void;
  dispose(): void;
}

export function createNature(scene: Scene): Nature {
  const rand = seeded(0x5a7);

  // 1. Night fireflies around the lotus pond and garden paths (1 Points draw call).
  const fireflyGeo = new BufferGeometry();
  const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
  const fireflyAttr = new Float32BufferAttribute(fireflyPositions, 3);
  fireflyGeo.setAttribute("position", fireflyAttr);
  const fireflies: FireflyData[] = [];

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    // 70% clustered around the lotus pond, 30% in the outer courtyard garden.
    let ax: number;
    let az: number;
    if (i < Math.floor(FIREFLY_COUNT * 0.7)) {
      const a = rand() * Math.PI * 2;
      const r = 0.35 + rand() * 0.85;
      ax = POND.x + Math.cos(a) * POND.rx * r;
      az = POND.z + Math.sin(a) * POND.rz * r;
    } else {
      const pt = pickOutdoorPoint(rand);
      ax = pt.x;
      az = pt.z;
    }
    const ay = 0.45 + rand() * 1.85;
    fireflyPositions[i * 3] = ax;
    fireflyPositions[i * 3 + 1] = ay;
    fireflyPositions[i * 3 + 2] = az;
    fireflies.push({
      ax,
      ay,
      az,
      rx: 0.45 + rand() * 0.9,
      rz: 0.45 + rand() * 0.9,
      speed: 0.45 + rand() * 0.65,
      phase: rand() * Math.PI * 2,
    });
  }

  const fireflyTex = radialTexture();
  const fireflyMat = new PointsMaterial({
    map: fireflyTex,
    color: new Color(0xd8ff66),
    size: 0.22,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const fireflyPoints = new Points(fireflyGeo, fireflyMat);
  fireflyPoints.name = "nature-fireflies";
  fireflyPoints.frustumCulled = false;
  scene.add(fireflyPoints);

  // 2. Falling golden Bodhi leaves in the temple courtyard (1 InstancedMesh draw call).
  const leafGeo = buildLeafGeometry();
  const leafMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.05,
    side: DoubleSide,
  });
  const leafMesh = new InstancedMesh(leafGeo, leafMat, LEAF_COUNT);
  leafMesh.name = "nature-leaves";
  leafMesh.frustumCulled = false;
  const leaves: LeafData[] = [];

  for (let i = 0; i < LEAF_COUNT; i++) {
    const pt = pickOutdoorPoint(rand);
    leaves.push({
      ox: pt.x,
      oz: pt.z,
      y: 0.3 + rand() * 6.0,
      fallSpeed: 0.42 + rand() * 0.38,
      swayAmp: 0.45 + rand() * 0.55,
      swayFreq: 0.8 + rand() * 0.9,
      rx: rand() * Math.PI * 2,
      ry: rand() * Math.PI * 2,
      rz: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2,
      scale: 0.65 + rand() * 0.45,
    });
  }
  scene.add(leafMesh);

  // 3. Daytime butterflies fluttering around the pond and garden (1 InstancedMesh draw call).
  const bflyGeo = buildButterflyGeometry();
  const bflyMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.08,
    emissive: new Color(0x2a1d06),
    side: DoubleSide,
  });
  const bflyMesh = new InstancedMesh(bflyGeo, bflyMat, BUTTERFLY_COUNT);
  bflyMesh.name = "nature-butterflies";
  bflyMesh.frustumCulled = false;
  const butterflies: ButterflyData[] = [];

  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    // Half near the lotus pond, half in the sunny courtyard outside the hall.
    const nearPond = i < Math.ceil(BUTTERFLY_COUNT / 2);
    const pt = nearPond
      ? { x: POND.x + (rand() - 0.5) * POND.rx * 1.4, z: POND.z + (rand() - 0.5) * POND.rz * 1.4 }
      : pickOutdoorPoint(rand);
    butterflies.push({
      cx: pt.x,
      cz: pt.z,
      radius: 1.6 + rand() * 2.4,
      angle: rand() * Math.PI * 2,
      speed: 0.55 + rand() * 0.45,
      y: 0.75 + rand() * 1.35,
      amplitude: 0.22 + rand() * 0.28,
      frequency: 2.2 + rand() * 1.4,
      phase: rand() * Math.PI * 2,
    });
  }
  scene.add(bflyMesh);

  return {
    update(dt, t, daylight) {
      const night = Math.max(0, Math.min(1, 1 - daylight));

      // 1. Update fireflies (active from dusk through dawn).
      if (night > 0.08) {
        fireflyPoints.visible = true;
        fireflyMat.opacity = Math.min(0.92, night * 1.15);
        fireflyMat.size = 0.2 + 0.05 * Math.sin(t * 2.4);
        for (let i = 0; i < FIREFLY_COUNT; i++) {
          const f = fireflies[i];
          if (!f) continue;
          const a = t * f.speed + f.phase;
          const fx = f.ax + Math.cos(a) * f.rx + Math.sin(a * 0.7) * 0.25;
          const fz = f.az + Math.sin(a * 0.85) * f.rz;
          const fy = f.ay + Math.sin(t * (f.speed * 1.6) + f.phase) * 0.28;
          fireflyAttr.setXYZ(i, fx, fy, fz);
        }
        fireflyAttr.needsUpdate = true;
      } else {
        fireflyPoints.visible = false;
      }

      // 2. Update falling golden leaves.
      for (let i = 0; i < LEAF_COUNT; i++) {
        const l = leaves[i];
        if (!l) continue;
        l.y -= l.fallSpeed * dt;
        l.rx += dt * 1.1;
        l.ry += dt * 0.85;
        l.rz += dt * 0.6;
        if (l.y < 0.06) {
          l.y = 5.4 + ((i * 0.37) % 1.8);
        }
        const swayX = Math.sin(t * l.swayFreq + l.phase) * l.swayAmp;
        const swayZ = Math.cos(t * (l.swayFreq * 0.8) + l.phase) * l.swayAmp;
        let lx = l.ox + swayX;
        let lz = l.oz + swayZ;
        if (insideHall(lx, lz, 1.5)) {
          lx = POND.x + swayX;
          lz = POND.z + swayZ;
        }
        tmpEuler.set(l.rx, l.ry, l.rz, "XYZ");
        q.setFromEuler(tmpEuler);
        leafMesh.setMatrixAt(i, m4.compose(v3.set(lx, l.y, lz), q, s3.setScalar(l.scale)));
      }
      leafMesh.instanceMatrix.needsUpdate = true;

      // 3. Update daytime butterflies (active when daylight > 0.2).
      if (daylight > 0.2) {
        bflyMesh.visible = true;
        for (let i = 0; i < BUTTERFLY_COUNT; i++) {
          const b = butterflies[i];
          if (!b) continue;
          b.angle += b.speed * dt;
          // Figure-eight /lissajous curve around the anchor point.
          let bx = b.cx + Math.cos(b.angle) * b.radius;
          let bz = b.cz + Math.sin(b.angle * 2) * (b.radius * 0.55);
          if (insideHall(bx, bz, 1.6)) {
            bx = POND.x + Math.cos(b.angle) * 3.5;
            bz = POND.z + Math.sin(b.angle) * 3.5;
          }
          const by = b.y + Math.sin(t * b.frequency + b.phase) * b.amplitude;
          const dx = -Math.sin(b.angle) * b.radius;
          const dz = Math.cos(b.angle * 2) * (b.radius * 1.1);
          const yaw = Math.atan2(dx, dz);
          const pitch = Math.cos(t * b.frequency + b.phase) * 0.18;
          // Rapid wing-flap: compress X span and boost Y height rhythmically.
          const flap = Math.sin(t * 19 + b.phase * 3);
          const wingX = 0.35 + 0.65 * Math.abs(flap);
          const wingY = 1.0 + 0.45 * (1 - wingX);

          tmpEuler.set(pitch, yaw, 0, "YXZ");
          q.setFromEuler(tmpEuler);
          bflyMesh.setMatrixAt(i, m4.compose(v3.set(bx, by, bz), q, s3.set(wingX, wingY, 1)));
        }
        bflyMesh.instanceMatrix.needsUpdate = true;
      } else {
        bflyMesh.visible = false;
      }
    },
    dispose() {
      scene.remove(fireflyPoints);
      scene.remove(leafMesh);
      scene.remove(bflyMesh);
      fireflyPoints.geometry.dispose();
      fireflyMat.dispose();
      fireflyTex.dispose();
      leafMesh.dispose();
      leafGeo.dispose();
      leafMat.dispose();
      bflyMesh.dispose();
      bflyGeo.dispose();
      bflyMat.dispose();
    },
  };
}
