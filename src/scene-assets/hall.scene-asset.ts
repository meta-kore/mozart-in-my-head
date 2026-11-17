import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
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
 * Lighting is baked into vertex colours twice (house lights, and concert
 * spotlights) and blended on the GPU, so the hall is four draw calls: the solid
 * mesh, soft lamp glows, visible spotlight beams and a cloud of drifting dust.
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
/** The conductor's podium the player sits on (square, centred on the origin). */
export const PODIUM_SIZE = 1.6;
export const PODIUM_HEIGHT = 0.12;

// ---- Baked lighting ----

interface BakedLight {
  pos: Vector3;
  colour: Color;
  power: number;
  /** Distance at which the light falls to a quarter. */
  reach: number;
}

/**
 * Two lighting states are baked, and the hall blends between them at runtime
 * (see HallLightingSystem):
 * - HOUSE: before the concert, the hall evenly and warmly lit;
 * - STAGE: the concert: the house dark, pools of spotlight on the orchestra,
 *   the organ glowing, the audience in shadow.
 */
const HOUSE_AMBIENT = new Color(0.17, 0.16, 0.17);
const HOUSE_LIGHTS: BakedLight[] = [
  // Warm wash over the stage and orchestra.
  { pos: new Vector3(0, 9, -3.5), colour: new Color(1.0, 0.82, 0.62), power: 2.0, reach: 10 },
  // Around the player.
  { pos: new Vector3(0, 6, 0.5), colour: new Color(0.95, 0.84, 0.7), power: 0.6, reach: 5 },
  // The organ.
  { pos: new Vector3(0, 2.5, -6.5), colour: new Color(1.0, 0.8, 0.55), power: 0.7, reach: 6 },
  // House lights over the audience, and along the hall.
  { pos: new Vector3(0, 9, 10), colour: new Color(1.0, 0.86, 0.68), power: 1.8, reach: 12 },
  { pos: new Vector3(-7, 9, 0), colour: new Color(1.0, 0.86, 0.68), power: 1.0, reach: 9 },
  { pos: new Vector3(7, 9, 0), colour: new Color(1.0, 0.86, 0.68), power: 1.0, reach: 9 },
];

/** Overall brightness of the house lighting. */
const HOUSE_GAIN = 2;

const STAGE_AMBIENT = new Color(0.014, 0.014, 0.022);

/** A spotlight: a cone from `pos` towards `target`, soft-edged between the two angles. */
interface Spot {
  pos: Vector3;
  target: Vector3;
  colour: Color;
  power: number;
  /** Half-angles of the cone (degrees): full strength inside `inner`, none beyond `outer`. */
  inner: number;
  outer: number;
  /** Draw a visible beam of light for this spot. */
  beam: boolean;
}

const WARM_SPOT = new Color(1.0, 0.8, 0.55);
const SOFT_SPOT = new Color(0.95, 0.86, 0.75);

/** Stage spotlights hung high over the orchestra. Exported for the beams and dust. */
export const STAGE_SPOTS: Spot[] = [
  { pos: new Vector3(0, 11.5, -5.5), target: new Vector3(0, 0, -4.2), colour: WARM_SPOT, power: 2.6, inner: 9, outer: 17, beam: true },
  { pos: new Vector3(-5.5, 11.5, -4.5), target: new Vector3(-3.6, 0, -2.6), colour: WARM_SPOT, power: 2.2, inner: 8, outer: 15, beam: true },
  { pos: new Vector3(5.5, 11.5, -4.5), target: new Vector3(3.6, 0, -2.6), colour: WARM_SPOT, power: 2.2, inner: 8, outer: 15, beam: true },
  { pos: new Vector3(-3.5, 11.5, -8), target: new Vector3(-2.4, 0.5, -5.4), colour: WARM_SPOT, power: 1.8, inner: 7, outer: 14, beam: true },
  { pos: new Vector3(3.5, 11.5, -8), target: new Vector3(2.4, 0.5, -5.4), colour: WARM_SPOT, power: 1.8, inner: 7, outer: 14, beam: true },
  // A soft pool on the conductor's podium (no beam: it would sit in the player's face).
  { pos: new Vector3(0, 10, 2.5), target: new Vector3(0, 0, 0), colour: SOFT_SPOT, power: 0.75, inner: 8, outer: 18, beam: false },
  // The organ washed from below.
  { pos: new Vector3(0, 0.6, -6.6), target: new Vector3(0, 6, -9.4), colour: new Color(1.0, 0.7, 0.4), power: 1.7, inner: 30, outer: 55, beam: false },
];
/** Wall lamps, also baked as small lights (and drawn as glows). */
const LAMPS: Vector3[] = [];
for (const side of [-1, 1]) {
  for (const z of [-7, -2.5, 2, 6.5, 11, 15.5]) LAMPS.push(new Vector3(side * (HALF_WIDTH - 0.12), 3.6, z));
}
const LAMP_COLOUR = new Color(1.0, 0.72, 0.42);

