import {
  AdditiveBlending,
  Color,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { music } from '../audio/app-audio.js';
import { BallStates, MusicBall, SectionBall } from '../components.js';
import { mozart40 } from '../music/mozart40.js';
import { PODIUM_HEIGHT, PODIUM_SIZE } from '../scene-assets/hall.scene-asset.js';
import { getGlowTexture } from '../visuals/glow-ball.js';

/** Seconds for the house lights to go down (or come back up). */
const FADE_SECONDS = 3.2;
/** Floor height in world space (the hall's stage floor). */
const FLOOR_Y = 0;
const WHOLE_COLOUR = new Color('#ffd58a');

/**
 * Concert lighting for the hall.
 * - House lights down: before the music the hall is evenly lit; when the
 *   music starts, the house fades to dark and the stage spotlights, beams of
 *   light and drifting dust come up. Pausing brings the house lights back.
 * - The stage lighting breathes with the music's loudness, and swells for a
 *   moment when the orchestra splits apart or comes back together.
 * - Each glowing ball casts a soft pool of its own colour onto the floor.
 */
export class HallLightingSystem extends createSystem({
  whole: { required: [MusicBall] },
  sections: { required: [SectionBall] },
}) {
  private solid: ShaderMaterial | null = null;
  private beams: ShaderMaterial | null = null;
  private dust: ShaderMaterial | null = null;
  private lamps: MeshBasicMaterial | null = null;

  /** 0..1 progress of the house-lights fade (eased when applied). */
  private fade = 0;
  /** Smoothed loudness of the whole mix, 0..1. */
  private pulse = 0;
  /** A brief swell on split and merge, decaying to 0. */
  private surge = 0;
  private lastState = '';

  private readonly pools: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly sectionColours = mozart40.sections.map((s) => new Color(s.colour));
  private readonly sectionLevels = new Float32Array(mozart40.sections.length);
  private readonly pos = new Vector3();

  init(): void {
    const root = new Group();
    root.name = 'FloorGlows';
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    for (let i = 0; i < mozart40.sections.length + 1; i++) {
      const mesh = new Mesh(
        plane,
        new MeshBasicMaterial({
          map: getGlowTexture(),
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.visible = false;
      mesh.raycast = () => {};
      mesh.renderOrder = 1;
      root.add(mesh);
      this.pools.push(mesh);
    }
    this.world.createTransformEntity(root, { persistent: true });
  }

  /** The hall arrives with the level, after the systems start: look for it until found. */
  private findHall(): boolean {
    if (this.solid) return true;
    const scene = this.world.scene;
    const solid = scene.getObjectByName('HallSolid') as Mesh | undefined;
    if (!solid) return false;
    this.solid = solid.material as ShaderMaterial;
    this.beams = ((scene.getObjectByName('LightBeams') as Mesh | undefined)?.material as ShaderMaterial) ?? null;
    this.dust = ((scene.getObjectByName('Dust') as Points | undefined)?.material as ShaderMaterial) ?? null;
    this.lamps = ((scene.getObjectByName('LampGlows') as Mesh | undefined)?.material as MeshBasicMaterial) ?? null;
    return true;
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.1);

    // The music's state: lights down while it plays.
    const target = music.playing ? 1 : 0;
    this.fade += Math.sign(target - this.fade) * Math.min(Math.abs(target - this.fade), dt / FADE_SECONDS);
    const mix = this.fade * this.fade * (3 - 2 * this.fade);

    const db = 20 * Math.log10(music.mixLevel() + 1e-6);
    const loud = music.playing ? Math.max(0, Math.min(1, (db + 45) / 30)) : 0;
    this.pulse += (loud - this.pulse) * Math.min(1, (loud > this.pulse ? 3 : 1.2) * dt);

    let state = '';
    for (const e of this.queries.whole.entities) state = e.getValue(MusicBall, 'state') as string;
    if (state !== this.lastState) {
      if (this.lastState && state !== BallStates.Idle) this.surge = 1;
      this.lastState = state;
    }
    this.surge *= Math.exp(-2.2 * dt);

    if (this.findHall()) {
      this.solid!.uniforms.uMix.value = mix;
      this.solid!.uniforms.uStage.value = 0.7 + 0.45 * this.pulse + 0.35 * this.surge;
      if (this.beams) this.beams.uniforms.uOpacity.value = mix * (0.2 + 0.2 * this.pulse + 0.25 * this.surge);
      if (this.dust) {
        this.dust.uniforms.uOpacity.value = mix * (0.45 + 0.4 * this.pulse);
        this.dust.uniforms.uTime.value = time;
        const layer = this.world.session?.renderState.baseLayer;
        this.dust.uniforms.uScale.value = (layer ? layer.framebufferHeight : this.renderer.domElement.height) / 2;
      }
      if (this.lamps) this.lamps.color.setScalar(1 - 0.8 * mix);
    }

    this.updatePools(state, dt);
  }

  /** A soft pool of light on the floor under each visible ball. */
  private updatePools(state: string, dt: number): void {
    let used = 0;
    for (const e of this.queries.sections.entities) {
      const obj = e.object3D;
      const i = e.getValue(SectionBall, 'index') as number;
      if (!obj || !obj.visible || i < 0 || i >= this.sectionColours.length) continue;
      const sdb = 20 * Math.log10(music.level(mozart40.sections[i].id) + 1e-6);
      const lvl = Math.max(0, Math.min(1, (sdb + 48) / 30));
      this.sectionLevels[i] += (lvl - this.sectionLevels[i]) * Math.min(1, 8 * dt);
      this.place(this.pools[used++], obj, this.sectionColours[i], 0.12 + 0.55 * this.sectionLevels[i], 0.8);
    }
    if (state !== BallStates.Apart) {
      for (const e of this.queries.whole.entities) {
        if (e.object3D?.visible) this.place(this.pools[used++], e.object3D, WHOLE_COLOUR, 0.15 + 0.6 * this.pulse, 1.3);
      }
    }
    for (let k = used; k < this.pools.length; k++) this.pools[k].visible = false;
  }

  private place(pool: Mesh<PlaneGeometry, MeshBasicMaterial>, obj: Object3D, colour: Color, strength: number, size: number): void {
    obj.getWorldPosition(this.pos);
    // The glow lands on the podium top when the ball is over it.
    const half = PODIUM_SIZE / 2;
    const floor = FLOOR_Y + (Math.abs(this.pos.x) < half && Math.abs(this.pos.z) < half ? PODIUM_HEIGHT + 0.008 : 0);
    const h = Math.max(0.1, this.pos.y - floor);
    pool.visible = true;
    pool.position.set(this.pos.x, floor + 0.006, this.pos.z);
    // Higher balls cast wider, fainter pools.
    pool.scale.setScalar(size * (0.4 + 0.35 * h));
    pool.material.color.copy(colour);
    pool.material.opacity = Math.min(1, (1.8 * strength) / (1 + 0.4 * h * h));
  }
}
