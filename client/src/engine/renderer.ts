import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from "three";

export const SHADOW_MAP_SIZE = 1024;

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    // Release the probe context right away: browsers cap live WebGL contexts per page.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/** Pixel ratio before any quality drop: phones get a little less to keep fill-rate down. */
export function basePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.6 : 1.75);
}

export interface RendererOptions {
  shadows: boolean;
  onContextLost: () => void;
}

export function createRenderer(opts: RendererOptions): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "default" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(basePixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.className = "scene-canvas";
  renderer.domElement.addEventListener("webglcontextlost", opts.onContextLost, { once: true });
  return renderer;
}
