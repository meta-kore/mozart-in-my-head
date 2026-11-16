import {
  createSystem,
  Entity,
  Grabbed,
  GrabSystem,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { music } from '../audio/app-audio.js';
import { BallStates, MusicBall, SectionBall } from '../components.js';
import { mozart40, type Section } from '../music/mozart40.js';
import { createGlowBall, createTextPanel, type GlowBall, type TextPanel } from '../visuals/glow-ball.js';
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
const FLIGHT_SECONDS = 0.7;
/** Bring two section balls this close (centre to centre) and the whole ball re-forms. */
const MERGE_DISTANCE = 0.08;
const LABEL_GAP = 0.035;
/** Every other label sits this much higher, so neighbouring names never overlap. */
const LABEL_STAGGER = 0.045;

interface SectionView {
  section: Section;
  ball: GlowBall;
  label: TextPanel;
  entity: Entity;
  from: Vector3;
  to: Vector3;
  level: number;
}

/**
 * The Apart state: seven orchestral sections, each a small glowing ball with
 * its own colour and name, playing from wherever it is. Pinch a ball to move
 * it. The split and merge gestures arrive in step 6; until then the S key
 * toggles (also the desktop fallback CLAUDE.md asks for).
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

  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly wholePos = new Vector3();
  private readonly pos = new Vector3();
  private readonly audioPos = { x: 0, y: 0, z: 0 };

  init(): void {
    // One invisible material shared by every grab zone: draws nothing, still a mesh.
    const zoneMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const zoneGeometry = new SphereGeometry(GRAB_ZONE_DIAMETER / 2, 12, 8);

    mozart40.sections.forEach((section, index) => {
      const ball = createGlowBall(SECTION_DIAMETER, section.colour);
      ball.root.name = `Section:${section.id}`;
      const zone = new Mesh(zoneGeometry, zoneMaterial);
      zone.name = 'GrabZone';
      ball.root.add(zone);
      ball.root.visible = false;
      const entity = this.world.createTransformEntity(ball.root, { persistent: true });
      entity.addComponent(SectionBall, { index });

      const label = createTextPanel(0.15, 512, 160);
      label.mesh.name = `SectionLabel:${section.id}`;
      label.mesh.raycast = () => {};
      label.mesh.visible = false;
      label.setText([
        { text: section.label, size: 52 },
        { text: section.instruments, size: 34, colour: '#b9bccb' },
      ]);
      this.world.createTransformEntity(label.mesh, { persistent: true });

      this.views.push({ section, ball, label, entity, from: new Vector3(), to: new Vector3(), level: 0 });
    });

    // A ball that is picked up mid-flight stays with the hand.
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (e) => {
        const v = this.views[e.getValue(SectionBall, 'index') ?? 0];
        v.to.copy(v.ball.root.position);
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyS' && !e.repeat) this.toggle();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
  }

  /** Split the whole ball into sections, or bring the sections back together. */
  toggle(): void {
    const whole = this.wholeEntity();
    if (!whole) return;
    const state = whole.getValue(MusicBall, 'state');
    if (state === BallStates.Playing) whole.setValue(MusicBall, 'state', BallStates.Apart);
    else if (state === BallStates.Apart && !this.merging) this.beginMerge();
  }

  update(delta: number): void {
    const whole = this.wholeEntity();
    if (!whole) return;
    const presenting = readViewer(this, this.head, this.headQuat);
    const state = whole.getValue(MusicBall, 'state') as string;
    whole.object3D?.getWorldPosition(this.wholePos);

    if (state !== this.lastState) {
      if (state === BallStates.Apart) this.beginSplit(presenting);
      this.lastState = state;
    }
    if (state !== BallStates.Apart) return;

    // Flight out (split) or home (merge), eased.
    if (this.flight >= 0) {
      this.flight = Math.min(1, this.flight + delta / FLIGHT_SECONDS);
      const t = this.flight;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const v of this.views) {
        if (v.entity.hasComponent(Grabbed)) continue;
        v.ball.root.position.lerpVectors(v.from, v.to, e);
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
    if (this.flight < 0 && !this.merging && this.mergeIfTouching(whole)) return;

    for (const v of this.views) {
      const root = v.ball.root;
      root.getWorldPosition(this.pos);

      // Each section sounds from its own ball.
      this.audioPos.x = this.pos.x;
      this.audioPos.y = this.pos.y;
      this.audioPos.z = this.pos.z;
      music.setPosition(v.section.id, this.audioPos);

      // Glow follows this section's own loudness, so you can see who is playing.
      const db = 20 * Math.log10(music.level(v.section.id) + 1e-6);
      const target = Math.max(0, Math.min(1, (db + 48) / 30));
      v.level += (target - v.level) * Math.min(1, (target > v.level ? 20 : 5) * delta);
      v.ball.setIntensity(v.level);

      const lbl = v.label.mesh;
      const stagger = this.views.indexOf(v) % 2 === 1 ? LABEL_STAGGER : 0;
      lbl.position.set(this.pos.x, this.pos.y + SECTION_DIAMETER / 2 + LABEL_GAP + stagger, this.pos.z);
      faceViewer(lbl, this.head);
    }
  }

  private beginSplit(presenting: boolean): void {
    this.merging = false;
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
    const grab = this.world.getSystem(GrabSystem);
    for (const v of this.views) {
      if (v.entity.hasComponent(Grabbed)) grab?.forceRelease(v.entity);
    }
    this.merging = true;
    for (const v of this.views) {
      if (v.entity.hasComponent(OneHandGrabbable)) v.entity.removeComponent(OneHandGrabbable);
      v.from.copy(v.ball.root.position);
      v.to.copy(this.wholePos);
    }
    this.flight = 0;
  }

  private finishMerge(whole: Entity): void {
    this.merging = false;
    for (const v of this.views) {
      v.ball.root.visible = false;
      v.label.mesh.visible = false;
    }
    whole.setValue(MusicBall, 'state', BallStates.Playing);
    this.lastState = BallStates.Playing;
  }

  private wholeEntity(): Entity | undefined {
    for (const e of this.queries.whole.entities) return e;
    return undefined;
  }
}
