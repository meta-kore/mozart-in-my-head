import {
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from '@iwsdk/core';

/**
 * Small stylised instrument emblems that float inside each section's ball:
 * a violin (also the viola), a cello, a flute crossed with an oboe, a
 * clarinet crossed with a bassoon, a French horn, a trumpet, and a harp with
 * a kettledrum.
 *
 * Contract for every emblem: origin at its visual centre, +Y up, faces +Z
 * (the player), largest dimension exactly 1 unit (the caller scales it to
 * about 6.5 cm). Parts are named meshes; `userData.tone` is 'body' or
 * 'accent' (strings, keys, rims), so the runtime can bake each emblem into
 * one two-tone mesh. Deterministic and DOM-free: the IWSDK editor evaluates
 * this module too.
 */
export type InstrumentKind =
  | 'violin'
  | 'viola'
  | 'cello'
  | 'flute-oboe'
  | 'clarinet-bassoon'
  | 'horn'
  | 'trumpet'
  | 'harp-timpani';

const bodyMaterial = new MeshStandardMaterial({ color: '#d9c7a4', roughness: 0.55, metalness: 0.1 });
const accentMaterial = new MeshStandardMaterial({ color: '#fff6e0', roughness: 0.3, metalness: 0.4 });

function part(name: string, geometry: BufferGeometry, tone: 'body' | 'accent' = 'body'): Mesh {
  const m = new Mesh(geometry, tone === 'body' ? bodyMaterial : accentMaterial);
  m.name = name;
  m.userData.tone = tone;
  return m;
}

/** A Y-up cylinder spanning a to b. */
function rod(name: string, a: Vector3, b: Vector3, r0: number, r1 = r0, tone: 'body' | 'accent' = 'body', seg = 12): Mesh {
  const len = a.distanceTo(b);
  const m = part(name, new CylinderGeometry(r1, r0, len, seg), tone);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** A turned (lathed) part from a profile of [radius, y] pairs, Y-up. */
function turned(name: string, profile: [number, number][], tone: 'body' | 'accent' = 'body', seg = 24): Mesh {
  return part(name, new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg), tone);
}

/** Fit a group so its largest dimension is 1 and its centre is the origin. */
function normalise(root: Group): Group {
  root.updateMatrixWorld(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      min.min(p);
      max.max(p);
    }
  });
  const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
  const centre = min.add(max).multiplyScalar(0.5);
  const outer = new Group();
  const inner = new Group();
  inner.add(...root.children);
  inner.position.copy(centre).multiplyScalar(-1);
  outer.add(inner);
  outer.scale.setScalar(1 / size);
  outer.name = root.name;
  return outer;
}

/**
 * The violin family's body outline (right half, bottom to top), in units of
 * body length: lower bout, C-bout waist with its corners, upper bout.
 */
const BOUT: [number, number][] = [
  [0.0, 0.0],
  [0.17, 0.02],
  [0.27, 0.11],
  [0.29, 0.24],
  [0.265, 0.37],
  [0.2, 0.455],
  [0.15, 0.53],
  [0.175, 0.605],
  [0.235, 0.71],
  [0.228, 0.85],
  [0.155, 0.955],
  [0.0, 0.99],
];

