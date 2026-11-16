import type { Piece, VoiceName } from '../music/fugue.js';

export interface NoteEvent {
  voice: VoiceName;
  midi: number;
  /** AudioContext time of the onset, in seconds. */
  time: number;
  duration: number;
}

export interface SchedulerOptions {
  /** How far ahead of the audio clock notes are scheduled, in seconds. */
  lookahead?: number;
  /** How often the scheduler wakes, in milliseconds. */
  tickMs?: number;
  /** Silence after the final chord before the piece starts again, in beats. */
  loopGapBeats?: number;
  /** Shortens each note slightly so repeated pitches articulate. */
  legato?: number;
}

const VOICES: VoiceName[] = ['soprano', 'alto', 'tenor', 'bass'];

/**
 * Look-ahead scheduler: a timer wakes every `tickMs` and schedules every note
 * that starts within the next `lookahead` seconds of the AudioContext clock.
 * All voices read one clock, so they cannot drift apart, and the timer's own
 * jitter never reaches the audio.
 */
export class Scheduler {
  private readonly lookahead: number;
  private readonly tickMs: number;
  private readonly legato: number;
  private readonly loopBeats: number;
  private readonly secondsPerBeat: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  /** AudioContext time at which the current pass of the piece began. */
  private passStart = 0;
  /** Next note index to schedule, per voice. */
  private cursor: Record<VoiceName, number> = { soprano: 0, alto: 0, tenor: 0, bass: 0 };

  constructor(
    private readonly ctx: AudioContext,
    private readonly piece: Piece,
    private readonly onNote: (e: NoteEvent) => void,
    options: SchedulerOptions = {},
  ) {
    this.lookahead = options.lookahead ?? 0.1;
    this.tickMs = options.tickMs ?? 25;
    this.legato = options.legato ?? 0.94;
    this.loopBeats = piece.lengthBeats + (options.loopGapBeats ?? 2);
    this.secondsPerBeat = 60 / piece.tempo;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Length of one pass including the gap, in seconds. */
  get loopSeconds(): number {
    return this.loopBeats * this.secondsPerBeat;
  }

  /** Current position in the piece, in beats, or null when stopped. */
  positionBeats(): number | null {
    if (!this.running) return null;
    const beats = (this.ctx.currentTime - this.passStart) / this.secondsPerBeat;
    return ((beats % this.loopBeats) + this.loopBeats) % this.loopBeats;
  }

  /** Start from the beginning, a little after now so the first notes are not late. */
  start(): void {
    this.stop();
    this.passStart = this.ctx.currentTime + 0.1;
    this.cursor = { soprano: 0, alto: 0, tenor: 0, bass: 0 };
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const horizon = this.ctx.currentTime + this.lookahead;
    // Loop: once the horizon passes the end of this pass, schedule what is
    // left of it, then begin the next pass exactly loopSeconds later.
    for (;;) {
      const passEnd = this.passStart + this.loopSeconds;
      for (const voice of VOICES) this.scheduleVoice(voice, Math.min(horizon, passEnd));
      if (horizon < passEnd) break;
      this.passStart = passEnd;
      this.cursor = { soprano: 0, alto: 0, tenor: 0, bass: 0 };
    }
  }

  private scheduleVoice(voice: VoiceName, until: number): void {
    const notes = this.piece.voices[voice];
    let i = this.cursor[voice];
    const spb = this.secondsPerBeat;
    while (i < notes.length) {
      const n = notes[i];
      const time = this.passStart + n.start * spb;
      if (time >= until) break;
      // Never schedule into the past (e.g. after a long frame hitch).
      if (time >= this.ctx.currentTime - 0.01) {
        const duration = Math.max(0.03, n.duration * spb * this.legato);
        this.onNote({ voice, midi: n.midi, time, duration });
      }
      i++;
    }
    this.cursor[voice] = i;
  }
}
