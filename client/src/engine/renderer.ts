import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from "three";

export type QualityTier = "low" | "medium" | "high" | "ultra";

function detectMobile(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 768;
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return smallScreen || coarsePointer || uaMobile;
}

export const IS_MOBILE: boolean = detectMobile();

function detectTier(): QualityTier {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  if (IS_MOBILE) {
    if (cores <= 4 || mem <= 3) return "low";
    if (cores >= 8 && mem >= 6) return "high";
    return "medium";
  }
  if (cores <= 4 || mem <= 4) return "medium";
  if (cores >= 12 && mem >= 8) return "ultra";
  return "high";
}

export const QUALITY_TIER: QualityTier = detectTier();

/**
 * Mobile GPUs and integrated laptop GPUs use a fast 1024 shadow map (paired with texel snapping in environment.ts);
 * only desktop Ultra tier uses 2048 so mobile frame rates stay near 60 FPS.
 */
export const SHADOW_MAP_SIZE = !IS_MOBILE && QUALITY_TIER === "ultra" ? 2048 : 1024;

let hwMaxAnisotropy = 4;

/** Optimal anisotropic filtering level for sharp oblique ground, stone, wood, and foliage textures. */
export function maxAnisotropy(): number {
  const tierCap = IS_MOBILE
    ? QUALITY_TIER === "high"
      ? 4
      : 2
    : QUALITY_TIER === "low"
      ? 2
      : QUALITY_TIER === "medium"
        ? 4
        : 8;
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

/**
 * Pixel ratio before any adaptive quality drop:
 * Phones already have 400+ PPI physical screens, so 1.25–1.35 looks crisp while saving 50%+ GPU fill-rate.
 */
export function basePixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  if (IS_MOBILE) {
    if (QUALITY_TIER === "low") return Math.min(dpr, 1.15);
    if (QUALITY_TIER === "medium") return Math.min(dpr, 1.25);
    return Math.min(dpr, 1.35);
  }
  switch (QUALITY_TIER) {
    case "ultra":
      return Math.min(dpr, 1.75);
    case "high":
      return Math.min(dpr, 1.5);
    case "medium":
      return Math.min(dpr, 1.35);
    case "low":
      return Math.min(dpr, 1.15);
  }
}

export interface RendererOptions {
  shadows: boolean;
  onContextLost: () => void;
}

export function createRenderer(opts: RendererOptions): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: !IS_MOBILE || QUALITY_TIER !== "low",
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
