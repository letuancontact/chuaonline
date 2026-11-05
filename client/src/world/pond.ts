import {
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LOTUS_FLOWERS, POND } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import type { Materials } from "./materials.ts";
import { seeded } from "./random.ts";

/** Water sits just above the ground plane (which runs under the pond). */
const WATER_Y = 0.04;
/** Stone bank: ring from the water edge outwards, as a fraction of the pond radii. */
const BANK_OUTER = 1.12;
const LEAF_COUNT = 16;
const FLOWER_SCALE = 1.8;
const MAX_LANTERNS = 12;
const INITIAL_LANTERNS = 4;
const LANTERN_SCALE = 1.45;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const Y = new Vector3(0, 1, 0);

/** One lotus: two rings of petals (squashed spheres) around a yellow seed head, coloured per vertex. */
function flowerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number): void => {
    const c = new Color(color);
    const n = g.getAttribute("position").count;
    g.setAttribute("color", new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3] ?? 1), 3));
    parts.push(g);
  };
  const ring = (count: number, len: number, tilt: number, color: number, phase: number): void => {
    for (let i = 0; i < count; i++) {
      const g = new SphereGeometry(1, 8, 6);
      g.scale(0.05, 0.022, len);
      g.translate(0, 0, len * 0.9);
      g.rotateX(-tilt);
      g.rotateY((i / count) * Math.PI * 2 + phase);
      add(g, color);
    }
  };
  ring(8, 0.12, 0.45, 0xe9a3b4, 0);
  ring(6, 0.09, 0.95, 0xf4ccd4, 0.4);
  const head = new SphereGeometry(0.045, 10, 6);
  head.scale(1, 0.6, 1);
  head.translate(0, 0.04, 0);
  add(head, 0xe2c04a);
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: lotus flower");
  return merged;
}

/** Floating lotus lantern: wooden base, warm golden-pink petals and a bright candle core. */
function lanternGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number): void => {
    const c = new Color(color);
    const n = g.getAttribute("position").count;
    g.setAttribute("color", new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3] ?? 1), 3));
    parts.push(g);
  };
  const base = new SphereGeometry(0.14, 12, 6);
  base.scale(1, 0.16, 1);
  add(base, 0x4a2e1b);

  const ring = (count: number, len: number, tilt: number, color: number, phase: number): void => {
    for (let i = 0; i < count; i++) {
      const g = new SphereGeometry(1, 8, 6);
      g.scale(0.048, 0.024, len);
      g.translate(0, 0.01, len * 0.85);
      g.rotateX(-tilt);
      g.rotateY((i / count) * Math.PI * 2 + phase);
      add(g, color);
    }
  };
  ring(8, 0.11, 0.42, 0xf59e6c, 0);
  ring(8, 0.085, 0.88, 0xffd98e, Math.PI / 8);

  const flame = new SphereGeometry(0.048, 10, 8);
  flame.scale(1, 1.45, 1);
  flame.translate(0, 0.065, 0);
  add(flame, 0xfff6d6);

  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: lotus lantern");
  return merged;
}

interface DriftingLantern {
  active: boolean;
  angle: number;
  radius: number;
  speed: number;
  phase: number;
}

export interface Pond {
  /** Releases a glowing lotus lantern onto the pond water. */
  releaseLantern(): void;
  update(t: number, daylight: number): void;
  dispose(): void;
}

/**
 * Ellipse of water (stack §2: onBeforeCompile ripples, sky-tinted fresnel, lantern glints at night),
 * a stone bank, lotus leaves and three flowers.
 * `sky` is a live colour (the fog colour) that the surface reflects.
 */
