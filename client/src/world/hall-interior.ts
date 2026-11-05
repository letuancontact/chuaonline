import type {
  Group} from "three";
import {
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
  type Material,
  type Scene,
} from "three";
import { ALTAR, CUSHION_COUNT, HALL, cushionPosition } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import type { Assets } from "./assets.ts";
import { WALL_TOP } from "./hall-exterior.ts";
import type { MaterialKey, Materials } from "./materials.ts";
import { GeometryBatch, disposeGroupGeometry } from "./merge.ts";
import { drawMural } from "./mural.ts";

// Proportions from the source hall (stack §2): 5.35 m Buddha, 16.8 × 8.4 m mural, face centred in the halo.
const BUDDHA_HEIGHT = 5.35;
/** Face centre as a fraction of the scan's height (seated figure, measured on the model). */
const BUDDHA_FACE = 0.83;
/** Statue sits a little behind ALTAR.z so its knees clear the offering table inside the altar footprint. */
const BUDDHA_Z = ALTAR.z - 0.5;
const MURAL_W = 16.8;
const MURAL_H = 8.4;
const MURAL_BOTTOM = HALL.floorY + 0.7;
const MURAL_Z = HALL.zMin + 0.17;
const PEDESTAL_TOP = HALL.floorY + 0.7;
const LOTUS_H = 0.5;
const TABLE = { xMin: ALTAR.xMin, xMax: ALTAR.xMax, z0: ALTAR.zMax - 0.6, z1: ALTAR.zMax, top: HALL.floorY + 1.0 };
const CEILING_Y = WALL_TOP;
const CANDLES = 8;
const LANTERN_ROWS = [-9, -3, 3, 9] as const;
const LANTERN_COLS = [-10, -6, -2, 2, 6, 10] as const;
const LANTERN_Y = CEILING_Y - 2.6;
/** Lantern glow and hall point lights: dim by day, warm at night. */
const GLOW_DAY = 0.5;
const GLOW_NIGHT = 2.4;

type Key = MaterialKey | "gold" | "lacquer" | "cushion" | "candle";

const m4 = new Matrix4();
const dummy = new Object3D();

function box(batch: GeometryBatch<Key>, key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile });
  g.dispose();
}

export interface HallInterior {
  readonly group: Group;
  update(dt: number, t: number, daylight: number): void;
  dispose(): void;
}

