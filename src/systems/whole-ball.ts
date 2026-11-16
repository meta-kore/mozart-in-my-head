import {
  createSystem,
  Entity,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { music } from '../audio/app-audio.js';
import { BallStates, MusicBall } from '../components.js';
import { createGlowBall, createTextPanel, type GlowBall, type TextPanel } from '../visuals/glow-ball.js';
import { faceViewer, readViewer } from './viewer.js';

/** Starting values from CLAUDE.md; tune on a headset. */
const BALL_DIAMETER = 0.18;
/** Horizontal distance from the eyes to the ball. */
const BALL_FORWARD = 0.45;
/** How far below eye level the ball floats (roughly chest height). */
const BALL_BELOW_EYES = 0.3;
/** Space between the top of the ball and the hint text's centre. */
const LABEL_GAP = 0.07;
/** Outside XR (desktop development), distance along the line of sight. */
const DESKTOP_DISTANCE = 0.85;
/** A fingertip this close to the ball's surface counts as a touch. */
const TOUCH_MARGIN = 0.015;
/** A pinch or trigger press counts when the hand is this close to the ball's surface. */
const PINCH_MARGIN = 0.12;
const WHOLE_COLOUR = '#ffe2a8';
const CREDIT = 'Mozart · Symphony No. 40 · Colibrì Ensemble · The Spheres Dataset · CC BY-SA 4.0';

const SIDES = ['left', 'right'] as const;

/**
 * The Whole state: one glowing ball in front of the player holding the whole
 * orchestra. Silent and gently breathing until touched; then the music
 * starts, every section sounds from the ball, and the ball pulses with the
 * mix.
 */
export class WholeBallSystem extends createSystem({
  balls: { required: [MusicBall] },
  pressed: { required: [MusicBall, Pressed] },
}) {
  private ball!: GlowBall;
  private label!: TextPanel;
  private ballEntity!: Entity;
  private labelEntity!: Entity;

  private placed = false;
  /** Frames to wait after entering XR before trusting the head pose. */
  private placeAfterFrames = 0;
  private wasImmersive = false;
  private pendingStart = false;
  private level = 0;

  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly ballPos = new Vector3();
  private readonly tip = new Vector3();
  private readonly audioPos = { x: 0, y: 0, z: 0 };
  private readonly audioFwd = { x: 0, y: 0, z: -1 };
  private readonly audioUp = { x: 0, y: 1, z: 0 };

  init(): void {
    this.ball = createGlowBall(BALL_DIAMETER, WHOLE_COLOUR);
    this.ball.root.name = 'WholeBall';
    this.ballEntity = this.world.createTransformEntity(this.ball.root, { persistent: true });
    this.ballEntity.addComponent(MusicBall, { state: BallStates.Idle, diameter: BALL_DIAMETER });
    this.ballEntity.addComponent(RayInteractable);

    this.label = createTextPanel(0.42);
    this.label.mesh.name = 'WholeBallLabel';
    this.label.mesh.raycast = () => {}; // text is not a target
    this.labelEntity = this.world.createTransformEntity(this.label.mesh, { persistent: true });
    this.showIdleText();

    // Mouse click, or a ray pinch / trigger from a distance.
    this.cleanupFuncs.push(this.queries.pressed.subscribe('qualify', () => this.onActivate()));

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        // Hidden or blurred (e.g. the system menu is open): pause until
        // visible again. Entering and leaving XR is handled in update().
        if (state === VisibilityState.Hidden || state === VisibilityState.VisibleBlurred) {
          void music.setAppVisible(false);
        } else if (state === VisibilityState.Visible) {
          void music.setAppVisible(true);
        }
      }),
    );

    const onPageVisibility = () => void music.setAppVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onPageVisibility);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', onPageVisibility));
  }

  update(delta: number, time: number): void {
    try {
      this.tick(delta, time);
    } catch (err) {
      if (!this.reported) console.error('[WholeBall] update failed', err);
      this.reported = true;
    }
  }

  private reported = false;

  private tick(delta: number, time: number): void {
    const presenting = readViewer(this, this.head, this.headQuat);

    if (presenting !== this.wasImmersive) {
      if (import.meta.env.DEV) console.info(`[WholeBall] immersive: ${presenting}`);
      this.wasImmersive = presenting;
      // Re-place for the new viewpoint; in XR wait a few frames for a real head pose.
      this.placed = false;
      this.placeAfterFrames = presenting ? 3 : 0;
      // Leaving XR pauses the music; a click on the ball brings it back.
      if (!presenting && music.started) void music.setAppVisible(false);
    }

    if (!this.placed) {
      if (this.placeAfterFrames > 0) this.placeAfterFrames--;
      else this.placeInFrontOfHead();
    }

    const root = this.ball.root;
    root.getWorldPosition(this.ballPos);
    const state = this.ballEntity.getValue(MusicBall, 'state');

    // While apart, the sections system owns the visuals and each stem's
    // position; this system only keeps the listener on the head.
    const apart = state === BallStates.Apart;
    root.visible = !apart;
    this.label.mesh.visible = !apart;

    if (apart) {
      // nothing to animate on the hidden whole ball
    } else if (state === BallStates.Idle) {
      if (this.handActivated()) this.onActivate();
      if (this.pendingStart && music.loaded) this.startMusic();
      // Gentle breathing glow while silent.
      this.ball.setIntensity(0.12 + 0.1 * Math.sin(time * 1.6));
    } else {
      // Fast attack, slower release, so the ball pulses with the music.
      // Decibel scale: -45 dB (near silence) maps to 0, -15 dB (loud tutti) to 1.
      const db = 20 * Math.log10(music.mixLevel() + 1e-6);
      const target = Math.max(0, Math.min(1, (db + 45) / 30));
      const rate = target > this.level ? 18 : 4;
      this.level += (target - this.level) * Math.min(1, rate * delta);
      this.ball.setIntensity(this.level);
    }

    // Sound comes from the ball; the listener is the head.
    this.audioPos.x = this.ballPos.x;
    this.audioPos.y = this.ballPos.y;
    this.audioPos.z = this.ballPos.z;
    if (!apart) music.setAllPositions(this.audioPos);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.up.set(0, 1, 0).applyQuaternion(this.headQuat);
    this.audioFwd.x = this.forward.x;
    this.audioFwd.y = this.forward.y;
    this.audioFwd.z = this.forward.z;
    this.audioUp.x = this.up.x;
    this.audioUp.y = this.up.y;
    this.audioUp.z = this.up.z;
    this.audioPos.x = this.head.x;
    this.audioPos.y = this.head.y;
    this.audioPos.z = this.head.z;
    music.setListener(this.audioPos, this.audioFwd, this.audioUp);

    // Label floats just above the ball, turned and tilted to face the eyes.
    // (Below a chest-height ball it falls at the bottom edge of the
    // headset's field of view.)
    const lbl = this.label.mesh;
    lbl.position.set(this.ballPos.x, this.ballPos.y + BALL_DIAMETER / 2 + LABEL_GAP, this.ballPos.z);
    faceViewer(lbl, this.head);
  }

  /** Place the ball level with the chest, straight ahead of where the player faces. */
  private placeInFrontOfHead(): void {
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    if (!this.wasImmersive) {
      // Desktop / flat view: centre the ball on the line of sight instead.
      this.ball.root.position.copy(this.head).addScaledVector(this.forward, DESKTOP_DISTANCE);
      this.placed = true;
      return;
    }
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.ball.root.position.set(
      this.head.x + this.forward.x * BALL_FORWARD,
      this.head.y - BALL_BELOW_EYES,
      this.head.z + this.forward.z * BALL_FORWARD,
    );
    this.placed = true;
  }

  /** A fingertip touching the ball, or a pinch / trigger with the hand at the ball. */
  private handActivated(): boolean {
    const radius = BALL_DIAMETER / 2;
    const xr = this.input.xr;
    for (const side of SIDES) {
      this.player.indexTipSpaces[side].getWorldPosition(this.tip);
      const tipDist = this.tip.distanceTo(this.ballPos) - radius;
      if (tipDist < TOUCH_MARGIN && this.tip.lengthSq() > 0) return true;
      if (xr.getSelectState(side).start) {
        this.player.gripSpaces[side].getWorldPosition(this.tip);
        if (Math.min(tipDist, this.tip.distanceTo(this.ballPos) - radius) < PINCH_MARGIN) return true;
      }
    }
    return false;
  }

  private onActivate(): void {
    const state = this.ballEntity.getValue(MusicBall, 'state');
    if (state !== BallStates.Idle) {
      // After a session ended on desktop, a click brings the music back.
      void music.setAppVisible(true);
      return;
    }
    this.pendingStart = true;
    music.unlock(); // harmless inside VR; a real gesture on desktop
    if (music.loaded) this.startMusic();
    else this.label.setText([
      { text: 'Tuning the orchestra…', size: 64 },
      { text: CREDIT, size: 26, colour: '#9a9db0' },
    ]);
  }

  private startMusic(): void {
    this.pendingStart = false;
    music.play();
    this.ballEntity.setValue(MusicBall, 'state', BallStates.Playing);
    this.label.setText([
      { text: 'Take it in both hands and pull.', size: 64 },
      { text: CREDIT, size: 26, colour: '#9a9db0' },
    ]);
  }

  private showIdleText(): void {
    this.label.setText([
      { text: 'Touch the ball to hear the orchestra.', size: 64 },
      { text: CREDIT, size: 26, colour: '#9a9db0' },
    ]);
  }
}
