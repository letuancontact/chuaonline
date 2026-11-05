// One-shot effects: oscillators / noise with short envelopes, sent dry + through a generated reverb.

const REVERB_SECONDS = 2.6;
const REVERB_DECAY = 3;
/** Bell partials (ratios of a small temple bell) and their relative levels. */
const BELL_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2.76, 0.45],
  [5.4, 0.22],
  [8.93, 0.1],
];
const BELL_HZ = 880;
const BELL_SECONDS = 3.2;

/** Exponentially decaying stereo noise: a plausible small hall, nothing to download. */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, REVERB_DECAY);
  }
  return buf;
}

export class Sfx {
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly noise: AudioBuffer;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.45;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx);
    this.dry.connect(out);
    this.dry.connect(this.reverb).connect(this.wet).connect(out);
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Small bell: inharmonic sine partials, fast strike, long decay. */
  bell(): void {
    const t = this.ctx.currentTime + 0.01;
    for (const [ratio, level] of BELL_PARTIALS) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = BELL_HZ * ratio;
      const g = this.ctx.createGain();
      const dur = BELL_SECONDS / Math.sqrt(ratio);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35 * level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      this.play(osc, g, t, dur);
    }
  }

  /** Bead "tách": a tiny filtered noise click plus a wooden knock. */
  bead(): void {
    const t = this.ctx.currentTime + 0.005;
    this.noiseBurst(t, 2600, 4, 0.5, 0.025);
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.04);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    this.play(osc, g, t, 0.07);
  }

  /** Chắp tay: two soft muffled palm touches. */
  hello(): void {
    const t = this.ctx.currentTime + 0.005;
    this.noiseBurst(t, 900, 0.9, 0.35, 0.09);
    this.noiseBurst(t + 0.07, 700, 0.9, 0.2, 0.12);
  }

  dispose(): void {
    this.dry.disconnect();
    this.reverb.disconnect();
    this.wet.disconnect();
  }

  private noiseBurst(t: number, hz: number, q: number, level: number, dur: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = hz;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    this.play(src, g, t, dur, f);
  }

  /** Wires `src → (via) → env → dry`, starts / stops it and unhooks it when done. */
  private play(src: AudioScheduledSourceNode, env: GainNode, t: number, dur: number, via?: AudioNode): void {
    (via ?? src).connect(env).connect(this.dry);
    src.start(t);
    src.stop(t + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      via?.disconnect();
      env.disconnect();
    };
  }
}