/** Violin, viola or cello: an arched body, neck, pegbox, scroll, bridge and strings. */
function bowedString(kind: 'violin' | 'viola' | 'cello'): Group {
  const root = new Group();
  root.name = kind === 'cello' ? 'Cello' : kind === 'viola' ? 'Viola' : 'Violin';
  const widen = kind === 'viola' ? 1.06 : 1;
  const depth = kind === 'cello' ? 0.2 : 0.11; // ribs, front to back
  const neckLen = kind === 'cello' ? 0.42 : 0.4;

  const outline = new Shape();
  const right = BOUT.map(([x, y]) => new Vector2(x * widen, y));
  const left = [...BOUT].reverse().slice(1, -1).map(([x, y]) => new Vector2(-x * widen, y));
  outline.moveTo(0, 0);
  outline.splineThru([...right.slice(1), ...left, new Vector2(0, 0)]);
  const bodyGeom = new ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035, // the arching of the plates
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 10,
  });
  bodyGeom.translate(0, 0, -depth / 2);
  root.add(part('Body', bodyGeom));

  const top = depth / 2 + 0.035; // front of the arched top
  // Neck and fingerboard rise from the top block; the fingerboard overhangs the body.
  root.add(rod('Neck', new Vector3(0, 0.97, top - 0.04), new Vector3(0, 0.99 + neckLen, top - 0.035), 0.032, 0.026));
  root.add(rod('Fingerboard', new Vector3(0, 0.72, top + 0.015), new Vector3(0, 0.99 + neckLen * 0.95, top + 0.005), 0.034, 0.026, 'accent', 6));
  const pegTop = 0.99 + neckLen + 0.16;
  root.add(rod('Pegbox', new Vector3(0, 0.99 + neckLen, top - 0.03), new Vector3(0, pegTop, top - 0.045), 0.03, 0.026));
  for (const [i, y] of [0.04, 0.1].entries()) {
    root.add(rod(`Peg${i}`, new Vector3(-0.09, 0.99 + neckLen + y, top - 0.04), new Vector3(0.09, 0.99 + neckLen + y + 0.01, top - 0.04), 0.012, 0.012, 'accent', 8));
  }
  const scroll = part('Scroll', new TorusGeometry(0.045, 0.02, 8, 20, Math.PI * 1.7));
  scroll.position.set(0, pegTop + 0.03, top - 0.05);
  scroll.rotation.y = Math.PI / 2;
  root.add(scroll);

  // Bridge, tailpiece and four strings running over the bridge to the nut.
  root.add(rod('Bridge', new Vector3(-0.075, 0.4, top + 0.03), new Vector3(0.075, 0.4, top + 0.03), 0.014, 0.014, 'accent', 6));
  root.add(rod('Tailpiece', new Vector3(0, 0.05, top + 0.005), new Vector3(0, 0.27, top + 0.02), 0.03, 0.05, 'body', 6));
  for (let s = 0; s < 4; s++) {
    const x = (s - 1.5) * 0.022;
    root.add(rod(`String${s}`, new Vector3(x * 0.8, 0.26, top + 0.025), new Vector3(x * 0.55, 0.99 + neckLen, top + 0.03), 0.004, 0.004, 'accent', 4));
  }
  // The bow crosses in front: a gently curved stick, its hair, and the frog.
  const bowA = new Vector3(-0.42, kind === 'cello' ? 0.02 : 0.1, top + 0.09);
  const bowB = new Vector3(0.42, kind === 'cello' ? 1.12 : 1.2, top + 0.09);
  const bend = bowA.clone().lerp(bowB, 0.5).add(new Vector3(-0.05, 0.04, 0));
  const stick = new CatmullRomCurve3([bowA, bend, bowB]);
  root.add(part('BowStick', new TubeGeometry(stick, 20, 0.011, 6), 'accent'));
  root.add(rod('BowHair', bowA.clone().add(new Vector3(0.035, -0.02, 0)), bowB.clone().add(new Vector3(0.02, -0.025, 0)), 0.005, 0.005, 'accent', 4));
  root.add(rod('BowFrog', bowA.clone().add(new Vector3(0.0, 0.0, 0)), bowA.clone().add(new Vector3(0.045, 0.06, 0)), 0.022, 0.022, 'body', 6));
  if (kind === 'cello') root.add(rod('Endpin', new Vector3(0, 0.0, 0), new Vector3(0, -0.22, 0), 0.012, 0.006, 'accent', 6));
  return normalise(root);
}

/** Key rings along a straight tube from a to b. */
function keys(root: Group, prefix: string, a: Vector3, b: Vector3, radius: number, count: number, from = 0.2, to = 0.85): void {
  const dir = b.clone().sub(a);
  const q = new Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / Math.max(1, count - 1);
    const ring = part(`${prefix}Key${i}`, new TorusGeometry(radius * 1.25, radius * 0.28, 6, 16), 'accent');
    ring.position.copy(a).addScaledVector(dir, t);
    ring.quaternion.setFromUnitVectors(q, dir.clone().normalize());
    root.add(ring);
  }
}

