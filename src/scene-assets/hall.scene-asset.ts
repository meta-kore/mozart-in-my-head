import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from '@iwsdk/core';

/** Small deterministic random numbers (mulberry32), so the hall is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A quiet, dimly lit concert hall around the player, who sits at the
 * conductor's place at the front of the stage, facing -Z:
 * - ahead, the empty chairs and music stands of an orchestra in rising
 *   semicircles, with an organ on the back wall;
 * - wood-panelled side walls with warm wall lamps, acoustic reflectors overhead;
 * - behind, the stage edge and the raked rows of the audience.
 *
 * Lighting is baked into vertex colours (unlit material), so the whole hall is
 * two draw calls: one solid mesh and one mesh of soft additive lamp glows.
 * Deterministic and DOM-free (the IWSDK editor evaluates this module too).
 * Origin: the player's seat on the stage floor. Units: metres.
 */

/** Hall extents. */
const HALF_WIDTH = 11;
const BACK_WALL_Z = -9.5;
const REAR_WALL_Z = 21;
const CEILING_Y = 12.5;
/** The stage floor is at y = 0 and ends just behind the conductor. */
const STAGE_EDGE_Z = 1.6;
const AUDIENCE_FLOOR_Y = -1.0;

// ---- Baked lighting ----

interface BakedLight {
  pos: Vector3;
  colour: Color;
  power: number;
  /** Distance at which the light falls to a quarter. */
  reach: number;
}

const AMBIENT = new Color(0.06, 0.062, 0.085);
const LIGHTS: BakedLight[] = [
  // Warm stage wash from above, centred on the orchestra.
  { pos: new Vector3(0, 9, -3.5), colour: new Color(1.0, 0.8, 0.58), power: 1.6, reach: 8 },
  // A softer pool where the player sits.
  { pos: new Vector3(0, 6, 0.5), colour: new Color(0.95, 0.82, 0.66), power: 0.5, reach: 4 },
  // The organ, lit from below.
  { pos: new Vector3(0, 1.5, -7.5), colour: new Color(1.0, 0.75, 0.45), power: 0.6, reach: 5 },
  // Dim house lights over the audience.
  { pos: new Vector3(0, 9, 11), colour: new Color(0.7, 0.72, 0.9), power: 0.35, reach: 10 },
];
/** Wall lamps, also baked as small lights (and drawn as glows). */
const LAMPS: Vector3[] = [];
for (const side of [-1, 1]) {
  for (const z of [-7, -2.5, 2, 6.5, 11, 15.5]) LAMPS.push(new Vector3(side * (HALF_WIDTH - 0.12), 3.6, z));
}
const LAMP_COLOUR = new Color(1.0, 0.72, 0.42);

function lightAt(p: Vector3, n: Vector3, out: Color): Color {
  out.copy(AMBIENT);
  const d = new Vector3();
  const add = (pos: Vector3, colour: Color, power: number, reach: number) => {
    d.subVectors(pos, p);
    const dist = d.length();
    const lambert = Math.max(0, n.dot(d.divideScalar(dist || 1)));
    const fall = 1 / (1 + 3 * (dist / reach) * (dist / reach));
    const k = power * (0.25 + 0.75 * lambert) * fall;
    out.r += colour.r * k;
    out.g += colour.g * k;
    out.b += colour.b * k;
  };
  for (const l of LIGHTS) add(l.pos, l.colour, l.power, l.reach);
  for (const l of LAMPS) add(l, LAMP_COLOUR, 0.6, 2.2);
  return out;
}

// ---- A builder that merges every part into one lit, vertex-coloured mesh ----

class Builder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly m = new Matrix4();
  private readonly nm = new Matrix3();
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly c = new Color();

  /** Add a geometry, transformed, in an albedo colour lit by the baked lights. */
  add(geometry: BufferGeometry, albedo: Color, position: Vector3, rotationY = 0, scale?: Vector3, emissive = 0): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    this.m.compose(position, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotationY), scale ?? new Vector3(1, 1, 1));
    this.nm.getNormalMatrix(this.m);
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      this.p.fromBufferAttribute(pa, i).applyMatrix4(this.m);
      this.n.fromBufferAttribute(na, i).applyMatrix3(this.nm).normalize();
      lightAt(this.p, this.n, this.c);
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.col.push(
        Math.min(1, albedo.r * this.c.r + emissive * albedo.r),
        Math.min(1, albedo.g * this.c.g + emissive * albedo.g),
        Math.min(1, albedo.b * this.c.b + emissive * albedo.b),
      );
    }
    if (g !== geometry) g.dispose();
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, albedo: Color, rotY = 0, emissive = 0): void {
    this.add(unitBox, albedo, new Vector3(cx, cy, cz), rotY, new Vector3(sx, sy, sz), emissive);
  }

  build(name: string): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    const mesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true }));
    mesh.name = name;
    return mesh;
  }
}

