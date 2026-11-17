import type { StemPlayer, Vec3 } from './stems.js';

/**
 * Small synthesised sound effects for interaction feedback: a soft pluck on
 * grab and release, a shimmer when the whole ball opens, a warm chord when it
 * re-forms, and chimes for a found answer and the finale. Built from a few
 * oscillators per sound, so there are no audio files and nothing to license.
 * They play through the music's master bus, so they follow its volume (and
 * stay silent with ?mute), and they are spatialised at the given position.
 */
export type CueKind = 'grab' | 'release' | 'split' | 'merge' | 'success' | 'finale' | 'solo';

/** G minor / B-flat major pitches (Hz), so the cues sit inside the music. */
const G3 = 196.0;
const D4 = 293.66;
const G4 = 392.0;
const BB4 = 466.16;
const D5 = 587.33;
const F5 = 698.46;
const G5 = 783.99;
const BB5 = 932.33;
const D6 = 1174.66;
const F6 = 1396.91;

/** Per-section pluck pitches, high (violins) to low (cellos and basses). */
const SECTION_PITCH: Record<string, number> = {
  'violins-1': D6,
  'violins-2': BB5,
  'flute-oboes': G5,
  'clarinets-bassoons': D5,
  horns: BB4,
  violas: G4,
  'cellos-basses': D4,
};

export class Cues {
  constructor(private readonly player: StemPlayer) {}

  play(kind: CueKind, at?: Vec3, sectionId?: string): void {
    const ctx = this.player.context;
    const out = this.player.output;
    if (!ctx || !out || ctx.state !== 'running') return;
    const dest = at ? this.panner(ctx, out, at) : out;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case 'grab':
        this.pluck(ctx, dest, t, SECTION_PITCH[sectionId ?? ''] ?? G5, 0.06);
        break;
      case 'release':
        this.pluck(ctx, dest, t, (SECTION_PITCH[sectionId ?? ''] ?? G5) / 2, 0.035);
        break;
      case 'solo':
        this.bell(ctx, dest, t, SECTION_PITCH[sectionId ?? ''] ?? G5, 0.025, 0.9);
        break;
      case 'split': {
        // A rising shimmer of B-flat major over a soft breath of noise.
        [BB4, D5, F5, BB5, D6, F6].forEach((f, i) => this.bell(ctx, dest, t + i * 0.045, f, 0.03, 1.4));
        this.whoosh(ctx, dest, t, 0.5, 400, 3200, 0.05);
        break;
      }
      case 'merge': {
        // Falling into a warm G: the pieces settling back into one.
        [G5, D5, BB4].forEach((f, i) => this.bell(ctx, dest, t + i * 0.06, f, 0.025, 1.0));
        [G3, D4, G4].forEach((f) => this.pad(ctx, dest, t + 0.15, f, 0.035, 1.6));
        this.whoosh(ctx, dest, t, 0.4, 2800, 300, 0.04);
        break;
      }
      case 'success':
        this.bell(ctx, dest, t, D5, 0.05, 1.2);
        this.bell(ctx, dest, t + 0.12, G5, 0.05, 1.6);
        break;
      case 'finale':
        [G4, BB4, D5, G5, BB5, D6].forEach((f, i) => this.bell(ctx, dest, t + i * 0.09, f, 0.04, 2.4));
        [G3, D4].forEach((f) => this.pad(ctx, dest, t, f, 0.04, 3));
        break;
    }
  }

  private panner(ctx: AudioContext, out: AudioNode, at: Vec3): AudioNode {
    const p = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'linear',
      rolloffFactor: 0,
      positionX: at.x,
      positionY: at.y,
      positionZ: at.z,
    });
    p.connect(out);
    // Disconnect once every sound routed here has finished.
    setTimeout(() => p.disconnect(), 4000);
    return p;
  }

  /** A short plucked tone: triangle plus a quiet octave, fast decay. */
  private pluck(ctx: AudioContext, dest: AudioNode, t: number, freq: number, peak: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    g.connect(dest);
    for (const [mult, type, level] of [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.25);
    }
  }

  /** A soft bell: sine with an inharmonic partial, long exponential decay. */
  private bell(ctx: AudioContext, dest: AudioNode, t: number, freq: number, peak: number, decay: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(dest);
    for (const [mult, level] of [
      [1, 1],
      [2.76, 0.18],
      [5.4, 0.05],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  /** A warm sustained tone that swells and fades. */
  private pad(ctx: AudioContext, dest: AudioNode, t: number, freq: number, peak: number, length: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + length * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(g).connect(dest);
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + length + 0.05);
    }
  }

  /** Filtered noise sweeping from one frequency to another: a breath of air. */
  private whoosh(ctx: AudioContext, dest: AudioNode, t: number, length: number, from: number, to: number, peak: number): void {
    const frames = Math.ceil(ctx.sampleRate * length);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + length * 0.4);
    g.gain.linearRampToValueAtTime(0, t + length);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
  }
}
