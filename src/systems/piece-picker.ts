import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { cues, selectPiece } from '../audio/app-audio.js';
import { BallStates, MusicBall } from '../components.js';
import { pieces, pieceState } from '../music/piece.js';
import { createTextPanel, type TextPanel } from '../visuals/glow-ball.js';
import { faceViewer, readViewer } from './viewer.js';

/** Card size (metres). */
const CARD_WIDTH = 0.15;
const CARD_HEIGHT = CARD_WIDTH * (190 / 512);
/** Cards sit below the whole ball, either side of the pause button: this far either side of it... */
const CARD_SIDEWAYS = 0.14;
/** ...and this far below its centre. */
const CARD_BELOW = 0.17;
const DESKTOP_CARD_SIDEWAYS = 0.165;
const DESKTOP_CARD_BELOW = 0.15;
/** A fingertip within this of the card's face counts as a touch. */
const TOUCH_DEPTH = 0.025;
const TOUCH_MARGIN = 0.008;
/** Ignore touches for this long after a choice. */
const COOLDOWN = 1.5;
const GOLD = '#f3d9a4';

/**
 * Choose the music: one small card per piece below the whole ball, shown
 * whenever the orchestra is together. Touch a card with a fingertip (or
 * click it on a computer) and that piece loads and plays. The cards ignore
 * fingers that are pinching, so a two-hand pull never picks one by accident.
 */
export class PiecePickerSystem extends createSystem({
  whole: { required: [MusicBall] },
}) {
  private cards: TextPanel[] = [];
  private shownVersion = -1;
  private cooldown = 0;
  /** Whether each hand's fingertip was inside a card last frame (touch on entry only). */
  private readonly inside = { left: -1, right: -1 };
  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly ball = new Vector3();
  private readonly right = new Vector3();
  private readonly tip = new Vector3();
  private readonly local = new Vector3();
  private readonly ndc = new Vector3();

  init(): void {
    this.cards = pieces.map((_, i) => {
      const card = createTextPanel(CARD_WIDTH, 512, 190, { plate: true });
      card.mesh.name = `PieceCard${i}`;
      card.mesh.raycast = () => {};
      card.mesh.visible = false;
      this.world.createTransformEntity(card.mesh, { persistent: true });
      return card;
    });

    // Computer: a click on a card.
    const onPointer = (e: PointerEvent) => {
      if (this.world.session || e.button !== 0) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.cards.forEach((card, i) => {
        if (!card.mesh.visible) return;
        const half = this.screenHalfSize(card, rect);
        this.ndc.copy(card.mesh.position).project(this.camera);
        const x = rect.left + ((this.ndc.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - this.ndc.y) / 2) * rect.height;
        if (Math.abs(e.clientX - x) < half.w && Math.abs(e.clientY - y) < half.h) this.choose(i);
      });
    };
    window.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(() => window.removeEventListener('pointerdown', onPointer));
  }

  /** Half the card's on-screen size in pixels (it faces the camera). */
  private screenHalfSize(card: TextPanel, rect: DOMRect): { w: number; h: number } {
    const d = card.mesh.position.distanceTo(this.camera.getWorldPosition(this.tip));
    const pxPerMetre = rect.height / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360));
    return { w: (CARD_WIDTH / 2) * pxPerMetre, h: (CARD_HEIGHT / 2) * pxPerMetre };
  }

  private choose(i: number): void {
    if (this.cooldown > 0 || i === pieceState.index) return;
    this.cooldown = COOLDOWN;
    cues.play('success', this.cards[i].mesh.position);
    selectPiece(i);
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    let whole;
    for (const e of this.queries.whole.entities) whole = e;
    if (!whole?.object3D) return;
    const presenting = readViewer(this, this.head, this.headQuat);
    const together = whole.getValue(MusicBall, 'state') !== BallStates.Apart && whole.object3D.visible;

    if (this.shownVersion !== pieceState.version) this.redraw();

    whole.object3D.getWorldPosition(this.ball);
    this.right.set(1, 0, 0).applyQuaternion(this.headQuat);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    const sideways = presenting ? CARD_SIDEWAYS : DESKTOP_CARD_SIDEWAYS;
    const below = presenting ? CARD_BELOW : DESKTOP_CARD_BELOW;

    this.cards.forEach((card, i) => {
      const m = card.mesh;
      m.visible = together;
      if (!together) return;
      const offset = (i - (this.cards.length - 1) / 2) * 2 * sideways;
      m.position.copy(this.ball).addScaledVector(this.right, offset);
      m.position.y -= below;
      faceViewer(m, this.head);
      m.updateMatrixWorld();
    });

    if (!together || !presenting) return;
    for (const side of ['left', 'right'] as const) {
      const pinching = this.input.xr.getSelectState(side).active;
      this.player.indexTipSpaces[side].getWorldPosition(this.tip);
      let hit = -1;
      if (!pinching && this.tip.lengthSq() > 0) {
        this.cards.forEach((card, i) => {
          this.local.copy(this.tip);
          card.mesh.worldToLocal(this.local);
          if (
            Math.abs(this.local.x) < CARD_WIDTH / 2 + TOUCH_MARGIN &&
            Math.abs(this.local.y) < CARD_HEIGHT / 2 + TOUCH_MARGIN &&
            Math.abs(this.local.z) < TOUCH_DEPTH
          ) {
            hit = i;
          }
        });
      }
      if (hit >= 0 && this.inside[side] !== hit) this.choose(hit);
      this.inside[side] = hit;
    }
  }

  /** The chosen piece's card glows gold; the others invite a touch. */
  private redraw(): void {
    this.shownVersion = pieceState.version;
    const desk = !this.world.session;
    this.cards.forEach((card, i) => {
      const chosen = i === pieceState.index;
      const p = pieces[i];
      card.setText([
        { text: p.composer, size: 64, font: 'serif', weight: 600, colour: chosen ? GOLD : '#e6e7ef' },
        { text: p.short, size: 40, colour: chosen ? '#ffffff' : '#c9cbd8' },
        { text: chosen ? '♪ playing' : desk ? 'click to play' : 'touch to play', size: 30, colour: chosen ? GOLD : '#9a9db0' },
      ]);
      card.mesh.material.opacity = chosen ? 1 : 0.8;
    });
  }
}
