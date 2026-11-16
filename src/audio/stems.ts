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
  private startedAt = 0;
  private loopSeconds = 0;
  private userPaused = false;

  constructor(private readonly specs: StemSpec[]) {}

  get ids(): string[] {
    return this.specs.map((s) => s.id);
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  get playing(): boolean {
    return this.ctx?.state === 'running' && !this.userPaused;
  }

  /**
   * Fetch and decode every stem, then start them together. Call from a user
   * gesture. `onProgress` reports stems decoded so far.
   */
  async start(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.ctx) {
      await this.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.resume();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 2.5;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(compressor);

    let done = 0;
    const buffers = await Promise.all(
      this.specs.map(async (s) => {
        const res = await fetch(s.url);
        if (!res.ok) throw new Error(`stem ${s.id}: HTTP ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        onProgress?.(++done, this.specs.length);
        return buf;
      }),
    );

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

    // One shared start time a little in the future keeps every stem aligned.
    this.startedAt = ctx.currentTime + 0.15;
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

  /** Seconds into the loop, or null before start. */
  position(): number | null {
    if (!this.ctx || this.loopSeconds === 0) return null;
    const t = this.ctx.currentTime - this.startedAt;
    return t < 0 ? 0 : t % this.loopSeconds;
  }

  get loopLength(): number {
    return this.loopSeconds;
  }

  /** Memory used by the decoded audio, in megabytes. */
  decodedMegabytes(): number {
    let bytes = 0;
    for (const c of this.stems.values()) bytes += c.buffer.length * c.buffer.numberOfChannels * 4;
    return bytes / 1e6;
  }
}