const unitBox = new BoxGeometry(1, 1, 1);

const WOOD_DARK = new Color('#3a2516');
const WOOD = new Color('#6b4428');
const WOOD_LIGHT = new Color('#8a5a34');
const PLUSH = new Color('#5a1620');
const WALL = new Color('#4a3a33');
const CEILING = new Color('#2a2630');
const GILT = new Color('#b8924f');
const BLACK = new Color('#141218');

/** Stage floor: long planks running towards the back, each a slightly different tone. */
function stageFloor(b: Builder, rand: () => number): void {
  const plank = 0.22;
  for (let x = -HALF_WIDTH; x < HALF_WIDTH; x += plank) {
    const tone = WOOD.clone().multiplyScalar(0.85 + rand() * 0.3);
    // Split each plank lengthwise so the baked light varies along it.
    for (let z = BACK_WALL_Z; z < STAGE_EDGE_Z; z += 1.0) {
      const len = Math.min(1.0, STAGE_EDGE_Z - z);
      b.box(x + plank / 2, -0.02, z + len / 2, plank - 0.006, 0.04, len, tone);
    }
  }
  // The stage front drops to the audience floor behind the player.
  b.box(0, (AUDIENCE_FLOOR_Y - 0.04) / 2, STAGE_EDGE_Z + 0.03, HALF_WIDTH * 2, -AUDIENCE_FLOOR_Y, 0.06, WOOD_DARK);
}

/** One empty orchestra chair facing the conductor (local +Z faces the player). */
function chair(b: Builder, x: number, y: number, z: number, rotY: number): void {
  const at = (lx: number, ly: number, lz: number) => {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c] as const;
  };
  const part = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: Color) => {
    const [px, py, pz] = at(lx, ly, lz);
    b.box(px, py, pz, sx, sy, sz, col, rotY);
  };
  part(0, 0.46, 0, 0.44, 0.06, 0.42, PLUSH); // seat
  part(0, 0.78, -0.2, 0.44, 0.5, 0.05, PLUSH); // back
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.17], [0.19, 0.17]] as const) {
    part(lx, 0.22, lz, 0.035, 0.44, 0.035, BLACK); // legs
  }
}

/** A music stand between the chair and the conductor. */
function stand(b: Builder, x: number, y: number, z: number, rotY: number): void {
  b.box(x, y + 0.45, z, 0.025, 0.9, 0.025, BLACK);
  b.box(x, y + 0.92, z, 0.46, 0.3, 0.02, WOOD_DARK, rotY);
  b.box(x, y + 0.02, z, 0.36, 0.03, 0.36, BLACK, rotY);
}

/**
 * The orchestra's empty seats: rising semicircles around the conductor,
 * strings in front, winds and horns behind on risers.
 */
function orchestra(b: Builder): void {
  const rows = [
    { r: 2.7, y: 0, count: 12 },
    { r: 3.8, y: 0.25, count: 15 },
    { r: 4.9, y: 0.5, count: 16 },
    { r: 6.0, y: 0.75, count: 14 },
  ];
  const span = (130 * Math.PI) / 180;
  for (const row of rows) {
    // The riser under this row: a curved step built from short straight pieces.
    if (row.y > 0) {
      const pieces = 36;
      for (let i = 0; i < pieces; i++) {
        const a = -span / 2 - 0.08 + ((span + 0.16) * (i + 0.5)) / pieces;
        const rx = Math.sin(a) * (row.r - 0.1);
        const rz = -Math.cos(a) * (row.r - 0.1);
        const w = ((span + 0.16) / pieces) * (row.r - 0.1) + 0.02;
        b.box(rx, row.y / 2, rz, w, row.y, 1.1, WOOD_DARK, -a);
      }
    }
    for (let i = 0; i < row.count; i++) {
      const a = -span / 2 + (span * (i + 0.5)) / row.count;
      const x = Math.sin(a) * row.r;
      const z = -Math.cos(a) * row.r;
      // Face the conductor at the origin.
      chair(b, x, row.y, z, -a);
      stand(b, Math.sin(a) * (row.r - 0.55), row.y, -Math.cos(a) * (row.r - 0.55), -a);
    }
  }
  // The conductor's podium under the player.
  b.box(0, 0.06, 0, 0.9, 0.12, 0.9, WOOD_DARK);
}