/** A flute crossed with an oboe, like a woodwind emblem. */
function fluteOboe(): Group {
  const root = new Group();
  root.name = 'FluteOboe';
  // Flute: a slim silver tube, lower-left to upper-right, with its keys and lip plate.
  const fa = new Vector3(-0.5, -0.42, 0.04);
  const fb = new Vector3(0.5, 0.42, 0.04);
  root.add(rod('FluteTube', fa, fb, 0.024, 0.024, 'accent', 14));
  keys(root, 'Flute', fa, fb, 0.024, 7, 0.35, 0.85);
  const lip = part('LipPlate', new CylinderGeometry(0.035, 0.035, 0.012, 12), 'accent');
  lip.position.copy(fa).lerp(fb, 0.12).add(new Vector3(0, 0, 0.025));
  lip.rotation.x = Math.PI / 2;
  root.add(lip);
  root.add(rod('FluteCrown', fa.clone().lerp(fb, -0.02), fa, 0.03, 0.03, 'accent', 12));

  // Oboe: a dark conical body, upper-left to lower-right, flaring to a small bell, reed on top.
  const oboe = new Group();
  oboe.name = 'Oboe';
  oboe.add(
    turned('OboeBody', [
      [0.0, -0.5], [0.06, -0.5], [0.055, -0.44], [0.042, -0.36], [0.036, 0.0],
      [0.03, 0.3], [0.024, 0.42], [0.0, 0.42],
    ]),
  );
  oboe.add(rod('OboeStaple', new Vector3(0, 0.42, 0), new Vector3(0, 0.5, 0), 0.01, 0.008, 'accent', 6));
  oboe.add(rod('OboeReed', new Vector3(0, 0.5, 0), new Vector3(0, 0.56, 0), 0.008, 0.016, 'accent', 6));
  keys(oboe, 'Oboe', new Vector3(0, -0.3, 0), new Vector3(0, 0.35, 0), 0.036, 6, 0, 1);
  oboe.rotation.z = Math.PI * 0.23;
  oboe.position.z = -0.03;
  root.add(oboe);
  return normalise(root);
}

/** A clarinet crossed with a bassoon. */
function clarinetBassoon(): Group {
  const root = new Group();
  root.name = 'ClarinetBassoon';
  // Clarinet: mouthpiece, barrel, straight body, flared bell.
  const clarinet = new Group();
  clarinet.name = 'Clarinet';
  clarinet.add(
    turned('ClarinetBody', [
      [0.0, -0.52], [0.11, -0.52], [0.085, -0.47], [0.055, -0.39], [0.04, -0.3],
      [0.036, 0.22], [0.046, 0.25], [0.046, 0.33], [0.034, 0.36], [0.03, 0.46], [0.0, 0.5],
    ]),
  );
  keys(clarinet, 'Clarinet', new Vector3(0, -0.25, 0), new Vector3(0, 0.18, 0), 0.036, 5, 0, 1);
  clarinet.rotation.z = -Math.PI * 0.21;
  clarinet.position.z = 0.04;
  root.add(clarinet);

  // Bassoon: a tall long joint and a shorter wing joint joined at the boot,
  // with the curved metal crook (bocal) and reed.
  const bassoon = new Group();
  bassoon.name = 'Bassoon';
  bassoon.add(rod('LongJoint', new Vector3(0.05, -0.42, 0), new Vector3(0.05, 0.62, 0), 0.05, 0.056, 'body', 16));
  bassoon.add(rod('BellRim', new Vector3(0.05, 0.6, 0), new Vector3(0.05, 0.66, 0), 0.062, 0.062, 'accent', 16));
  bassoon.add(rod('WingJoint', new Vector3(-0.05, -0.42, 0), new Vector3(-0.05, 0.2, 0), 0.04, 0.036, 'body', 14));
  const boot = part('Boot', new CylinderGeometry(0.1, 0.1, 0.16, 16));
  boot.position.set(0, -0.48, 0);
  boot.scale.set(1, 1, 0.6);
  bassoon.add(boot);
  const crook = new CatmullRomCurve3([
    new Vector3(-0.05, 0.2, 0),
    new Vector3(-0.07, 0.3, 0),
    new Vector3(-0.15, 0.38, 0),
    new Vector3(-0.27, 0.38, 0),
  ]);
  bassoon.add(part('Bocal', new TubeGeometry(crook, 16, 0.012, 6), 'accent'));
  bassoon.add(rod('BassoonReed', new Vector3(-0.27, 0.38, 0), new Vector3(-0.33, 0.37, 0), 0.008, 0.016, 'accent', 6));
  bassoon.rotation.z = Math.PI * 0.18;
  bassoon.position.z = -0.04;
  root.add(bassoon);
  return normalise(root);
}

