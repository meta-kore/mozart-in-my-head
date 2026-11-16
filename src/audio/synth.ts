import type { VoiceName } from '../music/fugue.js';

/** One oscillator layer of a voice's timbre. */
interface Partial {
  type: OscillatorType;
  /** Frequency multiple of the note's pitch (2 = an octave up). */
  ratio: number;
  /** Detune in cents, for a gentle chorus between layers. */
  detune: number;
  gain: number;
}

export interface Timbre {
  partials: Partial[];
  /** Low-pass cutoff as a multiple of the note's frequency, clamped below. */
  cutoffRatio: number;
  minCutoff: number;
  maxCutoff: number;
  q: number;
  attack: number;
  release: number;
  /** Peak level of one note before the voice gain. */
  level: number;
}

/**
 * Soft organ-like colours, one per voice, so each stays recognisable on its
 * own and they still blend as a whole.
 */
export const TIMBRES: Record<VoiceName, Timbre> = {
  // Clear and flute-like.
  soprano: {
    partials: [
      { type: 'triangle', ratio: 1, detune: 0, gain: 0.7 },
      { type: 'sine', ratio: 2, detune: 4, gain: 0.25 },
      { type: 'sine', ratio: 1, detune: -6, gain: 0.3 },
    ],
    cutoffRatio: 6,
    minCutoff: 1800,
    maxCutoff: 7000,
    q: 0.5,
    attack: 0.02,
    release: 0.12,
    level: 0.16,
  },
  // Warm and reedy.
  alto: {
    partials: [
      { type: 'sawtooth', ratio: 1, detune: -5, gain: 0.45 },
      { type: 'sawtooth', ratio: 1, detune: 5, gain: 0.45 },
      { type: 'sine', ratio: 1, detune: 0, gain: 0.4 },
    ],
    cutoffRatio: 3,
    minCutoff: 900,
    maxCutoff: 3500,
    q: 0.8,
    attack: 0.025,
    release: 0.12,
    level: 0.13,
  },
  // Hollow, clarinet-like.
  tenor: {
    partials: [
      { type: 'square', ratio: 1, detune: -4, gain: 0.4 },
      { type: 'square', ratio: 1, detune: 4, gain: 0.4 },
      { type: 'sine', ratio: 2, detune: 0, gain: 0.15 },
    ],
    cutoffRatio: 3.5,
    minCutoff: 700,
    maxCutoff: 2800,
    q: 0.7,
    attack: 0.03,
    release: 0.14,
    level: 0.12,
  },
  // Round, with a soft octave-down foundation like an organ pedal.
  bass: {
    partials: [
      { type: 'sawtooth', ratio: 1, detune: -3, gain: 0.4 },
      { type: 'sine', ratio: 1, detune: 3, gain: 0.6 },
      { type: 'sine', ratio: 0.5, detune: 0, gain: 0.35 },
    ],
    cutoffRatio: 4,
    minCutoff: 400,
    maxCutoff: 1800,
    q: 0.6,
    attack: 0.035,
    release: 0.16,
    level: 0.2,
  },
};

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Plays notes in one voice's timbre into `output`. Each note builds its own
 * short-lived nodes, which disconnect themselves when they finish.
 */
export class VoiceSynth {
  constructor(
    private readonly ctx: AudioContext,
    private readonly output: AudioNode,
    private readonly timbre: Timbre,
  ) {}

  /** Schedule a note. `start` and `end` are AudioContext times in seconds. */
  play(midi: number, start: number, end: number): void {
    const { ctx, timbre } = this;
    const freq = midiToFrequency(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(
      timbre.maxCutoff,
      Math.max(timbre.minCutoff, freq * timbre.cutoffRatio),
    );
    filter.Q.value = timbre.q;

    const env = ctx.createGain();
    const attackEnd = Math.min(start + timbre.attack, end);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(timbre.level, attackEnd);
    // A slight settle after the attack keeps long notes from sounding static.
    env.gain.setTargetAtTime(timbre.level * 0.85, attackEnd, 0.3);
    // Release: each setTargetAtTime starts from wherever the previous left off.
    env.gain.setTargetAtTime(0, end, timbre.release / 4);

    filter.connect(env);
    env.connect(this.output);

    const stopAt = end + timbre.release * 1.5;
    const oscillators = timbre.partials.map((p) => {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      osc.frequency.value = freq * p.ratio;
      osc.detune.value = p.detune;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      osc.connect(g);
      g.connect(filter);
      osc.start(start);
      osc.stop(stopAt);
      return { osc, g };
    });

    oscillators[0].osc.onended = () => {
      for (const { osc, g } of oscillators) {
        osc.disconnect();
        g.disconnect();
      }
      filter.disconnect();
      env.disconnect();
    };
  }
}