const lightDir = new Vector3();
const spotAxis = new Vector3();

function addPoint(p: Vector3, n: Vector3, out: Color, pos: Vector3, colour: Color, power: number, reach: number, wrap = 0.25): void {
  lightDir.subVectors(pos, p);
  const dist = lightDir.length();
  const lambert = Math.max(0, n.dot(lightDir.divideScalar(dist || 1)));
  const fall = 1 / (1 + 3 * (dist / reach) * (dist / reach));
  const k = power * (wrap + (1 - wrap) * lambert) * fall;
  out.r += colour.r * k;
  out.g += colour.g * k;
  out.b += colour.b * k;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The hall before the concert: even, warm house lighting. */
function houseLightAt(p: Vector3, n: Vector3, out: Color): Color {
  out.copy(HOUSE_AMBIENT);
  for (const l of HOUSE_LIGHTS) addPoint(p, n, out, l.pos, l.colour, l.power, l.reach);
  for (const l of LAMPS) addPoint(p, n, out, l, LAMP_COLOUR, 0.6, 2.2);
  return out.multiplyScalar(HOUSE_GAIN);
}

/** The concert: spotlit stage, dark house, lamps turned right down. */
function stageLightAt(p: Vector3, n: Vector3, out: Color): Color {
  out.copy(STAGE_AMBIENT);
  for (const s of STAGE_SPOTS) {
    spotAxis.subVectors(s.target, s.pos).normalize();
    lightDir.subVectors(p, s.pos);
    const dist = lightDir.length();
    const cos = spotAxis.dot(lightDir.divideScalar(dist || 1));
    const cone = smooth(Math.cos((s.outer * Math.PI) / 180), Math.cos((s.inner * Math.PI) / 180), cos);
    if (cone <= 0) continue;
    const lambert = Math.max(0, -n.dot(lightDir));
    const reach = s.pos.distanceTo(s.target) * 1.3;
    const fall = 1 / (1 + (dist / reach) * (dist / reach));
    const k = s.power * cone * (0.15 + 0.85 * lambert) * fall;
    out.r += s.colour.r * k;
    out.g += s.colour.g * k;
    out.b += s.colour.b * k;
  }
  for (const l of LAMPS) addPoint(p, n, out, l, LAMP_COLOUR, 0.18, 1.6, 0.1);
  return out;
}

// ---- A builder that merges every part into one lit, vertex-coloured mesh ----

class Builder {
  private readonly pos: number[] = [];
  private readonly house: number[] = [];
  private readonly stage: number[] = [];
  private readonly m = new Matrix4();
  private readonly nm = new Matrix3();
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly c = new Color();

  private push(out: number[], albedo: Color, emissive: number): void {
    out.push(
      Math.min(1, albedo.r * this.c.r + emissive * albedo.r),
      Math.min(1, albedo.g * this.c.g + emissive * albedo.g),
      Math.min(1, albedo.b * this.c.b + emissive * albedo.b),
    );
  }

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
      this.pos.push(this.p.x, this.p.y, this.p.z);
      houseLightAt(this.p, this.n, this.c);
      this.push(this.house, albedo, emissive);
      stageLightAt(this.p, this.n, this.c);
      // Lamp shades dim with the house lights; gilt and the organ keep a little glow.
      this.push(this.stage, albedo, emissive * 0.25);
    }
    if (g !== geometry) g.dispose();
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, albedo: Color, rotY = 0, emissive = 0): void {
    this.add(unitBox, albedo, new Vector3(cx, cy, cz), rotY, new Vector3(sx, sy, sz), emissive);
  }

  build(name: string): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aHouse', new BufferAttribute(new Float32Array(this.house), 3));
    g.setAttribute('aStage', new BufferAttribute(new Float32Array(this.stage), 3));
    g.computeBoundingSphere();
    const mesh = new Mesh(g, hallMaterial());
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
  // The conductor's podium under the player, wide enough that the balls
  // within reach hover over it (their glows fall on its top).
  b.box(0, PODIUM_HEIGHT / 2, 0, PODIUM_SIZE, PODIUM_HEIGHT, PODIUM_SIZE, WOOD_DARK);
  b.box(0, PODIUM_HEIGHT + 0.004, 0, PODIUM_SIZE - 0.08, 0.008, PODIUM_SIZE - 0.08, WOOD);
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

/**
 * The hall's material: unlit, blending the two baked lighting states.
 * Uniforms (driven by HallLightingSystem; shared by every placed copy):
 * - uMix: 0 = house lights, 1 = concert lighting;
 * - uStage: brightness of the concert lighting (breathes with the music).
 */
function hallMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'HallBaked',
    uniforms: { uMix: { value: 0 }, uStage: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aHouse;
      attribute vec3 aStage;
      uniform float uMix;
      uniform float uStage;
      varying vec3 vColour;
      void main() {
        vColour = mix(aHouse, aStage * uStage, uMix);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      void main() {
        gl_FragColor = vec4(vColour, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Visible beams of light under each stage spotlight: open cones drawn
 * additively, brightest where you look across them and fading out before the
 * floor. One mesh; `uOpacity` is driven at runtime (0 before the concert).
 */
function lightBeams(): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  for (const s of STAGE_SPOTS) {
    if (!s.beam) continue;
    const length = s.pos.distanceTo(s.target);
    const bottom = length * Math.tan(((s.outer * 0.8) * Math.PI) / 180);
    const cone = new CylinderGeometry(0.1, bottom, length, 40, 6, true).toNonIndexed();
    // Local +Y (the narrow top) points back up at the light.
    q.setFromUnitVectors(up, new Vector3().subVectors(s.pos, s.target).normalize());
    const mid = new Vector3().addVectors(s.pos, s.target).multiplyScalar(0.5);
    const pa = cone.getAttribute('position');
    const na = cone.getAttribute('normal');
    const ua = cone.getAttribute('uv');
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i).applyQuaternion(q).add(mid);
      n.fromBufferAttribute(na, i).applyQuaternion(q);
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      along.push(1 - ua.getY(i));
    }
    cone.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.computeBoundingSphere();
  const material = new ShaderMaterial({
    name: 'HallBeams',
    uniforms: { uOpacity: { value: 0 }, uColour: { value: new Color(1.0, 0.78, 0.5) } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vAlong = aAlong;
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColour;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Faces seen square-on are the beam's middle; grazing faces its soft edges.
        float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float ends = smoothstep(0.0, 0.1, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
        float a = uOpacity * facing * ends * (1.0 - 0.45 * vAlong);
        gl_FragColor = vec4(uColour * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const mesh = new Mesh(g, material);
  mesh.name = 'LightBeams';
  mesh.renderOrder = 2;
  mesh.userData.iwsdkPreviewBounds = 'exclude';
  return mesh;
}

/**
 * Dust drifting slowly through the spotlight beams: one point cloud, moved
 * entirely on the GPU by `uTime`. `uScale` is half the eye buffer's height
 * in pixels (set at runtime) so motes keep their size in the headset.
 */
function dustMotes(rand: () => number): Points {
  const beams = STAGE_SPOTS.filter((s) => s.beam);
  const count = 480;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const axis = new Vector3();
  const side = new Vector3();
  const side2 = new Vector3();
  for (let i = 0; i < count; i++) {
    const s = beams[i % beams.length];
    const length = s.pos.distanceTo(s.target);
    axis.subVectors(s.target, s.pos).normalize();
    side.set(1, 0, 0).cross(axis).normalize();
    side2.crossVectors(axis, side);
    const t = 0.2 + rand() * 0.72;
    const r = length * t * Math.tan(((s.outer * 0.6) * Math.PI) / 180) * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const at = new Vector3()
      .copy(s.pos)
      .addScaledVector(axis, length * t)
      .addScaledVector(side, Math.cos(a) * r)
      .addScaledVector(side2, Math.sin(a) * r);
    positions.set([at.x, at.y, at.z], i * 3);
    seeds[i] = rand();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  g.computeBoundingSphere();
  const material = new ShaderMaterial({
    name: 'HallDust',
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uScale;
      varying float vTwinkle;
      void main() {
        vec3 p = position + vec3(
          sin(uTime * 0.11 + aSeed * 20.0) * 0.22,
          sin(uTime * 0.05 + aSeed * 13.0) * 0.35,
          cos(uTime * 0.09 + aSeed * 7.0) * 0.22);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = 0.012 + 0.012 * fract(aSeed * 7.31);
        gl_PointSize = size * uScale * projectionMatrix[1][1] / max(0.05, -mv.z);
        vTwinkle = 0.45 + 0.55 * sin(uTime * (0.5 + aSeed) + aSeed * 40.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = pow(max(0.0, 1.0 - d), 2.0);
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * core * vTwinkle * uOpacity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const points = new Points(g, material);
  points.name = 'Dust';
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.userData.iwsdkPreviewBounds = 'exclude';
  return points;
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
  root.add(solid, lampGlows(), lightBeams(), dustMotes(rand));
  // Decoration only: never a pointer or grab target.
  root.traverse((o) => {
    o.raycast = () => {};
  });
  return root;
}
