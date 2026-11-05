import type { WebGLRenderer } from "three";
import { basePixelRatio } from "./renderer.ts";
import type { FrameStats } from "./frame-stats.ts";

/** Pixel-ratio caps, stepped down one at a time while frames stay slow. */
const CAPS = [Number.POSITIVE_INFINITY, 1.25, 1.0] as const;
const WINDOW_S = 3;
const SLOW_P95_MS = 25;

export class Quality {
  private level = 0;
  private elapsed = 0;
  private frames = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly stats: FrameStats,
    /** e2e runs pin the ratio to 1 so screenshots and timings are stable. */
    private readonly fixedRatio: number | null,
  ) {
    this.apply();
  }

  get pixelRatio(): number {
    return this.fixedRatio ?? Math.min(basePixelRatio(), CAPS[this.level] ?? 1);
  }

  /** Re-apply size + ratio (window resize, quality change). */
  apply(): void {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  readonly update = (dt: number): void => {
    if (this.fixedRatio !== null || this.level >= CAPS.length - 1) return;
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < WINDOW_S) return;
    const slow = this.stats.summary(this.frames).p95 > SLOW_P95_MS;
    this.elapsed = 0;
    this.frames = 0;
    if (!slow) return;
    this.level++;
    this.apply();
  };
}
