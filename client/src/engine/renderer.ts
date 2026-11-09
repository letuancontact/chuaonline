import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from "three";

export type QualityTier = "low" | "medium" | "high" | "ultra";

function detectTier(): QualityTier {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 768;
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const isMobile = smallScreen || coarsePointer;

  if (isMobile) {
    if (cores <= 4 || mem <= 3) return "low";
    if (cores >= 8 && mem >= 6) return "high";
    return "medium";
  }
  if (cores <= 4 && mem <= 4) return "medium";
  if (cores >= 8 && mem >= 8) return "ultra";
  return "high";
}

export const QUALITY_TIER: QualityTier = detectTier();

export const SHADOW_MAP_SIZE = QUALITY_TIER === "ultra" || QUALITY_TIER === "high" ? 2048 : 1024;

let hwMaxAnisotropy = 8;

/** Optimal anisotropic filtering level for sharp oblique ground, stone, wood, and foliage textures. */
export function maxAnisotropy(): number {
  const tierCap = QUALITY_TIER === "low" ? 2 : QUALITY_TIER === "medium" ? 4 : 8;
  return Math.min(hwMaxAnisotropy, tierCap);
}

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

/** Pixel ratio before any adaptive quality drop: balanced by hardware tier for crisp edges without fill-rate overload. */
export function basePixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  switch (QUALITY_TIER) {
    case "ultra":
      return Math.min(dpr, 2.0);
    case "high":
      return Math.min(dpr, window.innerWidth < 700 ? 1.65 : 1.85);
    case "medium":
      return Math.min(dpr, 1.5);
    case "low":
      return Math.min(dpr, 1.25);
  }
}

export interface RendererOptions {
  shadows: boolean;
  onContextLost: () => void;
}

export function createRenderer(opts: RendererOptions): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  hwMaxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(basePixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.className = "scene-canvas";
  renderer.domElement.addEventListener("webglcontextlost", opts.onContextLost, { once: true });
  return renderer;
}