export function createPond(group: Group, materials: Materials, sky: Color): Pond {
  const rand = seeded(0x90d);
  const uniforms = { uTime: { value: 0 }, uSky: { value: sky }, uNight: { value: 0 } };

  const waterGeo = new CircleGeometry(1, 72);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new MeshStandardMaterial({ color: 0x14292b, roughness: 0.1, metalness: 0 });
  waterMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec3 uSky;\nuniform float uNight;\nvarying vec3 vWaterPos;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec2 wp = vWaterPos.xz;
        vec2 slope = vec2(0.05 * cos(wp.x * 1.3 + uTime * 0.9), 0.05 * cos(wp.y * 1.7 - uTime * 0.7));
        slope += 0.03 * cos((wp.x + wp.y) * 2.6 + uTime * 1.6);
        normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        outgoingLight = mix(outgoingLight, uSky * 0.55, 0.12 + 0.45 * fres);
        // Sparse glints: a random few cells, each with a jittered spot twinkling at its own rate (sines alone tile into a grid).
        vec2 gc = wp * 2.2 + slope * 6.0;
        vec2 cell = floor(gc);
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 jit = vec2(h, fract(h * 7.31)) * 0.6 + 0.2;
        float tw = 0.5 + 0.5 * sin(uTime * (1.3 + 2.0 * h) + h * 40.0);
        float glint = step(0.82, h) * smoothstep(0.1, 0.0, length(fract(gc) - jit)) * tw * tw;
        outgoingLight += vec3(1.0, 0.78, 0.45) * glint * uNight * 1.6;
        #include <opaque_fragment>`,
      );
  };
  const water = new Mesh(waterGeo, waterMat);
  water.position.set(POND.x, WATER_Y, POND.z);
  water.scale.set(POND.rx, 1, POND.rz);
  water.receiveShadow = true;
  water.name = "pond-water";

  // Bank: the ring is built on a unit circle, then stretched to the ellipse.
  const bankGeo = new RingGeometry(0.98, BANK_OUTER, 72, 1);
  bankGeo.rotateX(-Math.PI / 2);
  const bankMat = new MeshStandardMaterial({
    map: materials.stone.map,
    normalMap: materials.stone.normalMap,
    roughnessMap: materials.stone.roughnessMap,
    color: 0x8f897c,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const bank = new Mesh(bankGeo, bankMat);
  bank.position.set(POND.x, WATER_Y + 0.02, POND.z);
  bank.scale.set(POND.rx, 1, POND.rz);
  bank.receiveShadow = true;
  bank.name = "pond-bank";

  // Leaves: notched discs floating on the water, near the flowers and scattered.
  const leafGeo = new CircleGeometry(1, 20, 0.25, Math.PI * 2 - 0.5);
  leafGeo.rotateX(-Math.PI / 2);
  const leafMat = new MeshStandardMaterial({ color: 0x3e5d2c, roughness: 0.6, side: DoubleSide });
  const leaves = new InstancedMesh(leafGeo, leafMat, LEAF_COUNT);
  for (let i = 0; i < LEAF_COUNT; i++) {
    const f = LOTUS_FLOWERS[i % LOTUS_FLOWERS.length];
    let x: number;
    let z: number;
    if (f && i < LOTUS_FLOWERS.length * 3) {
      x = f.x + (rand() - 0.5) * 2.2;
      z = f.z + (rand() - 0.5) * 2.2;
    } else {
      // Anywhere inside 75% of the ellipse.
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.75;
      x = POND.x + Math.cos(a) * POND.rx * r;
      z = POND.z + Math.sin(a) * POND.rz * r;
    }
    const s = 0.35 + rand() * 0.35;
    leaves.setMatrixAt(i, m4.compose(v3.set(x, WATER_Y + 0.015 + i * 0.0005, z), q.setFromAxisAngle(Y, rand() * Math.PI * 2), s3.set(s, 1, s)));
  }
  leaves.receiveShadow = true;
  leaves.name = "lotus-leaves";

  const flowerGeo = flowerGeometry();
  const flowerMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const flowers = new InstancedMesh(flowerGeo, flowerMat, LOTUS_FLOWERS.length);
  LOTUS_FLOWERS.forEach((f, i) => {
    flowers.setMatrixAt(i, m4.compose(v3.set(f.x, WATER_Y + 0.05, f.z), q.setFromAxisAngle(Y, rand() * Math.PI), s3.setScalar(FLOWER_SCALE)));
  });
  flowers.castShadow = true;
  flowers.name = "lotus-flowers";

  // Floating lotus lanterns (Hoa đăng) drifting gently on the pond surface.
  const lanternGeo = lanternGeometry();
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    emissive: new Color(0xffae42),
    emissiveIntensity: 0.85,
  });
  const lanterns = new InstancedMesh(lanternGeo, lanternMat, MAX_LANTERNS);
  lanterns.frustumCulled = false;
  lanterns.name = "lotus-lanterns";

  const states: DriftingLantern[] = Array.from({ length: MAX_LANTERNS }, (_, i) => ({
    active: i < INITIAL_LANTERNS,
    angle: (i / INITIAL_LANTERNS) * Math.PI * 2 + rand() * 0.5,
    radius: 0.28 + rand() * 0.38,
    speed: 0.035 + rand() * 0.025,
    phase: rand() * Math.PI * 2,
  }));
  let nextSlot = INITIAL_LANTERNS % MAX_LANTERNS;

  const updateLanternMatrices = (t: number): void => {
    for (let i = 0; i < MAX_LANTERNS; i++) {
      const st = states[i]!;
      if (!st.active) {
        lanterns.setMatrixAt(i, m4.compose(v3.set(POND.x, WATER_Y - 1, POND.z), q.identity(), s3.setScalar(0)));
        continue;
      }
      const a = st.angle + t * st.speed;
      const r = st.radius + 0.04 * Math.sin(t * 0.25 + st.phase);
      const x = POND.x + Math.cos(a) * POND.rx * r;
      const z = POND.z + Math.sin(a) * POND.rz * r;
      const y = WATER_Y + 0.04 + 0.008 * Math.sin(t * 2.2 + st.phase);
      const yaw = a + Math.PI * 0.5 + 0.2 * Math.sin(t * 0.8 + st.phase);
      lanterns.setMatrixAt(i, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(Y, yaw), s3.setScalar(LANTERN_SCALE)));
    }
    lanterns.instanceMatrix.needsUpdate = true;
  };
  updateLanternMatrices(0);

  for (const o of [water, bank, leaves, flowers, lanterns]) {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    group.add(o);
  }
  leaves.computeBoundingSphere();
  flowers.computeBoundingSphere();

  registerCameraPreset("pond", { position: [POND.x - 12, 4.5, POND.z + 14], target: [POND.x, 0, POND.z] });

  return {
    releaseLantern() {
      const st = states[nextSlot]!;
      st.active = true;
      // Spawn near the western bank (closest to the temple courtyard) and drift across the water.
      st.angle = Math.PI + (Math.random() - 0.5) * 0.8;
      st.radius = 0.45 + Math.random() * 0.28;
      st.speed = 0.04 + Math.random() * 0.025;
      st.phase = Math.random() * Math.PI * 2;
      nextSlot = (nextSlot + 1) % MAX_LANTERNS;
      updateLanternMatrices(uniforms.uTime.value);
    },
    update(t, daylight) {
      uniforms.uTime.value = t;
      const night = 1 - daylight;
      uniforms.uNight.value = night;
      lanternMat.emissiveIntensity = 0.7 + night * 1.6 + 0.12 * Math.sin(t * 3.1);
      updateLanternMatrices(t);
    },
    dispose() {
      for (const o of [water, bank, leaves, flowers, lanterns]) group.remove(o);
      leaves.dispose();
      flowers.dispose();
      lanterns.dispose();
      for (const g of [waterGeo, bankGeo, leafGeo, flowerGeo, lanternGeo]) g.dispose();
      for (const m of [waterMat, bankMat, leafMat, flowerMat, lanternMat]) m.dispose();
    },
  };
}