export async function createHallInterior(scene: Scene, assets: Assets, materials: Materials): Promise<HallInterior> {
  const buddha = await assets.model("models/buddha.glb");

  const owned: Material[] = [];
  const own = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const gold = own(new MeshStandardMaterial({ color: 0xc08a3e, roughness: 0.45, metalness: 0.25 }));
  const lacquer = own(new MeshStandardMaterial({ map: materials.wood.map, normalMap: materials.wood.normalMap, color: 0x3a1a12, roughness: 0.5 }));
  const cushion = own(
    new MeshStandardMaterial({ map: materials.cloth.map, normalMap: materials.cloth.normalMap, roughnessMap: materials.cloth.roughnessMap, color: 0x8c2e24 }),
  );
  const candle = own(new MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.7 }));

  const batch = new GeometryBatch<Key>();
  const fy = HALL.floorY;

  // Ceiling slab with cross beams.
  box(batch, "wood", HALL.xMin, HALL.xMax, CEILING_Y, CEILING_Y + 0.2, HALL.zMin, HALL.zMax, 2);
  for (let z = HALL.zMin + 4; z < HALL.zMax; z += 4) box(batch, "darkWood", HALL.xMin, HALL.xMax, CEILING_Y - 0.36, CEILING_Y, z - 0.16, z + 0.16, 1.5);
  for (const x of [-7, 0, 7]) box(batch, "darkWood", x - 0.14, x + 0.14, CEILING_Y - 0.28, CEILING_Y, HALL.zMin, HALL.zMax, 1.5);

  // Mural frame.
  const fx0 = -MURAL_W / 2 - 0.3;
  const fx1 = MURAL_W / 2 + 0.3;
  const fz0 = MURAL_Z - 0.02;
  const fz1 = MURAL_Z + 0.18;
  box(batch, "darkWood", fx0, fx1, MURAL_BOTTOM - 0.3, MURAL_BOTTOM, fz0, fz1, 1);
  box(batch, "darkWood", fx0, fx1, MURAL_BOTTOM + MURAL_H, MURAL_BOTTOM + MURAL_H + 0.3, fz0, fz1, 1);
  box(batch, "darkWood", fx0, fx0 + 0.3, MURAL_BOTTOM, MURAL_BOTTOM + MURAL_H, fz0, fz1, 1);
  box(batch, "darkWood", fx1 - 0.3, fx1, MURAL_BOTTOM, MURAL_BOTTOM + MURAL_H, fz0, fz1, 1);

  // Stone pedestal + gilded lotus base.
  const bbox = new Box3().setFromObject(buddha.scene);
  const size = bbox.getSize(new Vector3());
  const scale = BUDDHA_HEIGHT / size.y;
  const halfW = (size.x * scale) / 2 + 0.4;
  const halfD = (size.z * scale) / 2 + 0.3;
  box(batch, "stone", -halfW, halfW, fy, PEDESTAL_TOP, BUDDHA_Z - halfD, BUDDHA_Z + halfD, 1.2);
  const lotus = new CylinderGeometry(halfW * 0.92, halfW * 0.8, LOTUS_H, 28);
  batch.add("gold", lotus, m4.makeTranslation(0, PEDESTAL_TOP + LOTUS_H / 2, BUDDHA_Z), { uvScale: [4, 1] });
  lotus.dispose();

  // Offering table across the front of the altar.
  box(batch, "lacquer", TABLE.xMin, TABLE.xMax, TABLE.top - 0.12, TABLE.top, TABLE.z0, TABLE.z1, 1);
  for (const x of [TABLE.xMin + 0.2, TABLE.xMax - 0.2]) {
    for (const z of [TABLE.z0 + 0.12, TABLE.z1 - 0.12]) box(batch, "lacquer", x - 0.08, x + 0.08, fy, TABLE.top - 0.12, z - 0.08, z + 0.08, 1);
  }

  // Candle bodies on the table.
  const candleXs = Array.from({ length: CANDLES }, (_, i) => TABLE.xMin + 0.7 + (i * (TABLE.xMax - TABLE.xMin - 1.4)) / (CANDLES - 1));
  const candleZ = (TABLE.z0 + TABLE.z1) / 2;
  const candleGeo = new CylinderGeometry(0.06, 0.07, 0.34, 12);
  for (const x of candleXs) batch.add("candle", candleGeo, m4.makeTranslation(x, TABLE.top + 0.17, candleZ), { castShadow: false });
  candleGeo.dispose();

  const group = batch.build("hall-interior", { ...materials, gold, lacquer, cushion, candle });

  // Mural plane.
  const faceY = PEDESTAL_TOP + LOTUS_H + BUDDHA_HEIGHT * BUDDHA_FACE;
  // Seen from the cushions the face projects slightly higher on the wall behind it.
  const haloY = faceY + 0.35;
  const muralTex = drawMural(2048, 1024, { x: 0.5, y: 1 - (haloY - MURAL_BOTTOM) / MURAL_H, r: 0.27 });
  const muralMat = own(new MeshStandardMaterial({ map: muralTex, roughness: 0.85, emissiveMap: muralTex, emissive: new Color(0x2a1408) }));
  const muralGeo = new PlaneGeometry(MURAL_W, MURAL_H);
  const mural = new Mesh(muralGeo, muralMat);
  mural.position.set(0, MURAL_BOTTOM + MURAL_H / 2, MURAL_Z);
  mural.receiveShadow = true;
  mural.name = "mural";
  group.add(mural);

  // Buddha, base on the lotus, facing +Z (towards the door).
  const statue = buddha.scene;
  statue.scale.setScalar(scale);
  statue.position.set(-((bbox.min.x + bbox.max.x) / 2) * scale, PEDESTAL_TOP + LOTUS_H - bbox.min.y * scale, BUDDHA_Z - ((bbox.min.z + bbox.max.z) / 2) * scale);
  statue.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material as MeshStandardMaterial;
      // Gilt bronze: a little sheen and warmth so it reads gold under the spots.
      m.roughness = 0.55;
      m.metalness = 0.15;
      m.emissive = new Color(0x1a0f04);
    }
  });
  statue.name = "buddha";
  group.add(statue);

  // Flames: instanced, flickering in the vertex shader.
  const flameGeo = new SphereGeometry(0.05, 8, 6);
  flameGeo.scale(1, 2.2, 1);
  const flameMat = own(new MeshBasicMaterial({ color: 0xffc46a, fog: false }));
  const flameTime = { value: 0 };
  flameMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = flameTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float id = float(gl_InstanceID);
        float f = 0.85 + 0.15 * sin(uTime * 9.0 + id * 1.7) * sin(uTime * 5.3 + id * 0.9);
        transformed.y *= f;
        transformed.xz *= 2.0 - f;`,
      );
  };
  const flames = new InstancedMesh(flameGeo, flameMat, CANDLES);
  candleXs.forEach((x, i) => {
    dummy.position.set(x, TABLE.top + 0.42, candleZ);
    dummy.updateMatrix();
    flames.setMatrixAt(i, dummy.matrix);
  });
  flames.name = "candle-flames";
  group.add(flames);

  // Hanji lanterns hanging from the ceiling.
  const lanternGeo = new SphereGeometry(0.42, 16, 12);
  lanternGeo.scale(1, 1.25, 1);
  const lanternMat = own(new MeshStandardMaterial({ color: 0xf4e8cc, roughness: 0.9, emissive: 0xffcf8a, emissiveIntensity: GLOW_DAY }));
  const cordGeo = new CylinderGeometry(0.012, 0.012, CEILING_Y - LANTERN_Y, 4);
  const cordMat = own(new MeshStandardMaterial({ color: 0x2a1c14 }));
  const count = LANTERN_ROWS.length * LANTERN_COLS.length;
  const lanterns = new InstancedMesh(lanternGeo, lanternMat, count);
  const cords = new InstancedMesh(cordGeo, cordMat, count);
  let k = 0;
  for (const z of LANTERN_ROWS) for (const x of LANTERN_COLS) {
    dummy.position.set(x, LANTERN_Y, z);
    dummy.updateMatrix();
    lanterns.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, (CEILING_Y + LANTERN_Y) / 2, z);
    dummy.updateMatrix();
    cords.setMatrixAt(k, dummy.matrix);
    k++;
  }
  lanterns.name = "lanterns";
  cords.name = "lantern-cords";
  group.add(lanterns, cords);

  // 30 cushions on the cushionPosition grid.
  const cushionGeo = new CylinderGeometry(0.46, 0.5, 0.14, 24);
  const cushions = new InstancedMesh(cushionGeo, cushion, CUSHION_COUNT);
  for (let i = 0; i < CUSHION_COUNT; i++) {
    const c = cushionPosition(i);
    dummy.position.set(c.x, fy + 0.07, c.z);
    dummy.rotation.set(0, c.yaw, 0);
    dummy.updateMatrix();
    cushions.setMatrixAt(i, dummy.matrix);
  }
  dummy.rotation.set(0, 0, 0);
  cushions.receiveShadow = true;
  cushions.name = "cushions";
  group.add(cushions);

  // Lights: two warm spots on the statue (no shadows, cheap), a few warm fills that grow at night.
  const faceTarget = new Object3D();
  faceTarget.position.set(0, faceY - 0.6, BUDDHA_Z);
  group.add(faceTarget);
  const spots: SpotLight[] = [];
  for (const x of [-4.5, 4.5]) {
    const spot = new SpotLight(0xffc98a, 140, 0, 0.42, 0.65, 2);
    spot.position.set(x, CEILING_Y - 0.6, BUDDHA_Z + 8);
    spot.target = faceTarget;
    spot.castShadow = false;
    spots.push(spot);
    group.add(spot);
  }
  const fills: PointLight[] = [];
  for (const z of [-11, -2, 7]) {
    const p = new PointLight(0xffc27a, 4, 16, 2);
    p.position.set(0, LANTERN_Y - 0.6, z);
    fills.push(p);
    group.add(p);
  }

  group.updateMatrixWorld(true);
  scene.add(group);

  registerCameraPreset("altar", { position: [0, 2.6, 3], target: [0, faceY - 0.8, BUDDHA_Z] });

  return {
    group,
    update(_dt, t, daylight) {
      flameTime.value = t;
      const night = 1 - daylight;
      lanternMat.emissiveIntensity = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * night;
      for (const p of fills) p.intensity = 4 + 26 * night;
    },
    dispose() {
      scene.remove(group);
      // The GLB's own material and textures are not shared with anything else.
      statue.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const m = o.material as MeshStandardMaterial;
        m.map?.dispose();
        m.normalMap?.dispose();
        m.dispose();
      });
      disposeGroupGeometry(group);
      for (const m of owned) m.dispose();
      muralTex.dispose();
      for (const s of spots) s.dispose();
      for (const p of fills) p.dispose();
    },
  };
}
