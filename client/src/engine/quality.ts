import type { WebGLRenderer } from "three";
import { basePixelRatio } from "./renderer.ts";
import type { FrameStats } from "./frame-stats.ts";

/** Pixel-ratio caps, stepped down one at a time while frames stay slow, and stepped back up when smooth. */
const CAPS = [Number.POSITIVE_INFINITY, 1.5, 1.25, 1.0] as const;
const WARMUP_S = 5.0;
const WINDOW_S = 3.5;
const SLOW_P95_MS = 28;
const FAST_P95_MS = 15.5;

export class Quality {
  private level = 0;
  private warmup = 0;
  private elapsed = 0;
  private frames = 0;
  private fastStreak = 0;

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
    if (this.fixedRatio !== null) return;
    if (this.warmup < WARMUP_S) {
      this.warmup += dt;
      return;
    }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < WINDOW_S) return;

    const p95 = this.stats.summary(this.frames).p95;
    this.elapsed = 0;
    this.frames = 0;

    if (p95 > SLOW_P95_MS) {
      this.fastStreak = 0;
      if (this.level < CAPS.length - 1) {
        this.level++;
        this.apply();
      }
      return;
    }

    if (p95 > 0 && p95 < FAST_P95_MS && this.level > 0) {
      this.fastStreak++;
      if (this.fastStreak >= 2) {
        this.fastStreak = 0;
        this.level--;
        this.apply();
      }
    } else {
      this.fastStreak = 0;
    }
  };
}
