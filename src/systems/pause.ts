import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { music } from '../audio/app-audio.js';
import { BallStates, MusicBall } from '../components.js';
import { createTextPanel, type TextPanel } from '../visuals/glow-ball.js';
import { SectionsSystem } from './sections.js';
import { faceViewer, readViewer } from './viewer.js';

const WIDTH = 0.11;
const HEIGHT = WIDTH * (140 / 400);
/** Under the whole ball: this far below its centre (headset / computer). */
const BELOW_BALL = 0.17;
const DESKTOP_BELOW_BALL = 0.15;
/** Under the arc of sections: this far below the guide's panel anchor. */
const BELOW_ARC = 0.33;
const DESKTOP_BELOW_ARC = 0.37;
/** On a computer the button is drawn larger, to be easy to click. */
const DESKTOP_SCALE = 1.35;
const TOUCH_DEPTH = 0.025;
const TOUCH_MARGIN = 0.01;
const COOLDOWN = 0.8;

/**
 * Pause and play. A small button under the music (under the whole ball, or
 * under the sections when they are apart): touch it with a fingertip in a
 * headset, click it on a computer, or press Space. A pinching finger never
 * presses it, so grabbing nearby is safe. The headset's system menu still
 * pauses everything by itself.
 */
export class PauseSystem extends createSystem({
  whole: { required: [MusicBall] },
}) {
  private button!: TextPanel;
  private shownPaused: boolean | null = null;
  private cooldown = 0;
  private readonly inside = { left: false, right: false };
  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly tip = new Vector3();
  private readonly local = new Vector3();
  private readonly ndc = new Vector3();
  private sections: SectionsSystem | undefined;

  init(): void {
    this.button = createTextPanel(WIDTH, 400, 140, { plate: true });
    this.button.mesh.name = 'PauseButton';
    this.button.mesh.raycast = () => {};
    this.button.mesh.visible = false;
    this.world.createTransformEntity(this.button.mesh, { persistent: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && music.started) {
        e.preventDefault();
        this.toggle();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const m = this.button.mesh;
      if (this.world.session || e.button !== 0 || !m.visible) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ndc.copy(m.position).project(this.camera);
      const x = rect.left + ((this.ndc.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - this.ndc.y) / 2) * rect.height;
      const d = m.position.distanceTo(this.camera.getWorldPosition(this.tip));
      const px = (DESKTOP_SCALE * rect.height) / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360));
      if (Math.abs(e.clientX - x) < (WIDTH / 2) * px + 4 && Math.abs(e.clientY - y) < (HEIGHT / 2) * px + 4) this.toggle();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('pointerdown', onPointer),
    );
  }

  private toggle(): void {
    if (this.cooldown > 0) return;
    this.cooldown = COOLDOWN;
    if (music.paused) void music.resume();
    else void music.pause();
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.sections ??= this.world.getSystem(SectionsSystem);
    let whole;
    for (const e of this.queries.whole.entities) whole = e;
    const m = this.button.mesh;
    if (!whole?.object3D || !this.sections || !music.started) {
      m.visible = false;
      return;
    }
    const presenting = readViewer(this, this.head, this.headQuat);
    const apart = whole.getValue(MusicBall, 'state') === BallStates.Apart;

    if (!apart) {
      whole.object3D.getWorldPosition(m.position);
      m.position.y -= presenting ? BELOW_BALL : DESKTOP_BELOW_BALL;
      m.visible = whole.object3D.visible;
    } else if (this.sections.settled) {
      m.position.copy(this.sections.panelAnchor);
      m.position.y -= presenting ? BELOW_ARC : DESKTOP_BELOW_ARC;
      m.visible = true;
    } else {
      m.visible = false;
    }
    if (!m.visible) return;
    m.scale.setScalar(presenting ? 1 : DESKTOP_SCALE);
    faceViewer(m, this.head);
    m.updateMatrixWorld();

    if (this.shownPaused !== music.paused) {
      this.shownPaused = music.paused;
      this.button.setText([
        { text: music.paused ? 'Play music' : 'Pause music', size: 52, weight: 600, colour: music.paused ? '#f3d9a4' : '#e6e7ef' },
      ]);
    }

    if (!presenting) return;
    for (const side of ['left', 'right'] as const) {
      const pinching = this.input.xr.getSelectState(side).active;
      this.player.indexTipSpaces[side].getWorldPosition(this.tip);
      let hit = false;
      if (!pinching && this.tip.lengthSq() > 0) {
        this.local.copy(this.tip);
        m.worldToLocal(this.local);
        hit =
          Math.abs(this.local.x) < WIDTH / 2 + TOUCH_MARGIN &&
          Math.abs(this.local.y) < HEIGHT / 2 + TOUCH_MARGIN &&
          Math.abs(this.local.z) < TOUCH_DEPTH;
      }
      if (hit && !this.inside[side]) this.toggle();
      this.inside[side] = hit;
    }
  }
}