/** A French horn seen from the side: the round coil, valves, and the wide bell. */
function horn(): Group {
  const root = new Group();
  root.name = 'Horn';
  // The coil: a turn and a half of tubing, slowly widening.
  const pts: Vector3[] = [];
  const turns = 1.375; // ends lower left, so the bell flares out to the lower right
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const a = Math.PI * 0.5 + t * turns * Math.PI * 2;
    const r = 0.28 + 0.03 * t;
    pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, (t - 0.5) * 0.08));
  }
  const coil = new CatmullRomCurve3(pts);
  root.add(part('Coil', new TubeGeometry(coil, 96, 0.024, 8), 'body'));
  // Leadpipe and mouthpiece entering the coil at the top.
  root.add(rod('Leadpipe', new Vector3(0, 0.28, -0.04), new Vector3(-0.28, 0.4, -0.04), 0.016, 0.012, 'body', 8));
  root.add(turned('Mouthpiece', [[0, -0.05], [0.03, -0.05], [0.012, 0.0], [0.01, 0.04], [0, 0.04]], 'accent', 12));
  root.children[root.children.length - 1].position.set(-0.3, 0.41, -0.04);
  root.children[root.children.length - 1].rotation.z = Math.PI * 0.37;
  // Three rotary valves sitting on the tubing at the upper right.
  for (let v = 0; v < 3; v++) {
    const at = coil.getPoint(0.82 + v * 0.045);
    root.add(rod(`Valve${v}`, at.clone().add(new Vector3(0, 0, -0.05)), at.clone().add(new Vector3(0, 0, 0.05)), 0.032, 0.032, 'accent', 12));
  }
  // The bell grows out of the coil's end, flaring wide to the lower right.
  const end = coil.getPoint(1);
  const dir = coil.getTangent(1).normalize();
  const bell = turned('Bell', [
    [0.024, 0.0], [0.03, 0.12], [0.045, 0.24], [0.075, 0.33], [0.13, 0.39],
    [0.2, 0.42], [0.21, 0.425], [0.19, 0.415],
  ], 'body', 32);
  bell.position.copy(end);
  bell.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  root.add(bell);
  const rim = part('BellRim', new TorusGeometry(0.205, 0.01, 6, 32), 'accent');
  rim.position.copy(end).addScaledVector(dir, 0.425);
  rim.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir);
  root.add(rim);
  return normalise(root);
}

/** A trumpet seen from the side: mouthpiece, folded tubing, three valves, flared bell. */
function trumpet(): Group {
  const root = new Group();
  root.name = 'Trumpet';
  const r = 0.022;
  // Upper tube: leadpipe from the mouthpiece to the valves.
  root.add(rod('Leadpipe', new Vector3(-0.46, 0.06, 0), new Vector3(0.12, 0.06, 0), 0.015, r, 'body', 10));
  root.add(turned('Mouthpiece', [[0, -0.07], [0.036, -0.07], [0.014, -0.02], [0.012, 0.04], [0, 0.04]], 'accent', 12));
  const mp = root.children[root.children.length - 1];
  mp.position.set(-0.5, 0.06, 0);
  mp.rotation.z = Math.PI / 2;
  // Lower tube: from the valves forward into the bell.
  root.add(rod('BellPipe', new Vector3(-0.22, -0.1, 0), new Vector3(0.2, -0.1, 0), r, r, 'body', 10));
  // U-bends joining the tubes front and back (the tuning slides).
  for (const [name, x, side] of [['FrontBend', 0.2, 1], ['BackBend', -0.22, -1]] as const) {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      pts.push(new Vector3(x + side * Math.cos(a) * 0.08, -0.02 + Math.sin(a) * 0.08 * side, 0));
    }
    root.add(part(name, new TubeGeometry(new CatmullRomCurve3(pts), 16, r, 8), 'body'));
  }
  // Three piston valves standing up between the tubes, with finger buttons.
  for (let v = 0; v < 3; v++) {
    const x = -0.06 + v * 0.07;
    root.add(rod(`Valve${v}`, new Vector3(x, -0.16, 0), new Vector3(x, 0.12, 0), 0.028, 0.028, 'accent', 12));
    root.add(rod(`Button${v}`, new Vector3(x, 0.12, 0), new Vector3(x, 0.2, 0), 0.008, 0.008, 'accent', 6));
    root.add(rod(`Cap${v}`, new Vector3(x, 0.2, 0), new Vector3(x, 0.22, 0), 0.022, 0.022, 'accent', 10));
  }
  // The bell flares out to the right from the upper tube's level.
  root.add(rod('BellNeck', new Vector3(0.12, 0.06, 0), new Vector3(0.2, 0.06, 0), r, r, 'body', 10));
  const bell = turned('Bell', [
    [0.022, 0.0], [0.03, 0.12], [0.05, 0.22], [0.09, 0.28], [0.15, 0.31], [0.155, 0.312], [0.14, 0.305],
  ], 'body', 32);
  bell.position.set(0.2, 0.06, 0);
  bell.rotation.z = -Math.PI / 2;
  root.add(bell);
  const rim = part('BellRim', new TorusGeometry(0.152, 0.008, 6, 32), 'accent');
  rim.position.set(0.512, 0.06, 0);
  rim.rotation.y = Math.PI / 2;
  root.add(rim);
  return normalise(root);
}

