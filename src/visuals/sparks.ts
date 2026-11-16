import { AdditiveBlending, Color, Group, Sprite, SpriteMaterial, Vector3 } from '@iwsdk/core';
import { getGlowTexture } from './glow-ball.js';

const LIFE_SECONDS = 0.45;
const START_SIZE = 0.022;

interface Spark {
  sprite: Sprite;
  velocity: Vector3;
  age: number;
  alive: boolean;
}

/**
 * A fixed pool of tiny glowing sprites for note sparks. No allocation per
 * spark; the oldest is reused when the pool is full.
 */
export class Sparks {
  readonly root = new Group();
  private readonly pool: Spark[] = [];
  private next = 0;

  constructor(size = 64) {
    this.root.name = 'Sparks';
    for (let i = 0; i < size; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: getGlowTexture(),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      // Decoration only: three's Sprite.raycast throws without a camera,
      // which would stop IWSDK's XR frame loop.
      sprite.raycast = () => {};
      sprite.visible = false;
      this.root.add(sprite);
      this.pool.push({ sprite, velocity: new Vector3(), age: 0, alive: false });
    }
  }

  /** Burst `count` sparks outward from `at` (world position) in `colour`. */
  emit(at: Vector3, colour: Color, count = 4, radius = 0.045): void {
    for (let n = 0; n < count; n++) {
      const s = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      // A random direction, mostly sideways and up so the sparks read as rising.
      const theta = Math.random() * Math.PI * 2;
      const up = 0.2 + Math.random() * 0.8;
      s.velocity.set(Math.cos(theta), up, Math.sin(theta)).normalize();
      s.sprite.position.copy(at).addScaledVector(s.velocity, radius);
      s.velocity.multiplyScalar(0.12 + Math.random() * 0.18);
      s.sprite.material.color.copy(colour);
      s.sprite.material.opacity = 1;
      s.sprite.scale.setScalar(START_SIZE);
      s.sprite.visible = true;
      s.age = 0;
      s.alive = true;
    }
  }

  update(delta: number): void {
    for (const s of this.pool) {
      if (!s.alive) continue;
      s.age += delta;
      const t = s.age / LIFE_SECONDS;
      if (t >= 1) {
        s.alive = false;
        s.sprite.visible = false;
        continue;
      }
      s.sprite.position.addScaledVector(s.velocity, delta);
      s.velocity.multiplyScalar(1 - 2.5 * delta); // drag
      s.sprite.material.opacity = 1 - t;
      s.sprite.scale.setScalar(START_SIZE * (1 - 0.6 * t));
    }
  }

  hideAll(): void {
    for (const s of this.pool) {
      s.alive = false;
      s.sprite.visible = false;
    }
  }
}
