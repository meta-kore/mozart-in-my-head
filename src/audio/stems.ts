export type Vec3 = { x: number; y: number; z: number };

export interface StemSpec {
  id: string;
  url: string;
}

interface StemChain {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  /** Analyser taps here, before the volume control. */
  bus: GainNode;
  gain: GainNode;
  panner: PannerNode;
  analyser: AnalyserNode;
  levelBuffer: Float32Array<ArrayBuffer>;
}

/**
 * Plays pre-recorded, time-aligned stems as one looping piece. Every stem
 * starts on the same AudioContext time with the same loop length, so they
 * stay sample-locked for as long as the page runs. Each stem has its own
 * volume, HRTF panner and analyser, like the synth engine's voices.
 */
export class StemPlayer {
  private ctx: AudioContext | null = null;
  private stems = new Map<string, StemChain>();
  private master!: GainNode;
  private mixAnalyser!: AnalyserNode;
  private mixBuffer!: Float32Array<ArrayBuffer>;
  private startedAt = 0;
  private loopSeconds = 0;
  private userPaused = false;
  private sourcesStarted = false;
  private loading: Promise<void> | null = null;

  constructor(private specs: StemSpec[]) {}

  get ids(): string[] {
    return this.specs.map((s) => s.id);
  }

  /** True once play() has started the stems. */
  get started(): boolean {
    return this.sourcesStarted;
  }

  /** True once every stem is decoded and ready to play. */
  get loaded(): boolean {
    return this.loopSeconds > 0;
  }

  get playing(): boolean {
    return this.sourcesStarted && this.ctx?.state === 'running' && !this.userPaused;
  }

