import type { Piece, VoiceName } from '../music/fugue.js';
import { type NoteEvent, Scheduler, type SchedulerOptions } from './scheduler.js';
import { TIMBRES, VoiceSynth } from './synth.js';

export const VOICE_NAMES: readonly VoiceName[] = ['soprano', 'alto', 'tenor', 'bass'];

export type Vec3 = { x: number; y: number; z: number };

interface VoiceChain {
  synth: VoiceSynth;
  /** Sum of this voice's notes; the analyser taps here. */
  bus: GainNode;
  /** Volume control for distance and solo, applied after the analyser tap. */
  gain: GainNode;
  panner: PannerNode;
  analyser: AnalyserNode;
  levelBuffer: Float32Array<ArrayBuffer>;
}

/**
 * Plays a piece as four spatialised synth voices.
 *
 * Signal path per voice: notes → bus (analyser tap) → gain → HRTF panner →
 * master gain → compressor → speakers. A second analyser on the master
 * follows the whole mix.
 *
 * Nothing here depends on XR: positions are plain numbers in metres, so the
 * engine can be driven from a desktop page as easily as from a headset.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private voices = new Map<VoiceName, VoiceChain>();
  private master!: GainNode;
  private mixAnalyser!: AnalyserNode;
  private mixBuffer!: Float32Array<ArrayBuffer>;
  private scheduler: Scheduler | null = null;
  private onsets: NoteEvent[] = [];
  private userPaused = false;

  constructor(
    private readonly piece: Piece,
    private readonly schedulerOptions: SchedulerOptions = {},
  ) {}

  /** True once start() has created the audio graph. */
  get started(): boolean {
    return this.ctx !== null;
  }

  /** True while the music is audible (started, not paused). */
  get playing(): boolean {
    return this.ctx?.state === 'running' && !this.userPaused;
  }

  /** The AudioContext, once started. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Create the audio graph and start the piece from the top. Must be called
   * from a user gesture (click, tap, pinch), which browsers require before
   * any sound. Calling it again resumes if paused.
   */
  async start(): Promise<void> {
    if (this.ctx) {
      await this.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(compressor);

    this.mixAnalyser = ctx.createAnalyser();
    this.mixAnalyser.fftSize = 512;
    this.mixBuffer = new Float32Array(this.mixAnalyser.fftSize);
    this.master.connect(this.mixAnalyser);

    for (const name of VOICE_NAMES) {
      const bus = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const gain = ctx.createGain();
      const panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        // Loudness by distance is handled in our own gain, where it can be
        // shaped exactly (full within 30 cm, a floor of 10%). The panner
        // only places the sound.
        distanceModel: 'linear',
        rolloffFactor: 0,
      });
      bus.connect(analyser);
      bus.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
      this.voices.set(name, {
        synth: new VoiceSynth(ctx, bus, TIMBRES[name]),
        bus,
        gain,
        panner,
        analyser,
        levelBuffer: new Float32Array(analyser.fftSize),
      });
    }

    this.scheduler = new Scheduler(
      ctx,
      this.piece,
      (e) => {
        this.voices.get(e.voice)!.synth.play(e.midi, e.time, e.time + e.duration);
        this.onsets.push(e);
      },
      this.schedulerOptions,
    );
    if (ctx.state !== 'running') await ctx.resume();
    this.scheduler.start();
  }

  /** Pause by the user's choice (stays paused until resume()). */
  async pause(): Promise<void> {
    this.userPaused = true;
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    this.userPaused = false;
    await this.ctx?.resume();
  }

  /**
   * Suspend while the page is hidden or the XR session is not visible, and
   * resume afterwards unless the user had paused. Because the scheduler reads
   * the audio clock, which stops while suspended, the music continues exactly
   * where it left off.
   */
  async setAppVisible(visible: boolean): Promise<void> {
    if (!this.ctx) return;
    if (!visible) await this.ctx.suspend();
    else if (!this.userPaused) await this.ctx.resume();
  }

  /** Place one voice in the world, in metres. */
  setVoicePosition(voice: VoiceName, p: Vec3): void {
    const chain = this.voices.get(voice);
    if (!chain || !this.ctx) return;
    const t = this.ctx.currentTime;
    chain.panner.positionX.setValueAtTime(p.x, t);
    chain.panner.positionY.setValueAtTime(p.y, t);
    chain.panner.positionZ.setValueAtTime(p.z, t);
  }

  /** Place all voices together, as one ball. */
  setAllVoicePositions(p: Vec3): void {
    for (const name of VOICE_NAMES) this.setVoicePosition(name, p);
  }

  /** Move the listener: head position plus forward and up unit vectors. */
  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    l.positionX.setValueAtTime(position.x, t);
    l.positionY.setValueAtTime(position.y, t);
    l.positionZ.setValueAtTime(position.z, t);
    l.forwardX.setValueAtTime(forward.x, t);
    l.forwardY.setValueAtTime(forward.y, t);
    l.forwardZ.setValueAtTime(forward.z, t);
    l.upX.setValueAtTime(up.x, t);
    l.upY.setValueAtTime(up.y, t);
    l.upZ.setValueAtTime(up.z, t);
  }

  /** Set a voice's volume (0..1), gliding over `seconds` to avoid clicks. */
  setVoiceGain(voice: VoiceName, value: number, seconds = 0.05): void {
    const chain = this.voices.get(voice);
    if (!chain || !this.ctx) return;
    chain.gain.gain.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.005, seconds / 3));
  }

  /** RMS loudness of one voice before its volume control, roughly 0..0.3. */
  voiceLevel(voice: VoiceName): number {
    const chain = this.voices.get(voice);
    if (!chain) return 0;
    return rms(chain.analyser, chain.levelBuffer);
  }

  /** RMS loudness of the whole mix. */
  mixLevel(): number {
    if (!this.mixAnalyser) return 0;
    return rms(this.mixAnalyser, this.mixBuffer);
  }

  /**
   * Note onsets that have now sounded, oldest first, removed from the queue.
   * Call once per frame to drive per-note visuals.
   */
  takeOnsets(): NoteEvent[] {
    if (!this.ctx || this.onsets.length === 0) return [];
    const now = this.ctx.currentTime;
    let n = 0;
    while (n < this.onsets.length && this.onsets[n].time <= now) n++;
    return n === 0 ? [] : this.onsets.splice(0, n);
  }

  /** Current position in the piece, in beats. */
  positionBeats(): number | null {
    return this.scheduler?.positionBeats() ?? null;
  }
}

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}