/** Panelled side walls with vertical ribs, the back wall, the rear wall and the ceiling. */
function shell(b: Builder, rand: () => number): void {
  const length = REAR_WALL_Z - BACK_WALL_Z;
  const midZ = (REAR_WALL_Z + BACK_WALL_Z) / 2;
  const bottom = AUDIENCE_FLOOR_Y;
  const height = CEILING_Y - bottom;
  for (const side of [-1, 1]) {
    // Panels in a grid, so the baked light varies across the wall.
    for (let z = BACK_WALL_Z; z < REAR_WALL_Z; z += 1.5) {
      for (let y = bottom; y < CEILING_Y; y += 1.5) {
        const tone = (y < 3 ? WOOD : WALL).clone().multiplyScalar(0.9 + rand() * 0.2);
        b.box(side * (HALF_WIDTH + 0.1), y + 0.75, z + 0.75, 0.2, 1.48, 1.48, tone);
      }
      // A vertical rib between bays.
      b.box(side * (HALF_WIDTH - 0.05), bottom + height / 2, z, 0.16, height, 0.14, WOOD_DARK);
    }
    // Dado rail and a gilt cornice.
    b.box(side * (HALF_WIDTH - 0.04), 2.9, midZ, 0.08, 0.08, length, GILT);
    b.box(side * (HALF_WIDTH - 0.1), CEILING_Y - 0.3, midZ, 0.2, 0.25, length, GILT);
  }
  // Back wall (behind the orchestra) and rear wall (behind the audience).
  for (let x = -HALF_WIDTH; x < HALF_WIDTH; x += 1.5) {
    for (let y = bottom; y < CEILING_Y; y += 1.5) {
      b.box(x + 0.75, y + 0.75, BACK_WALL_Z - 0.1, 1.48, 1.48, 0.2, (y < 3 ? WOOD : WALL).clone().multiplyScalar(0.9 + rand() * 0.2));
      b.box(x + 0.75, y + 0.75, REAR_WALL_Z + 0.1, 1.48, 1.48, 0.2, WALL);
    }
  }
  // Coffered ceiling.
  for (let x = -HALF_WIDTH; x < HALF_WIDTH; x += 2) {
    for (let z = BACK_WALL_Z; z < REAR_WALL_Z; z += 2) {
      b.box(x + 1, CEILING_Y + 0.1, z + 1, 1.96, 0.2, 1.96, CEILING);
    }
  }
}

/** A pipe organ on the back wall above the orchestra: a wooden case and gilt pipes. */
function organ(b: Builder): void {
  const z = BACK_WALL_Z + 0.5;
  b.box(0, 1.6, z - 0.15, 12.5, 3.2, 0.8, WOOD_DARK); // case base
  b.box(0, 3.25, z + 0.2, 12.8, 0.12, 0.5, GILT); // moulding
  const pipe = new CylinderGeometry(1, 1, 1, 14, 1, false);
  const towers = [-5, -2.6, 0, 2.6, 5];
  let i = 0;
  for (let x = -5.9; x <= 5.91; x += 0.3, i++) {
    // Pipes rise to five towers, the tallest in the middle.
    let h = 2.2;
    for (const t of towers) h = Math.max(h, 6.2 - Math.abs(x - t) * 1.6 - Math.abs(t) * 0.22);
    const r = 0.07 + 0.04 * (h / 6.2);
    b.add(pipe, GILT, new Vector3(x, 3.3 + h / 2, z + 0.1 + (i % 2) * 0.12), 0, new Vector3(r, h, r));
    // The pipe's mouth: a dark notch near its foot.
    b.box(x, 3.6, z + 0.1 + (i % 2) * 0.12 + r, r * 1.2, 0.12, 0.02, BLACK);
  }
}

