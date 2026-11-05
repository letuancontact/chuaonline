import { Mesh, MeshStandardMaterial, PlaneGeometry, type Scene } from "three";
import { BOUNDARY } from "@santinh/shared";
import type { Assets } from "./assets.ts";

/** Edges sit past the day fog's far distance, so the ground melts into haze instead of ending in a line. */
const SIZE = 420;
/** One texture tile per ~3.7 m: close enough to read as mud and leaves. */
const REPEAT = Math.round(SIZE / 3.7);
/** A second, much larger sample of the same map breaks up the visible tiling grid. */
const MACRO_SCALE = 0.123;
const MACRO_AMOUNT = 0.45;

export interface Ground {
  readonly mesh: Mesh;
  dispose(): void;
}

export async function createGround(scene: Scene, assets: Assets): Promise<Ground> {
  const [map, normalMap, roughnessMap] = await Promise.all([
    assets.texture("materials/ground/color.jpg", { srgb: true, repeat: REPEAT }),
    assets.texture("materials/ground/normal.jpg", { repeat: REPEAT }),
    assets.texture("materials/ground/roughness.jpg", { repeat: REPEAT }),
  ]);
  for (const tex of [map, normalMap, roughnessMap]) tex.anisotropy = 4;

  const geometry = new PlaneGeometry(SIZE, SIZE);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec3 macroTint = texture2D(map, vMapUv * ${MACRO_SCALE}).rgb;
      diffuseColor.rgb *= mix(vec3(1.0), macroTint * 2.2, ${MACRO_AMOUNT});`,
    );
  };
  const mesh = new Mesh(geometry, material);
  mesh.position.set(BOUNDARY.x, 0, BOUNDARY.z);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);

  return {
    mesh,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