  /**
   * Load, unlock and play in one call. Use from a click or tap handler.
   * `onProgress` reports stems decoded so far.
   */
  async start(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.sourcesStarted) {
      await this.resume();
      return;
    }
    const loading = this.load(onProgress);
    this.unlock();
    await loading;
    this.play();
  }

  /**
   * Allow sound. Browsers only let audio start inside a user gesture (click,
   * tap, key, or the click that enters XR), so call this from such a handler.
   * A touch inside VR is not a gesture, which is why the app unlocks audio
   * on the Enter XR click and only starts playback later.
   */
  unlock(): void {
    this.ensureContext();
    if (!this.userPaused) void this.ctx!.resume();
  }

  /**
   * Fetch and decode every stem. Safe before any user gesture: the audio
   * context exists but stays silent until unlock().
   */
  load(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.loading ??= this.decodeAll(onProgress);
    return this.loading;
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 2.5;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(compressor);
    this.mixAnalyser = ctx.createAnalyser();
    this.mixAnalyser.fftSize = 512;
    this.mixBuffer = new Float32Array(this.mixAnalyser.fftSize);
    this.master.connect(this.mixAnalyser);
    return ctx;
  }

  private async decodeAll(onProgress?: (done: number, total: number) => void, generation = this.generation): Promise<void> {
    const ctx = this.ensureContext();
    const specs = this.specs;
    let done = 0;
    const buffers = await Promise.all(
      specs.map(async (s) => {
        const res = await fetch(s.url);
        if (!res.ok) throw new Error(`stem ${s.id}: HTTP ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        if (generation === this.generation) onProgress?.(++done, specs.length);
        return buf;
      }),
    );
    // A newer switchTo() replaced this load while it was running.
    if (generation !== this.generation) return;

    this.loopSeconds = Math.min(...buffers.map((b) => b.duration));
    this.specs.forEach((s, i) => {
      const bus = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const gain = ctx.createGain();
      const panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'linear',
        rolloffFactor: 0,
      });
      bus.connect(analyser);
      bus.connect(gain);
      gain.connect(panner);
      panner.connect(this.master);
      this.stems.set(s.id, {
        buffer: buffers[i],
        source: null,
        bus,
        gain,
        panner,
        analyser,
        levelBuffer: new Float32Array(analyser.fftSize),
      });
    });
  }

  /**
   * Start every stem together from the top. Requires load() to have finished;
   * sound is heard once unlock() has run.
   */
  play(): void {
    const ctx = this.ctx;
    if (!ctx || !this.loaded || this.sourcesStarted) return;
    this.sourcesStarted = true;
    // One shared start time a little in the future keeps every stem aligned.
    this.startedAt = ctx.currentTime + 0.1;
    for (const chain of this.stems.values()) {
      const src = ctx.createBufferSource();
      src.buffer = chain.buffer;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = this.loopSeconds;
      src.connect(chain.bus);
      src.start(this.startedAt);
      chain.source = src;
    }
  }

  /** True while the listener has paused the music. */
  get paused(): boolean {
    return this.userPaused;
  }

  async pause(): Promise<void> {
    this.userPaused = true;
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    this.userPaused = false;
    await this.ctx?.resume();
  }

  async setAppVisible(visible: boolean): Promise<void> {
    if (!this.ctx) return;
    if (!visible) await this.ctx.suspend();
    else if (!this.userPaused) await this.ctx.resume();
  }

  setMasterGain(value: number): void {
    if (this.ctx) this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  setGain(id: string, value: number, seconds = 0.05): void {
    const c = this.stems.get(id);
    if (c && this.ctx) c.gain.gain.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.005, seconds / 3));
  }

  setPosition(id: string, p: Vec3): void {
    const c = this.stems.get(id);
    if (!c || !this.ctx) return;
    const t = this.ctx.currentTime;
    c.panner.positionX.setValueAtTime(p.x, t);
    c.panner.positionY.setValueAtTime(p.y, t);
    c.panner.positionZ.setValueAtTime(p.z, t);
  }

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

  /** RMS loudness of one stem before its volume control. */
  level(id: string): number {
    const c = this.stems.get(id);
    if (!c) return 0;
    c.analyser.getFloatTimeDomainData(c.levelBuffer);
    let sum = 0;
    for (let i = 0; i < c.levelBuffer.length; i++) sum += c.levelBuffer[i] ** 2;
    return Math.sqrt(sum / c.levelBuffer.length);
  }

  /** RMS loudness of the whole mix after all volume controls. */
  mixLevel(): number {
    if (!this.mixAnalyser) return 0;
    this.mixAnalyser.getFloatTimeDomainData(this.mixBuffer);
    let sum = 0;
    for (let i = 0; i < this.mixBuffer.length; i++) sum += this.mixBuffer[i] ** 2;
    return Math.sqrt(sum / this.mixBuffer.length);
  }

  /** Place every stem at one point (the Whole state's single ball). */
  setAllPositions(p: Vec3): void {
    for (const id of this.stems.keys()) this.setPosition(id, p);
  }

  /** Seconds into the loop, or null before start. */
  position(): number | null {
    if (!this.ctx || !this.sourcesStarted) return null;
    const t = this.ctx.currentTime - this.startedAt;
    return t < 0 ? 0 : t % this.loopSeconds;
  }

  get loopLength(): number {
    return this.loopSeconds;
  }

  /** The audio context, once created (for sound effects that share the mix). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** The master bus; effects connected here follow the master volume. */
  get output(): AudioNode | null {
    return this.ctx ? this.master : null;
  }

  /**
   * Swap to a different set of stems (another piece): stop and release the
   * current ones, then start loading the new set. Sound effects and the
   * listener are untouched; call play() once load() resolves.
   */
  switchTo(specs: StemSpec[], onProgress?: (done: number, total: number) => void): Promise<void> {
    for (const chain of this.stems.values()) {
      try {
        chain.source?.stop();
      } catch {
        // never started
      }
      chain.source?.disconnect();
      chain.bus.disconnect();
      chain.gain.disconnect();
      chain.panner.disconnect();
    }
    this.stems.clear();
    this.specs = specs;
    this.loopSeconds = 0;
    this.sourcesStarted = false;
    this.userPaused = false;
    // Choosing a piece while paused means "play this": wake the audio up.
    void this.ctx?.resume();
    this.loading = null;
    const generation = ++this.generation;
    this.loading = this.decodeAll(onProgress, generation);
    return this.loading;
  }

  private generation = 0;

  /** Memory used by the decoded audio, in megabytes. */
  decodedMegabytes(): number {
    let bytes = 0;
    for (const c of this.stems.values()) bytes += c.buffer.length * c.buffer.numberOfChannels * 4;
    return bytes / 1e6;
  }
}