/** Acoustic reflectors hanging over the stage. */
function reflectors(b: Builder): void {
  const disc = new CylinderGeometry(1, 1, 0.06, 6);
  for (const [x, z, r] of [[-4, -3, 1.5], [0, -1, 1.8], [4, -3, 1.5], [-2.2, -6, 1.3], [2.2, -6, 1.3], [0, 3.5, 1.4]] as const) {
    b.add(disc, WALL, new Vector3(x, 8.6, z), 0.3, new Vector3(r, 1, r));
    b.box(x, 10.6, z, 0.02, 4, 0.02, BLACK);
  }
}

/** The audience: raked rows of plush seats behind the conductor. */
function audience(b: Builder): void {
  for (let row = 0; row < 14; row++) {
    const z = STAGE_EDGE_Z + 2.2 + row * 1.0;
    const y = AUDIENCE_FLOOR_Y + row * 0.18;
    // Tread for this row (and the riser under it).
    b.box(0, y - 0.1, z, HALF_WIDTH * 2, 0.2 + row * 0.18, 1.0, WOOD_DARK);
    for (let x = -HALF_WIDTH + 1.4; x < HALF_WIDTH - 1.3; x += 0.6) {
      if (Math.abs(x) < 0.6) continue; // centre aisle
      b.box(x, y + 0.42, z - 0.1, 0.52, 0.12, 0.48, PLUSH); // seat
      b.box(x, y + 0.75, z + 0.18, 0.52, 0.6, 0.1, PLUSH); // back
    }
  }
  // The floor between the stage edge and the first row.
  b.box(0, AUDIENCE_FLOOR_Y - 0.05, STAGE_EDGE_Z + 0.9, HALF_WIDTH * 2, 0.1, 1.8, WOOD_DARK);
}

/** Wall lamps: small glowing shades on brackets (in the solid mesh). */
function lampFixtures(b: Builder): void {
  for (const l of LAMPS) {
    const side = Math.sign(l.x);
    b.box(l.x - side * 0.08, l.y - 0.12, l.z, 0.16, 0.04, 0.04, GILT);
    b.box(l.x - side * 0.16, l.y, l.z, 0.16, 0.22, 0.16, LAMP_COLOUR, 0, 1.4);
  }
}

/** Soft halos around each lamp, drawn additively in one mesh. */
function lampGlows(): Mesh {
  const disc = new CircleGeometry(1, 24);
  const pa = disc.getAttribute('position');
  const positions: number[] = [];
  const colours: number[] = [];
  const index = disc.index!;
  const v = new Vector3();
  const halo = (centre: Vector3, normalX: number, radius: number, strength: number) => {
    for (let i = 0; i < index.count; i++) {
      const k = index.getX(i);
      v.fromBufferAttribute(pa, k);
      const fade = Math.pow(Math.max(0, 1 - Math.hypot(v.x, v.y)), 2) * strength;
      // The disc lies in the wall's plane, facing into the hall.
      positions.push(centre.x + normalX * 0.02, centre.y + v.y * radius, centre.z + v.x * radius);
      colours.push(LAMP_COLOUR.r * fade, LAMP_COLOUR.g * fade, LAMP_COLOUR.b * fade);
    }
  };
  for (const l of LAMPS) {
    const side = Math.sign(l.x);
    halo(new Vector3(l.x - side * 0.05, l.y + 0.2, l.z), -side, 1.1, 0.32);
    halo(new Vector3(l.x - side * 0.06, l.y, l.z), -side, 0.4, 0.55);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  g.computeBoundingSphere();
  const mesh = new Mesh(
    g,
    new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: 2 }),
  );
  mesh.name = 'LampGlows';
  mesh.userData.iwsdkPreviewBounds = 'exclude';
  return mesh;
}

/** The whole hall, origin at the conductor's place on the stage floor, facing -Z. */
export function createConcertHall(): Group {
  const rand = seeded(40);
  const b = new Builder();
  stageFloor(b, rand);
  orchestra(b);
  shell(b, rand);
  organ(b);
  reflectors(b);
  audience(b);
  lampFixtures(b);
  const solid = b.build('HallSolid');
  const root = new Group();
  root.name = 'ConcertHall';
  root.add(solid, lampGlows());
  // Decoration only: never a pointer or grab target.
  root.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).raycast = () => {};
  });
  return root;
}