/** A concert harp with a small kettledrum (timpani) at its foot. */
function harpTimpani(): Group {
  const root = new Group();
  root.name = 'HarpTimpani';
  // Soundbox: a long tapered box rising from the base towards the neck.
  const sbA = new Vector3(-0.2, -0.46, 0);
  const sbB = new Vector3(0.3, 0.34, 0);
  root.add(rod('Soundbox', sbA, sbB, 0.075, 0.035, 'body', 4));
  // Column: the straight pillar at the front, with a crown at the top.
  root.add(rod('Column', new Vector3(-0.36, -0.46, 0), new Vector3(-0.36, 0.5, 0), 0.026, 0.03, 'body', 10));
  root.add(turned('Crown', [[0, 0], [0.05, 0.0], [0.06, 0.04], [0.04, 0.08], [0, 0.09]], 'accent', 14));
  root.children[root.children.length - 1].position.set(-0.36, 0.5, 0);
  root.add(rod('Base', new Vector3(-0.42, -0.48, 0), new Vector3(-0.12, -0.48, 0), 0.03, 0.03, 'body', 8));
  // Neck: an S-curve from the column top to the soundbox top.
  const neck = new CatmullRomCurve3([
    new Vector3(-0.36, 0.48, 0),
    new Vector3(-0.15, 0.36, 0),
    new Vector3(0.05, 0.44, 0),
    new Vector3(0.22, 0.45, 0),
    new Vector3(0.32, 0.36, 0),
  ]);
  root.add(part('Neck', new TubeGeometry(neck, 32, 0.028, 8), 'body'));
  // Strings: vertical, from the soundbox up to the neck.
  for (let i = 0; i < 11; i++) {
    const x = -0.3 + i * 0.054;
    const t = (x - sbA.x) / (sbB.x - sbA.x);
    if (t < 0.06) continue;
    const yBottom = sbA.y + t * (sbB.y - sbA.y);
    let yTop = 0.45;
    for (let k = 0; k <= 40; k++) {
      const p = neck.getPoint(k / 40);
      if (Math.abs(p.x - x) < 0.02) yTop = Math.min(yTop, p.y - 0.02);
    }
    if (yTop - yBottom < 0.06) continue;
    root.add(rod(`String${i}`, new Vector3(x, yBottom, 0.01), new Vector3(x, yTop, 0.01), 0.005, 0.005, 'accent', 4));
  }
  // The kettledrum, in front at the lower right, with two sticks across it.
  const drum = new Group();
  drum.name = 'Timpani';
  drum.add(turned('Kettle', [[0, -0.16], [0.08, -0.155], [0.15, -0.1], [0.18, -0.02], [0.185, 0.02], [0, 0.02]], 'body', 28));
  drum.add(part('DrumHead', new CylinderGeometry(0.188, 0.188, 0.012, 28), 'accent'));
  drum.add(rod('StickA', new Vector3(-0.12, 0.05, 0.08), new Vector3(0.14, 0.2, 0.05), 0.008, 0.008, 'accent', 6));
  drum.add(rod('StickB', new Vector3(-0.08, 0.2, 0.08), new Vector3(0.16, 0.05, 0.06), 0.008, 0.008, 'accent', 6));
  drum.position.set(0.24, -0.32, 0.18);
  drum.rotation.x = 0.35;
  root.add(drum);
  return normalise(root);
}

/** Build one instrument emblem (largest dimension 1, centred, facing +Z). */
export function buildInstrument(kind: InstrumentKind): Group {
  switch (kind) {
    case 'trumpet':
      return trumpet();
    case 'harp-timpani':
      return harpTimpani();
    case 'violin':
    case 'viola':
    case 'cello':
      return bowedString(kind);
    case 'flute-oboe':
      return fluteOboe();
    case 'clarinet-bassoon':
      return clarinetBassoon();
    case 'horn':
      return horn();
  }
}
