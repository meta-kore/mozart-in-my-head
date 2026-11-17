import {
  AdditiveBlending,
  Color,
  createSystem,
  Entity,
  Grabbed,
  GrabSystem,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { cues, music } from '../audio/app-audio.js';
import { chooseSolo, distanceGain, EAR_OFFSET, SOLO_DUCK, stepDuck } from '../audio/mix.js';
import { BallStates, MusicBall, SectionBall } from '../components.js';
import { mozart40, type Section } from '../music/mozart40.js';
import { Bursts } from '../visuals/burst.js';
import { createTextPanel, type TextPanel } from '../visuals/glow-ball.js';
import { createSectionBall, type SectionBallView } from '../visuals/section-ball.js';
import { Sparks } from '../visuals/sparks.js';
import { faceViewer, readViewer } from './viewer.js';

/** Starting values; tune on a headset. */
const SECTION_DIAMETER = 0.09;
/**
 * Invisible grab volume around each ball. IWSDK's grab only takes a pinch
 * whose grasp point is inside the object, which is fiddly at 9 cm.
 */
const GRAB_ZONE_DIAMETER = 0.14;
/** Horizontal distance from the eyes to the arc of section balls (XR). */
const ARC_RADIUS = 0.42;
/** How far below eye level the arc sits (XR). */
const ARC_BELOW_EYES = 0.22;
/** Total angle the arc spans, left to right (XR). Neighbours end up ~14 cm apart. */
const ARC_SPAN_DEG = 120;
/** Desktop view: a tighter arc further out so it fits the screen. */
const DESKTOP_ARC_RADIUS = 0.62;
const DESKTOP_ARC_BELOW_EYES = 0.2;
const DESKTOP_ARC_SPAN_DEG = 70;
/** Seconds for the balls to fly out on a split, or home on a merge. */
const FLIGHT_SECONDS = 0.9;
/** How far the balls swirl round (radians) as they fly home on a merge. */
const MERGE_SWIRL = 1.6;
/** Bring two section balls this close (centre to centre) and the whole ball re-forms. */
const MERGE_DISTANCE = 0.08;
const LABEL_GAP = 0.035;
/** Every other label sits this much higher, so neighbouring names never overlap. */
const LABEL_STAGGER = 0.045;

/** A note attack: loudness this many dB above its recent average... */
const ONSET_RISE_DB = 9;
/** ...and at least this loud. */
const ONSET_MIN_DB = -40;
/** At most one spark burst per section this often (seconds). */
const SPARK_REFRACTORY = 0.25;
/** While one section is soloed, the others' glow dims to this. */
const DUCKED_GLOW = 0.35;

/** Comfort: a released ball beyond this distance from the head floats back to it. */
const REACH = 0.58;
/** Within this distance of the head (e.g. held at an ear) a ball may sit level with the ears... */
const NEAR_HEAD = 0.3;
/** ...but no further behind them than this. */
const NEAR_HEAD_MIN_FORWARD = -0.08;
/** A ball left behind the player is brought round to this far in front. */
const RETURN_AHEAD = 0.25;
/** Further out than NEAR_HEAD, a ball must sit at least this far in front of the head. */
const MIN_FORWARD = 0.05;
/** How quickly an out-of-reach ball floats back (per second). */
const COMFORT_RATE = 4;

/** Desktop: a click lands on a ball when within this many pixels of its centre. */
const PICK_PIXELS = 42;
/** Desktop: the mouse wheel moves a ball nearer or further, within these distances of the eye. */
const DESKTOP_NEAR = 0.3;
const DESKTOP_FAR = 1.3;

interface SectionView {
  section: Section;
  ball: SectionBallView;
  label: TextPanel;
  /** A ring around the ball while the guide features this section. */
  highlight: Mesh<RingGeometry, MeshBasicMaterial>;
  highlightLevel: number;
  featured: boolean;
  entity: Entity;
  from: Vector3;
  to: Vector3;
  level: number;
  colour: Color;
  /** Current solo-duck multiplier, 1 = not ducked. */
  duck: number;
  /** Slow-moving loudness, to spot note attacks as sudden rises above it. */
  slowDb: number;
  lastSpark: number;
  /** True while floating back into the comfortable zone after a release. */
  returning: boolean;
  returnTo: Vector3;
}

/**
 * The Apart state: seven orchestral sections, each a small glowing ball with
 * its own colour, shape and name, playing from wherever it is. Pinch a ball
 * to move it, hold it to an ear to solo it, bring two together to merge.
 * On a computer, drag with the mouse, scroll to move nearer or further, and
 * click to listen to one alone; the S key splits and merges.
 *
 * Exposes read-only state (grabs, solo, merges, positions) for the guide.
 */
export class SectionsSystem extends createSystem({
  whole: { required: [MusicBall] },
  sections: { required: [SectionBall] },
  held: { required: [SectionBall, Grabbed] },
}) {
  private views: SectionView[] = [];
  private lastState: string = BallStates.Idle;
  /** 0..1 progress of the current flight, or -1 when no flight is running. */
  private flight = -1;
  private merging = false;
  /** Index of the soloed section, or -1. */
  private solo = -1;
  private sparks!: Sparks;
  private bursts!: Bursts;
  private presenting = false;
  private readonly earDistances: number[] = [];
  private readonly earL = new Vector3();
  private readonly earR = new Vector3();

  /** Where the guide's instruction panel goes: above the arc's middle. */
  readonly panelAnchor = new Vector3();
  /** The player's right, horizontal, updated every frame. */
  readonly rightDir = new Vector3(1, 0, 0);
  /** Times a section was picked up (hand, controller or mouse). */
  grabs = 0;
  /** Times the sections were put back together. */
  merges = 0;

  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly wholePos = new Vector3();
  private readonly pos = new Vector3();
  private readonly offset = new Vector3();
  private readonly target = new Vector3();
  private readonly audioPos = { x: 0, y: 0, z: 0 };
  private readonly white = new Color('#ffffff');
  private readonly warm = new Color('#ffe2a8');

  /** Desktop mouse: the ball being dragged, its screen depth, and whether it moved. */
  private dragIndex = -1;
  private dragDepth = 0;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  /** Desktop: the section clicked to be heard alone, or -1. */
  private desktopSolo = -1;
  private readonly ndc = new Vector3();

  init(): void {
    // One invisible material shared by every grab zone: draws nothing, still a mesh.
    const zoneMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const zoneGeometry = new SphereGeometry(GRAB_ZONE_DIAMETER / 2, 10, 6);
    const ringGeometry = new RingGeometry(0.5, 0.535, 48);

    mozart40.sections.forEach((section, index) => {
      const ball = createSectionBall(section, SECTION_DIAMETER);
      ball.root.name = `Section:${section.id}`;
      const zone = new Mesh(zoneGeometry, zoneMaterial);
      zone.name = 'GrabZone';
      ball.root.add(zone);
      ball.root.visible = false;
      const entity = this.world.createTransformEntity(ball.root, { persistent: true });
      entity.addComponent(SectionBall, { index });

      const highlight = new Mesh(
        ringGeometry,
        new MeshBasicMaterial({
          color: section.colour,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      highlight.name = `Highlight:${section.id}`;
      highlight.raycast = () => {};
      highlight.visible = false;
      highlight.scale.setScalar(SECTION_DIAMETER * 1.35);
      this.world.createTransformEntity(highlight, { persistent: true });

      const label = createTextPanel(0.15, 512, 160);
      label.mesh.name = `SectionLabel:${section.id}`;
      label.mesh.raycast = () => {};
      label.mesh.visible = false;
      label.setText([
        { text: section.label, size: 52 },
        { text: section.instruments, size: 34, colour: '#b9bccb' },
      ]);
      this.world.createTransformEntity(label.mesh, { persistent: true });

      this.views.push({
        section,
        ball,
        label,
        highlight,
        highlightLevel: 0,
        featured: false,
        entity,
        from: new Vector3(),
        to: new Vector3(),
        level: 0,
        colour: new Color(section.colour),
        duck: 1,
        slowDb: -60,
        lastSpark: 0,
        returning: false,
        returnTo: new Vector3(),
      });
    });

    this.sparks = new Sparks();
    this.world.createTransformEntity(this.sparks.root, { persistent: true });
    this.bursts = new Bursts();
    this.world.createTransformEntity(this.bursts.root, { persistent: true });

    // A ball that is picked up mid-flight stays with the hand.
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (e) => {
        const v = this.views[e.getValue(SectionBall, 'index') ?? 0];
        v.to.copy(v.ball.root.position);
        v.returning = false;
        this.grabs++;
        this.onPickUp(v);
      }),
      this.queries.held.subscribe('disqualify', (e) => {
        const v = this.views[e.getValue(SectionBall, 'index') ?? 0];
        if (!this.merging) this.onPutDown(v);
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyS' && !e.repeat) this.toggle();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
    this.installMouse();
  }

  /** Index of the section heard alone, or -1. */
  get soloIndex(): number {
    return this.solo;
  }

  /** True while the sections are out and at rest (not flying out or home). */
  get settled(): boolean {
    return this.lastState === BallStates.Apart && this.flight < 0 && !this.merging;
  }

  get immersive(): boolean {
    return this.presenting;
  }

  /** Index of a section by id, or -1. */
  indexOf(id: string): number {
    return this.views.findIndex((v) => v.section.id === id);
  }

  /** How far a section sits to the player's right (metres; negative = left). */
  sideways(index: number): number {
    const p = this.views[index].ball.root.position;
    return (p.x - this.head.x) * this.rightDir.x + (p.z - this.head.z) * this.rightDir.z;
  }

  /** Highlight the sections the guide says carry the music now. */
  setFeatured(ids: readonly string[]): void {
    for (const v of this.views) v.featured = ids.includes(v.section.id);
  }

  /** A little celebration on one section: sparks and a ring. */
  celebrate(index: number): void {
    const v = this.views[index];
    if (!v) return;
    v.ball.root.getWorldPosition(this.pos);
    this.sparks.burst(this.pos, v.colour, 24, 0.35, 0.018, 0.9);
    this.bursts.ring(this.pos, v.colour, 0.05, 0.3, 0.8);
  }

  /** The finale: every colour bursts out from the whole ball. */
  finale(at: Vector3): void {
    for (const v of this.views) this.sparks.burst(at, v.colour, 18, 0.7, 0.022, 1.6);
    this.bursts.flash(at, this.warm, 0.2, 0.9, 0.9, 1);
    this.bursts.ring(at, this.warm, 0.15, 1.2, 1.4, 0.8);
    this.bursts.ring(at, this.white, 0.1, 0.8, 1.1, 0.5);
  }

  /** Split the whole ball into sections, or bring the sections back together. */
  toggle(): void {
    const whole = this.wholeEntity();
    if (!whole) return;
    const state = whole.getValue(MusicBall, 'state');
    if (state === BallStates.Playing) whole.setValue(MusicBall, 'state', BallStates.Apart);
    else if (state === BallStates.Apart && !this.merging) this.beginMerge();
  }

  update(delta: number, time: number): void {
    const whole = this.wholeEntity();
    if (!whole) return;
    const presenting = readViewer(this, this.head, this.headQuat);
    this.presenting = presenting;
    this.right.set(1, 0, 0).applyQuaternion(this.headQuat);
    this.rightDir.set(this.right.x, 0, this.right.z);
    if (this.rightDir.lengthSq() > 1e-6) this.rightDir.normalize();
    this.updateSparkScale();
    const state = whole.getValue(MusicBall, 'state') as string;
    whole.object3D?.getWorldPosition(this.wholePos);

    if (state !== this.lastState) {
      if (state === BallStates.Apart) this.beginSplit(presenting);
      this.lastState = state;
    }
    this.sparks.update(delta);
    this.bursts.update(delta, this.head);
    if (state !== BallStates.Apart) {
      // Whole: every section sounds from the whole ball, at its distance.
      const g = distanceGain(this.wholePos.distanceTo(this.head));
      for (const v of this.views) {
        v.duck = 1;
        music.setGain(v.section.id, v.section.gain * g, 0.03);
      }
      this.solo = -1;
      this.desktopSolo = -1;
      return;
    }

    // Flight out (split) or home (merge), eased, leaving trails of light.
    if (this.flight >= 0) {
      this.flight = Math.min(1, this.flight + delta / FLIGHT_SECONDS);
      const t = this.flight;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const v of this.views) {
        if (v.entity.hasComponent(Grabbed)) continue;
        const p = v.ball.root.position;
        p.lerpVectors(v.from, v.to, e);
        if (this.merging) {
          // Swirl round the meeting point on the way in.
          this.offset.subVectors(p, v.to);
          const a = MERGE_SWIRL * e;
          const c = Math.cos(a);
          const s = Math.sin(a);
          p.set(v.to.x + this.offset.x * c - this.offset.z * s, p.y, v.to.z + this.offset.x * s + this.offset.z * c);
        }
        if (t < 0.97) this.sparks.trail(p, v.colour);
      }
      if (this.flight >= 1) {
        this.flight = -1;
        if (this.merging) {
          this.finishMerge(whole);
          return;
        }
      }
    }

    // Putting it back: any two balls brought together re-form the whole.
    // (With the mouse, only once the dragged ball is let go.)
    if (this.flight < 0 && !this.merging && this.dragIndex < 0 && this.mergeIfTouching(whole)) return;

    // Solo: a ball held near either ear (or, on a computer, clicked); the others duck.
    this.earL.copy(this.head).addScaledVector(this.right, -EAR_OFFSET);
    this.earR.copy(this.head).addScaledVector(this.right, EAR_OFFSET);
    this.views.forEach((v, i) => {
      const p = v.ball.root.position;
      // A ball floating back after a release never solos on the way past an ear.
      this.earDistances[i] = v.returning ? Infinity : Math.min(p.distanceTo(this.earL), p.distanceTo(this.earR));
    });
    const before = this.solo;
    if (this.flight >= 0 || this.merging) this.solo = -1;
    else if (presenting) this.solo = chooseSolo(this.solo, this.earDistances);
    else this.solo = this.desktopSolo;
    if (this.solo >= 0 && this.solo !== before) {
      const v = this.views[this.solo];
      v.ball.root.getWorldPosition(this.pos);
      cues.play('solo', this.pos, v.section.id);
      this.bursts.ring(this.pos, v.colour, 0.06, 0.22, 0.6, 0.6);
    }

    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const root = v.ball.root;
      if (this.flight < 0 && !this.merging && this.presenting && !v.entity.hasComponent(Grabbed)) {
        this.keepInReach(v, delta);
      }
      root.getWorldPosition(this.pos);

      // Volume: the section's balance, its distance from the head, and any solo duck.
      const ducked = this.solo >= 0 && i !== this.solo;
      v.duck = stepDuck(v.duck, ducked ? SOLO_DUCK : 1, delta);
      music.setGain(v.section.id, v.section.gain * distanceGain(this.pos.distanceTo(this.head)) * v.duck, 0.03);

      // Each section sounds from its own ball.
      this.audioPos.x = this.pos.x;
      this.audioPos.y = this.pos.y;
      this.audioPos.z = this.pos.z;
      music.setPosition(v.section.id, this.audioPos);

      // Glow follows this section's own loudness, so you can see who is playing.
      const db = 20 * Math.log10(music.level(v.section.id) + 1e-6);
      const target = Math.max(0, Math.min(1, (db + 48) / 30));
      v.level += (target - v.level) * Math.min(1, (target > v.level ? 20 : 5) * delta);
      v.ball.setIntensity(v.level * (ducked ? DUCKED_GLOW : 1));
      v.ball.animate(time, delta, v.level);

      // A spark for each note attack: a sudden rise above recent loudness.
      if (db - v.slowDb > ONSET_RISE_DB && db > ONSET_MIN_DB && time - v.lastSpark > SPARK_REFRACTORY) {
        this.sparks.emit(this.pos, v.colour, ducked ? 1 : 3);
        v.lastSpark = time;
      }
      v.slowDb += (db - v.slowDb) * Math.min(1, delta / 0.25);

      // The guide's highlight: a slowly breathing ring around featured sections.
      const want = v.featured && this.flight < 0 && !this.merging ? 1 : 0;
      v.highlightLevel += (want - v.highlightLevel) * Math.min(1, 3 * delta);
      const hl = v.highlight;
      hl.visible = v.highlightLevel > 0.01;
      if (hl.visible) {
        hl.position.copy(this.pos);
        hl.lookAt(this.head);
        hl.material.opacity = v.highlightLevel * (0.45 + 0.25 * Math.sin(time * 3 + i)) * (ducked ? 0.5 : 1);
        hl.scale.setScalar(SECTION_DIAMETER * (1.35 + 0.08 * v.level));
      }

      const lbl = v.label.mesh;
      const stagger = i % 2 === 1 ? LABEL_STAGGER : 0;
      lbl.position.set(this.pos.x, this.pos.y + SECTION_DIAMETER / 2 + LABEL_GAP + stagger, this.pos.z);
      faceViewer(lbl, this.head);
    }
  }

  /** Point size for sparks: half the eye buffer's height in pixels. */
  private updateSparkScale(): void {
    const layer = this.world.session?.renderState.baseLayer;
    const h = layer ? layer.framebufferHeight : this.renderer.domElement.height;
    this.sparks.setViewportHalfHeight(h / 2);
  }

  private onPickUp(v: SectionView): void {
    v.ball.root.getWorldPosition(this.pos);
    cues.play('grab', this.pos, v.section.id);
    this.sparks.emit(this.pos, v.colour, 6, 0.05, 0.6);
  }

  private onPutDown(v: SectionView): void {
    v.ball.root.getWorldPosition(this.pos);
    cues.play('release', this.pos, v.section.id);
  }

  /**
   * Comfort: a released ball out of reach or behind the player floats back.
   * Where it goes is decided once, so it travels in one smooth move and
   * never settles somewhere awkward (such as beside an ear) on the way.
   */
  private keepInReach(v: SectionView, delta: number): void {
    const p = v.ball.root.position;
    if (!v.returning) {
      if (!this.comfortTarget(p, this.target)) return;
      v.returnTo.copy(this.target);
      v.returning = true;
    }
    p.lerp(v.returnTo, 1 - Math.exp(-COMFORT_RATE * delta));
    if (p.distanceToSquared(v.returnTo) < 0.005 * 0.005) {
      p.copy(v.returnTo);
      v.returning = false;
    }
  }

  /** Where a ball at `p` should be for comfort; false if it is fine where it is. */
  private comfortTarget(p: Vector3, out: Vector3): boolean {
    out.copy(p);
    this.offset.subVectors(out, this.head);
    let d = this.offset.length();
    const ahead = this.offset.dot(this.fwd);
    if (ahead < NEAR_HEAD_MIN_FORWARD) {
      // Behind the player: bring it round to well in front.
      out.addScaledVector(this.fwd, RETURN_AHEAD - ahead);
    } else if (d > NEAR_HEAD && ahead < MIN_FORWARD) {
      // Out to the side: nudge it forward.
      out.addScaledVector(this.fwd, MIN_FORWARD - ahead);
    }
    this.offset.subVectors(out, this.head);
    d = this.offset.length();
    if (d > REACH) out.copy(this.head).addScaledVector(this.offset, REACH / d);
    return out.distanceToSquared(p) > 0.005 * 0.005;
  }

  private beginSplit(presenting: boolean): void {
    this.merging = false;
    this.desktopSolo = -1;
    const radius = presenting ? ARC_RADIUS : DESKTOP_ARC_RADIUS;
    const below = presenting ? ARC_BELOW_EYES : DESKTOP_ARC_BELOW_EYES;
    const span = ((presenting ? ARC_SPAN_DEG : DESKTOP_ARC_SPAN_DEG) * Math.PI) / 180;

    // Arc around the eyes, centred on where the player faces, left to right
    // in orchestral seating order.
    this.fwd.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.right.set(-this.fwd.z, 0, this.fwd.x);
    this.panelAnchor.copy(this.head).addScaledVector(this.fwd, radius * 1.05);
    this.panelAnchor.y = this.head.y - below + 0.21;

    for (const v of this.views) {
      const a = (v.section.seat * span) / 2;
      v.from.copy(this.wholePos);
      v.to
        .copy(this.head)
        .addScaledVector(this.fwd, Math.cos(a) * radius)
        .addScaledVector(this.right, Math.sin(a) * radius);
      v.to.y = this.head.y - below;
      v.ball.root.position.copy(v.from);
      v.ball.root.visible = true;
      v.label.mesh.visible = true;
      v.level = 0;
      if (!v.entity.hasComponent(OneHandGrabbable)) {
        v.entity.addComponent(OneHandGrabbable, { rotate: false });
      }
    }
    // The whole ball bursts open.
    this.bursts.flash(this.wholePos, this.warm, 0.2, 0.7, 0.45, 1);
    this.bursts.ring(this.wholePos, this.warm, 0.12, 0.9, 0.8, 0.9);
    for (const v of this.views) this.sparks.burst(this.wholePos, v.colour, 8, 0.5, 0.018, 0.9);
    cues.play('split', this.wholePos);
    this.flight = 0;
  }

  /** If two balls touch, re-form the whole ball where they met. Returns true if merging. */
  private mergeIfTouching(whole: Entity): boolean {
    const vs = this.views;
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i].ball.root.position;
        const b = vs[j].ball.root.position;
        if (a.distanceTo(b) < MERGE_DISTANCE) {
          // The whole ball re-forms between them, then drifts home.
          whole.object3D?.position.addVectors(a, b).multiplyScalar(0.5);
          whole.object3D?.getWorldPosition(this.wholePos);
          this.beginMerge();
          return true;
        }
      }
    }
    return false;
  }

  private beginMerge(): void {
    this.endDrag();
    const grab = this.world.getSystem(GrabSystem);
    this.merging = true;
    for (const v of this.views) {
      if (v.entity.hasComponent(Grabbed)) grab?.forceRelease(v.entity);
    }
    for (const v of this.views) {
      if (v.entity.hasComponent(OneHandGrabbable)) v.entity.removeComponent(OneHandGrabbable);
      v.from.copy(v.ball.root.position);
      v.to.copy(this.wholePos);
    }
    this.desktopSolo = -1;
    this.flight = 0;
  }

  private finishMerge(whole: Entity): void {
    this.merging = false;
    this.merges++;
    for (const v of this.views) {
      v.ball.root.visible = false;
      v.label.mesh.visible = false;
      v.highlight.visible = false;
      v.highlightLevel = 0;
    }
    this.bursts.flash(this.wholePos, this.warm, 0.1, 0.45, 0.5, 1);
    this.bursts.ring(this.wholePos, this.warm, 0.5, 0.15, 0.6, 0.7);
    cues.play('merge', this.wholePos);
    whole.setValue(MusicBall, 'state', BallStates.Playing);
    this.lastState = BallStates.Playing;
  }

  private wholeEntity(): Entity | undefined {
    for (const e of this.queries.whole.entities) return e;
    return undefined;
  }

  // ---- Desktop mouse play (no headset) ----

  private installMouse(): void {
    const canvas = this.renderer.domElement;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !this.canUseMouse()) return;
      const i = this.pick(e.clientX, e.clientY);
      if (i < 0) return;
      this.dragIndex = i;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      const v = this.views[i];
      this.ndc.copy(v.ball.root.position).project(this.camera);
      this.dragDepth = this.ndc.z;
      v.returning = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      this.grabs++;
      this.onPickUp(v);
    };
    const move = (e: PointerEvent) => {
      if (!this.canUseMouse()) return;
      if (this.dragIndex < 0) {
        canvas.style.cursor = this.pick(e.clientX, e.clientY) >= 0 ? 'grab' : '';
        return;
      }
      if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 5) this.dragMoved = true;
      if (!this.dragMoved) return;
      this.toNdc(e.clientX, e.clientY, this.dragDepth);
      this.views[this.dragIndex].ball.root.position.copy(this.ndc.unproject(this.camera));
    };
    const up = (e: PointerEvent) => {
      if (this.dragIndex < 0) return;
      const i = this.dragIndex;
      const clicked = !this.dragMoved;
      this.endDrag();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // A click without a drag: hear this section alone (click again to stop).
      if (clicked) this.desktopSolo = this.desktopSolo === i ? -1 : i;
      else this.onPutDown(this.views[i]);
    };
    const wheel = (e: WheelEvent) => {
      if (!this.canUseMouse()) return;
      const i = this.dragIndex >= 0 ? this.dragIndex : this.pick(e.clientX, e.clientY);
      if (i < 0) return;
      e.preventDefault();
      // Scroll moves the ball along the line of sight: nearer is louder.
      const p = this.views[i].ball.root.position;
      this.camera.getWorldPosition(this.target);
      this.offset.subVectors(p, this.target);
      const d = Math.min(DESKTOP_FAR, Math.max(DESKTOP_NEAR, this.offset.length() + e.deltaY * 0.0006));
      p.copy(this.target).addScaledVector(this.offset.normalize(), d);
      if (this.dragIndex === i) this.dragDepth = this.ndc.copy(p).project(this.camera).z;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  private canUseMouse(): boolean {
    return !this.presenting && this.lastState === BallStates.Apart && this.flight < 0 && !this.merging;
  }

  private endDrag(): void {
    this.dragIndex = -1;
    this.renderer.domElement.style.cursor = '';
  }

  private toNdc(clientX: number, clientY: number, z: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, z);
  }

  /** The section ball under the mouse (screen distance to its centre), or -1. */
  private pick(clientX: number, clientY: number): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best = -1;
    let bestDist = PICK_PIXELS;
    this.views.forEach((v, i) => {
      if (!v.ball.root.visible) return;
      this.ndc.copy(v.ball.root.position).project(this.camera);
      if (this.ndc.z > 1) return;
      const x = rect.left + ((this.ndc.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - this.ndc.y) / 2) * rect.height;
      const d = Math.hypot(x - clientX, y - clientY);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }
}
