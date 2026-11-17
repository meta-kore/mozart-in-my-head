import {
  createSystem,
  Entity,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { loadProgress, music } from '../audio/app-audio.js';
import { BallStates, MusicBall } from '../components.js';
import { currentPiece, pieceState } from '../music/piece.js';
import { createTextPanel, type TextLine, type TextPanel } from '../visuals/glow-ball.js';
import { createWholeOrb, type WholeOrb } from '../visuals/whole-orb.js';
import { faceViewer, readViewer } from './viewer.js';

/** Starting values from CLAUDE.md; tune on a headset. */
const BALL_DIAMETER = 0.18;
/** Horizontal distance from the eyes to the ball. */
const BALL_FORWARD = 0.45;
/** How far below eye level the ball floats (roughly chest height). */
const BALL_BELOW_EYES = 0.3;
/** Space between the top of the ball and the hint text's centre. */
const LABEL_GAP = 0.1;
/** Outside XR (desktop development), distance along the line of sight. */
const DESKTOP_DISTANCE = 0.85;
/** A fingertip this close to the ball's surface counts as a touch. */
const TOUCH_MARGIN = 0.015;
/** A pinch or trigger press counts when the hand is this close to the ball's surface. */
const PINCH_MARGIN = 0.12;
/** A pinch counts as holding the whole ball when the fingertip is within this of its surface. */
const HOLD_MARGIN = 0.04;
/** Hands this far apart (pinch points) while both hold the ball split it. */
const SPLIT_DISTANCE = 0.35;
/** One-handed split: hold a pinch on the ball this long. */
const ONE_HAND_HOLD_SECONDS = 1.5;
/** Furthest the ball stretches along the hands' axis. */
const MAX_STRETCH = 2.4;
/** How quickly the ball springs back home when let go (per second). */
const SPRING_RATE = 7;
/** The current piece's credit, under every message on the label. */
const CREDIT_LINE: TextLine = { text: '', size: 24, colour: '#9a9db0', gap: 0.5 };
const GOLD = '#f3d9a4';

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
  private ball!: WholeOrb;
  /** Each section's loudness (0..1), for the lights inside the orb. */
  private readonly levels: number[] = currentPiece().piece.sections.map(() => 0);
  private pieceVersion = -1;
  private label!: TextPanel;
  private ballEntity!: Entity;
  private labelEntity!: Entity;

  private placed = false;
  /** Frames to wait after entering XR before trusting the head pose. */
  private placeAfterFrames = 0;
  private wasImmersive = false;
  private pendingStart = false;
  private level = 0;

  /** Where the ball rests in front of the chest; it drifts back here when let go. */
  private readonly rest = new Vector3();
  /** Which hands currently hold the whole ball (pinch began on it). */
  private readonly holding = { left: false, right: false };
  private holdSeconds = 0;
  private bothStartDistance = 0;
  private wasBoth = false;
  /** 0..1, how close the current pull or hold is to splitting. */
  private splitProgress = 0;
  private hintShown: 'pull' | 'hold' | 'click' | null = null;
  /** What the idle label shows: a loading count, or the invitation (and for which input). */
  private idleShown = '';
  private readonly tipL = new Vector3();
  private readonly tipR = new Vector3();
  private readonly axis = new Vector3();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly targetQuat = new Quaternion();
  private readonly identityQuat = new Quaternion();

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
    this.ball = createWholeOrb(BALL_DIAMETER, currentPiece().piece.sections.map((s) => s.colour));
    CREDIT_LINE.text = currentPiece().creditLine;
    this.pieceVersion = pieceState.version;
    this.ball.root.name = 'WholeBall';
    this.ballEntity = this.world.createTransformEntity(this.ball.root, { persistent: true });
    this.ballEntity.addComponent(MusicBall, { state: BallStates.Idle, diameter: BALL_DIAMETER });
    this.ballEntity.addComponent(RayInteractable);

    this.label = createTextPanel(0.44, 1024, 330, { plate: true });
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
    if (this.pieceVersion !== pieceState.version) this.onPieceChanged();

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
      // Hidden: reset its shape. Its position is left alone, because a merge
      // re-forms the whole ball where two sections met.
      root.scale.setScalar(1);
      root.quaternion.identity();
      this.holding.left = this.holding.right = false;
      this.holdSeconds = 0;
      this.wasBoth = false;
      this.splitProgress = 0;
    } else if (state === BallStates.Idle) {
      if (this.handActivated()) this.onActivate();
      if (this.pendingStart && music.loaded) this.startMusic();
      else this.showIdleText();
      // Gentle breathing glow while silent.
      this.ball.setIntensity(0.12 + 0.1 * Math.sin(time * 1.6));
      for (let i = 0; i < this.levels.length; i++) this.levels[i] = 0.15 + 0.1 * Math.sin(time * 1.3 + i);
      this.ball.animate(time, delta, this.levels);
    } else {
      // Fast attack, slower release, so the ball pulses with the music.
      // Decibel scale: -45 dB (near silence) maps to 0, -15 dB (loud tutti) to 1.
      const db = 20 * Math.log10(music.mixLevel() + 1e-6);
      const target = Math.max(0, Math.min(1, (db + 45) / 30));
      const rate = target > this.level ? 18 : 4;
      this.level += (target - this.level) * Math.min(1, rate * delta);
      this.updateGestures(delta);
      // The pull or hold brightens the ball on top of the music's pulse.
      this.ball.setIntensity(Math.min(1, this.level + 0.8 * this.splitProgress));
      for (let i = 0; i < this.levels.length; i++) {
        const sdb = 20 * Math.log10(music.level(currentPiece().piece.sections[i].id) + 1e-6);
        this.levels[i] = Math.max(0, Math.min(1, (sdb + 48) / 30));
      }
      this.ball.animate(time, delta, this.levels);
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
      this.rest.copy(this.ball.root.position);
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
    this.rest.copy(this.ball.root.position);
    this.placed = true;
  }

  /**
   * Playing state: the two-hand pull and the one-hand hold.
   * A hand holds the ball if its pinch (or trigger) began with the fingertip
   * on or inside the ball, and keeps holding until it lets go.
   */
  private updateGestures(delta: number): void {
    const xr = this.input.xr;
    const root = this.ball.root;
    const reach = BALL_DIAMETER / 2 + HOLD_MARGIN;
    this.player.indexTipSpaces.left.getWorldPosition(this.tipL);
    this.player.indexTipSpaces.right.getWorldPosition(this.tipR);

    for (const side of SIDES) {
      const sel = xr.getSelectState(side);
      const tip = side === 'left' ? this.tipL : this.tipR;
      if (sel.start && tip.lengthSq() > 0 && tip.distanceTo(this.ballPos) < reach) this.holding[side] = true;
      if (!sel.active) this.holding[side] = false;
    }

    const both = this.holding.left && this.holding.right;
    const one = this.holding.left !== this.holding.right;

    if (both) {
      const d = this.tipL.distanceTo(this.tipR);
      if (!this.wasBoth) {
        this.bothStartDistance = Math.min(d, SPLIT_DISTANCE * 0.8);
        this.wasBoth = true;
      }
      this.holdSeconds = 0;
      // The ball sits between the hands and stretches along the line joining them.
      root.position.addVectors(this.tipL, this.tipR).multiplyScalar(0.5);
      this.axis.subVectors(this.tipR, this.tipL);
      if (this.axis.lengthSq() > 1e-6) {
        this.targetQuat.setFromUnitVectors(this.yAxis, this.axis.normalize());
        root.quaternion.copy(this.targetQuat);
      }
      const stretch = Math.min(MAX_STRETCH, Math.max(1, d / BALL_DIAMETER));
      const thin = 1 / Math.sqrt(stretch);
      root.scale.set(thin, stretch, thin);
      this.splitProgress = Math.max(0, Math.min(1, (d - this.bothStartDistance) / (SPLIT_DISTANCE - this.bothStartDistance)));
      this.setHint('pull');
      if (d >= SPLIT_DISTANCE) this.split();
      return;
    }

    this.wasBoth = false;
    if (one) {
      this.holdSeconds += delta;
      this.splitProgress = Math.min(1, this.holdSeconds / ONE_HAND_HOLD_SECONDS);
      this.setHint('hold');
      if (this.holdSeconds >= ONE_HAND_HOLD_SECONDS) this.split();
    } else {
      this.holdSeconds = 0;
      this.splitProgress = 0;
      this.setHint('pull');
    }

    // Not held by both hands: spring back to its round shape and home position.
    const k = 1 - Math.exp(-SPRING_RATE * delta);
    root.position.lerp(this.rest, k);
    root.quaternion.slerp(this.identityQuat, k);
    const sy = root.scale.y + (1 - root.scale.y) * k;
    const sx = root.scale.x + (1 - root.scale.x) * k;
    root.scale.set(sx, sy, sx);
  }

  /** Open the whole ball into its sections, from where it is now. */
  private split(): void {
    this.holding.left = this.holding.right = false;
    this.holdSeconds = 0;
    this.wasBoth = false;
    this.splitProgress = 0;
    this.ballEntity.setValue(MusicBall, 'state', BallStates.Apart);
  }

  private setHint(kind: 'pull' | 'hold' | 'click'): void {
    // On a computer there are no hands: invite a click instead.
    if (kind === 'pull' && !this.wasImmersive) kind = 'click';
    if (this.hintShown === kind) return;
    this.hintShown = kind;
    const lines: Record<typeof kind, TextLine[]> = {
      hold: [{ text: 'Keep holding to open it up…', size: 60 }, CREDIT_LINE],
      pull: [
        { text: 'Take it in both hands and pull.', size: 60 },
        { text: 'or pinch and hold it with one hand', size: 38, colour: '#c9cbd8' },
        CREDIT_LINE,
      ],
      click: [
        { text: 'Click the ball to open it up.', size: 60 },
        { text: 'In a headset: take it in both hands and pull.', size: 38, colour: '#c9cbd8' },
        CREDIT_LINE,
      ],
    };
    this.label.setText(lines[kind]);
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
      // After a session ended on desktop, a click brings the music back...
      void music.setAppVisible(true);
      // ...and on a computer, clicking the playing ball opens it up.
      if (state === BallStates.Playing && !this.world.session) this.split();
      return;
    }
    this.pendingStart = true;
    music.unlock(); // harmless inside VR; a real gesture on desktop
    if (music.loaded) this.startMusic();
    else this.label.setText([
      { text: 'Tuning the orchestra…', size: 60 },
      { text: 'The music starts in a moment.', size: 38, colour: '#c9cbd8' },
      CREDIT_LINE,
    ]);
  }

  private startMusic(): void {
    this.pendingStart = false;
    music.play();
    this.ballEntity.setValue(MusicBall, 'state', BallStates.Playing);
    this.hintShown = null;
    this.setHint('pull');
  }

  /**
   * Another piece was chosen: the orb takes its colours, and the new music
   * starts by itself once its stems have loaded (the player already chose).
   */
  private onPieceChanged(): void {
    this.pieceVersion = pieceState.version;
    const piece = currentPiece();
    CREDIT_LINE.text = piece.creditLine;
    this.ball.setColours(piece.piece.sections.map((s) => s.colour));
    const state = this.ballEntity.getValue(MusicBall, 'state');
    const wasStarted = state !== BallStates.Idle;
    if (state === BallStates.Apart) return; // the picker is hidden while apart
    this.ballEntity.setValue(MusicBall, 'state', BallStates.Idle);
    this.pendingStart = wasStarted;
    this.idleShown = '';
    this.hintShown = null;
    this.showIdleText();
  }

  /** The invitation, or loading progress while the music is still arriving. */
  private showIdleText(): void {
    const desk = !this.wasImmersive;
    const key = loadProgress.failed ? 'failed' : music.loaded ? (desk ? 'desk' : 'xr') : `load${loadProgress.done}`;
    if (key === this.idleShown) return;
    this.idleShown = key;
    const title: TextLine = { text: 'Mozart in My Head', size: 84, font: 'serif', weight: 600, colour: GOLD };
    if (loadProgress.failed) {
      this.label.setText([title, { text: 'The music could not load. Please reload the page.', size: 40 }, CREDIT_LINE]);
    } else if (!music.loaded) {
      this.label.setText([
        title,
        { text: `Tuning the orchestra… ${loadProgress.done} of ${loadProgress.total}`, size: 44 },
        CREDIT_LINE,
      ]);
    } else {
      this.label.setText([
        title,
        { text: desk ? 'Click the ball to hear the orchestra.' : 'Touch the ball to hear the orchestra.', size: 44 },
        CREDIT_LINE,
      ]);
    }
  }
}
