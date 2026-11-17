import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';

/**
 * A fixed pool of small glowing points for note sparks, flight trails and
 * bursts, drawn as ONE point cloud (a single draw call however many are
 * alive). No allocation per spark; the oldest is reused when the pool is full.
 */
export class Sparks {
  readonly root: Points<BufferGeometry, ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly startSize: Float32Array;
  /** Per-spark drag and gravity, so trails hang and bursts fly. */
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(private readonly size = 320) {
    this.positions = new Float32Array(size * 3);
    this.colours = new Float32Array(size * 3);
    this.sizes = new Float32Array(size);
    this.alphas = new Float32Array(size);
    this.velocity = new Float32Array(size * 3);
    this.age = new Float32Array(size).fill(1);
    this.life = new Float32Array(size).fill(1);
    this.startSize = new Float32Array(size);
    this.drag = new Float32Array(size);
    this.gravity = new Float32Array(size);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(this.colours, 3));
    geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));

    const material = new ShaderMaterial({
      uniforms: { uScale: { value: 900 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // World-size points: metres to pixels at this depth.
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale * projectionMatrix[1][1] / max(0.05, -mv.z) : 0.0;
          vColor = aColor;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = pow(max(0.0, 1.0 - d), 2.2);
          gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5) * core * vAlpha, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.root = new Points(geometry, material);
    this.root.name = 'Sparks';
    this.root.frustumCulled = false;
    // Decoration only: never a pointer target.
    this.root.raycast = () => {};
  }

  /** Pixels per unit of (size × projection) at 1 m: half the eye buffer height. */
  setViewportHalfHeight(px: number): void {
    this.root.material.uniforms.uScale.value = px;
  }

  /** Burst `count` sparks outward from `at` (world position) in `colour`. */
  emit(at: Vector3, colour: Color, count = 4, radius = 0.045, speed = 1, size = 0.022, life = 0.45): void {
    for (let n = 0; n < count; n++) {
      // A random direction, mostly sideways and up so the sparks read as rising.
      const theta = Math.random() * Math.PI * 2;
      const up = 0.2 + Math.random() * 0.8;
      const len = Math.hypot(1, up);
      const dx = Math.cos(theta) / len;
      const dy = up / len;
      const dz = Math.sin(theta) / len;
      const v = (0.12 + Math.random() * 0.18) * speed;
      this.spawn(at.x + dx * radius, at.y + dy * radius, at.z + dz * radius, dx * v, dy * v, dz * v, colour, size, life, 2.5, 0);
    }
  }

  /** Sparks thrown in every direction, falling gently: for splits and the finale. */
  burst(at: Vector3, colour: Color, count: number, speed = 0.6, size = 0.02, life = 1.1): void {
    for (let n = 0; n < count; n++) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(at.x, at.y, at.z, r * Math.cos(theta) * v, u * v, r * Math.sin(theta) * v, colour, size, life * (0.7 + Math.random() * 0.6), 1.6, -0.25);
    }
  }

  /** One slow, short-lived mote left where a moving ball has just been. */
  trail(at: Vector3, colour: Color, size = 0.016, life = 0.5): void {
    const j = 0.006;
    this.spawn(
      at.x + (Math.random() - 0.5) * j,
      at.y + (Math.random() - 0.5) * j,
      at.z + (Math.random() - 0.5) * j,
      0,
      0.02,
      0,
      colour,
      size,
      life,
      1,
      0,
    );
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colour: Color,
    size: number,
    life: number,
    drag: number,
    gravity: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.size;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocity[i3] = vx;
    this.velocity[i3 + 1] = vy;
    this.velocity[i3 + 2] = vz;
    this.colours[i3] = colour.r;
    this.colours[i3 + 1] = colour.g;
    this.colours[i3 + 2] = colour.b;
    this.startSize[i] = size;
    this.sizes[i] = size;
    this.alphas[i] = 1;
    this.age[i] = 0;
    this.life[i] = life;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
    this.alive = this.size; // re-scan everything until it all fades
    const g = this.root.geometry.attributes;
    g.aColor.needsUpdate = true;
  }

  update(delta: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.alphas[i] <= 0) continue;
      this.age[i] += delta;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.alphas[i] = 0;
        continue;
      }
      alive++;
      const i3 = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * delta);
      this.velocity[i3] *= k;
      this.velocity[i3 + 1] = this.velocity[i3 + 1] * k + this.gravity[i] * delta;
      this.velocity[i3 + 2] *= k;
      this.positions[i3] += this.velocity[i3] * delta;
      this.positions[i3 + 1] += this.velocity[i3 + 1] * delta;
      this.positions[i3 + 2] += this.velocity[i3 + 2] * delta;
      this.alphas[i] = 1 - t;
      this.sizes[i] = this.startSize[i] * (1 - 0.6 * t);
    }
    this.alive = alive;
    const g = this.root.geometry.attributes;
    g.position.needsUpdate = true;
    g.aSize.needsUpdate = true;
    g.aAlpha.needsUpdate = true;
  }

  hideAll(): void {
    this.alphas.fill(0);
    this.root.geometry.attributes.aAlpha.needsUpdate = true;
    this.alive = 0;
  }
}
