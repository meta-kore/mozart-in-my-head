// Development-only scripted demo for recording the submission video from the
// IWER emulator. Load the dev page with ?demo (add &mute to rehearse
// silently), click Enter XR, and the emulated hands play through the whole
// experience with smooth, natural movements. Never part of the production
// build.

import type { World } from '@iwsdk/core';

type Vec = [number, number, number];

interface EmulatedHand {
  poseId: string;
  setPin(pin: { anchor: string; target: Vec } | null): void;
  updatePinchValue(v: number): void;
}

interface EmulatedDevice {
  controlMode: 'manual' | 'programmatic';
  primaryInputMode: 'controller' | 'hand';
  position: { set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  hands: { left: EmulatedHand; right: EmulatedHand };
  devui?: { devUIContainer?: HTMLElement };
}

/** The emulator's default eye height; everything is placed relative to it. */
const EYES = 1.6;

const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Run fn(eased t) every frame for `seconds`. */
function tween(seconds: number, fn: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      fn(ease(t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

class Hand {
  private at: Vec;
  private anchor = 'grasp';
  constructor(
    private readonly hand: EmulatedHand,
    rest: Vec,
  ) {
    this.at = rest;
    this.hand.setPin({ anchor: 'wrist', target: rest });
  }
  /** Move a point of the hand (grasp point or fingertip) smoothly to `to`. */
  async move(to: Vec, seconds: number, anchor = this.anchor): Promise<void> {
    const from = this.at;
    this.anchor = anchor;
    await tween(seconds, (t) => this.hand.setPin({ anchor, target: lerp(from, to, t) }));
    this.at = to;
  }
  async pinch(value: number, seconds = 0.25): Promise<void> {
    const v0 = value > 0 ? 0 : 1;
    await tween(seconds, (t) => this.hand.updatePinchValue(v0 + (value - v0) * t));
  }
  pose(id: string): void {
    this.hand.poseId = id;
  }
}

function pos(world: World, name: string): Vec {
  const o = world.scene.getObjectByName(name);
  if (!o) throw new Error(`demo: ${name} not found`);
  return [o.position.x, o.position.y, o.position.z];
}

function lookYaw(d: EmulatedDevice, degrees: number): Promise<void> {
  // Turn the head left (+) or right (-) around the vertical axis, smoothly.
  const target = (degrees * Math.PI) / 180;
  const state = d as unknown as { __yaw?: number };
  const from = state.__yaw ?? 0;
  return tween(0.8, (t) => {
    const a = from + (target - from) * t;
    d.quaternion.set(0, Math.sin(a / 2), 0, Math.cos(a / 2));
    state.__yaw = a;
  });
}

export function installDemo(world: World): void {
  const d = (window as unknown as { IWER_DEVICE?: EmulatedDevice }).IWER_DEVICE;
  if (!d) {
    console.warn('demo: no IWER emulator on this page');
    return;
  }
  // Programmatic control is switched on only once in XR: before that it
  // hides the emulator's Enter XR button.
  console.info('[demo] ready: click Enter XR to start');

  const timer = setInterval(() => {
    if (world.session) {
      clearInterval(timer);
      void run(world, d);
    }
  }, 200);
}

async function run(world: World, d: EmulatedDevice): Promise<void> {
  d.controlMode = 'programmatic';
  // Clean frame for the recording: hide the emulator's control panels.
  if (d.devui?.devUIContainer) d.devui.devUIContainer.style.display = 'none';
  d.primaryInputMode = 'hand';
  const eyes = EYES;
  const L = new Hand(d.hands.left, [-0.2, eyes - 0.55, -0.15]);
  const R = new Hand(d.hands.right, [0.2, eyes - 0.55, -0.15]);
  const restL: Vec = [-0.2, eyes - 0.5, -0.2];
  const restR: Vec = [0.2, eyes - 0.5, -0.2];
  await wait(2.5);

  // 1. Touch the ball: the music starts.
  const ball = pos(world, 'WholeBall');
  R.pose('point');
  await R.move([ball[0] + 0.02, ball[1] + 0.02, ball[2] + 0.14], 1.4, 'index-tip');
  await R.move([ball[0] + 0.01, ball[1] + 0.01, ball[2] + 0.085], 0.5, 'index-tip');
  await wait(0.4);
  await R.move(restR, 1.1, 'grasp');
  R.pose('default');
  await wait(4);

  // 2. Take it in both hands and pull it apart.
  await Promise.all([
    L.move([ball[0] - 0.06, ball[1], ball[2] + 0.02], 1.2, 'index-tip'),
    R.move([ball[0] + 0.06, ball[1], ball[2] + 0.02], 1.2, 'index-tip'),
  ]);
  await Promise.all([L.pinch(1), R.pinch(1)]);
  await wait(0.3);
  await Promise.all([
    L.move([ball[0] - 0.21, ball[1] + 0.02, ball[2] + 0.03], 2.6, 'index-tip'),
    R.move([ball[0] + 0.21, ball[1] + 0.02, ball[2] + 0.03], 2.6, 'index-tip'),
  ]);
  await Promise.all([L.pinch(0), R.pinch(0)]);
  await Promise.all([L.move(restL, 1.2, 'grasp'), R.move(restR, 1.2, 'grasp')]);
  await wait(5);

  // 3. Carry the violas to the right ear: they play alone.
  let p = pos(world, 'Section:violas');
  await R.move(p, 1.3, 'grasp');
  await R.pinch(1);
  await Promise.all([R.move([0.16, eyes - 0.01, -0.03], 2.2), lookYaw(d, 12)]);
  await wait(6);
  await Promise.all([R.move([0.3, eyes - 0.12, -0.36], 1.8), lookYaw(d, 0)]);
  await R.pinch(0);
  await R.move(restR, 1.1);
  await wait(2.5);

  // 4. The first violins to the left ear.
  p = pos(world, 'Section:violins-1');
  await L.move(p, 1.3, 'grasp');
  await L.pinch(1);
  await Promise.all([L.move([-0.16, eyes - 0.01, -0.03], 2.2), lookYaw(d, -12)]);
  await wait(6);
  await Promise.all([L.move([-0.3, eyes - 0.1, -0.38], 1.8), lookYaw(d, 0)]);
  await L.pinch(0);
  await L.move(restL, 1.1);
  await wait(3);

  // 5. Rearrange: lift the horns up high in the middle.
  p = pos(world, 'Section:horns');
  await R.move(p, 1.2, 'grasp');
  await R.pinch(1);
  await R.move([0.02, eyes + 0.05, -0.42], 1.8);
  await R.pinch(0);
  await R.move(restR, 1.1);
  await wait(5);

  // 6. Bring two together: the whole re-forms and floats home.
  p = pos(world, 'Section:clarinets-bassoons');
  const q = pos(world, 'Section:flute-oboes');
  await R.move(p, 1.2, 'grasp');
  await R.pinch(1);
  await R.move(q, 2.0);
  await R.pinch(0);
  await R.move(restR, 1.2);
  await wait(4);

  // 7. One hand: pinch and hold to open it up again.
  const ball2 = pos(world, 'WholeBall');
  await R.move([ball2[0] + 0.05, ball2[1], ball2[2] + 0.02], 1.2, 'index-tip');
  await R.pinch(1);
  await wait(1.9);
  await R.pinch(0);
  await R.move(restR, 1.2, 'grasp');
  await wait(6);
  console.info('[demo] finished');
}
