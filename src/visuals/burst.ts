import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { getGlowTexture } from './glow-ball.js';

interface Flash {
  mesh: Mesh<PlaneGeometry | RingGeometry, MeshBasicMaterial>;
  age: number;
  life: number;
  from: number;
  to: number;
  peak: number;
  active: boolean;
}

/**
 * Expanding light rings and soft flashes for the moments the music changes
 * shape (the split, a merge, the finale). A small fixed pool of camera-facing
 * meshes; nothing is allocated while running.
 */
export class Bursts {
  readonly root = new Group();
  private readonly rings: Flash[] = [];
  private readonly glows: Flash[] = [];

  constructor() {
    this.root.name = 'Bursts';
    const ringGeometry = new RingGeometry(0.46, 0.5, 64);
    const glowGeometry = new PlaneGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      this.rings.push(this.make(ringGeometry, null));
      this.glows.push(this.make(glowGeometry, getGlowTexture()));
    }
  }

  private make(geometry: PlaneGeometry | RingGeometry, map: ReturnType<typeof getGlowTexture> | null): Flash {
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    mesh.raycast = () => {};
    this.root.add(mesh);
    return { mesh, age: 0, life: 1, from: 0, to: 1, peak: 1, active: false };
  }

  /** An expanding ring from diameter `from` to `to` metres. */
  ring(at: Vector3, colour: Color, from: number, to: number, life = 0.7, peak = 0.9): void {
    this.start(this.rings, at, colour, from, to, life, peak);
  }

  /** A soft round flash of light. */
  flash(at: Vector3, colour: Color, from: number, to: number, life = 0.5, peak = 1): void {
    this.start(this.glows, at, colour, from, to, life, peak);
  }

  private start(pool: Flash[], at: Vector3, colour: Color, from: number, to: number, life: number, peak: number): void {
    const f = pool.find((p) => !p.active) ?? pool[0];
    f.active = true;
    f.age = 0;
    f.life = life;
    f.from = from;
    f.to = to;
    f.peak = peak;
    f.mesh.position.copy(at);
    f.mesh.material.color.copy(colour);
    f.mesh.scale.setScalar(from);
    f.mesh.visible = true;
  }

  /** Advance every active flash; each turns to face `eyes`. */
  update(delta: number, eyes: Vector3): void {
    for (const pool of [this.rings, this.glows]) {
      for (const f of pool) {
        if (!f.active) continue;
        f.age += delta;
        const t = f.age / f.life;
        if (t >= 1) {
          f.active = false;
          f.mesh.visible = false;
          continue;
        }
        const grow = 1 - Math.pow(1 - t, 3); // fast out, settling
        f.mesh.scale.setScalar(f.from + (f.to - f.from) * grow);
        f.mesh.material.opacity = f.peak * (1 - t) * (1 - t);
        f.mesh.lookAt(eyes);
      }
    }
  }
}
