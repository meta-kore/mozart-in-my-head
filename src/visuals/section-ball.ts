import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Section } from '../music/mozart40.js';
import { buildInstrument, type InstrumentKind } from '../scene-assets/instruments.scene-asset.js';
import { getGlowTexture } from './glow-ball.js';

export interface SectionBallView {
  root: Group;
  /** 0 = resting, 1 = loudest. */
  setIntensity(v: number): void;
  /** Per-frame idle motion; `level` is the section's loudness (0..1). */
  animate(time: number, delta: number, level: number): void;
}

const KIND: Record<string, InstrumentKind> = {
  'violins-1': 'violin',
  'violins-2': 'violin',
  violas: 'viola',
  'cellos-basses': 'cello',
  'flute-oboes': 'flute-oboe',
  'clarinets-bassoons': 'clarinet-bassoon',
  horns: 'horn',
};

/** Emblem size inside the ball (largest dimension, metres). */
const EMBLEM_SIZE = 0.068;

const emblemCache = new Map<InstrumentKind, BufferGeometry>();

/**
 * Bake an emblem's parts into one geometry (one draw call per ball), with
 * vertex colours: body parts take the section's colour, accents stay pale.
 * Colours are filled in per ball, so the geometry is shared per kind and
 * cloned only for its colour attribute.
 */
function emblemGeometry(kind: InstrumentKind): BufferGeometry {
  const cached = emblemCache.get(kind);
  if (cached) return cached;
  const group = buildInstrument(kind);
  group.updateMatrixWorld(true);
  const positions: number[] = [];
  const normals: number[] = [];
  const accents: number[] = [];
  const p = new Vector3();
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const accent = mesh.userData.tone === 'accent' ? 1 : 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      positions.push(p.x, p.y, p.z);
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      accents.push(accent);
    }
    g.dispose();
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('accent', new BufferAttribute(new Float32Array(accents), 1));
  geometry.computeBoundingSphere();
  emblemCache.set(kind, geometry);
  return geometry;
}

function colouredEmblem(kind: InstrumentKind, colour: Color): BufferGeometry {
  const shared = emblemGeometry(kind);
  const g = new BufferGeometry();
  g.setAttribute('position', shared.getAttribute('position'));
  g.setAttribute('normal', shared.getAttribute('normal'));
  const accent = shared.getAttribute('accent');
  const colours = new Float32Array(accent.count * 3);
  const body = colour.clone().lerp(new Color('#ffffff'), 0.25);
  const pale = colour.clone().lerp(new Color('#fffaf0'), 0.8);
  for (let i = 0; i < accent.count; i++) {
    const c = accent.getX(i) > 0.5 ? pale : body;
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  g.boundingSphere = shared.boundingSphere;
  return g;
}

const shellGeometry = new SphereGeometry(0.5, 32, 24);

/** A glass bubble: faint in the middle, glowing at the rim (fresnel), additive. */
function shellMaterial(colour: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: colour.clone() }, uIntensity: { value: 0.3 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        vec3 c = uColor * (0.06 + rim * (0.55 + 1.1 * uIntensity));
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/**
 * A section's ball: a glowing glass bubble holding a small emblem of its
 * instruments, with a soft halo. The emblem turns gently to show its shape
 * and brightens with the section's loudness. Three draw calls.
 */
export function createSectionBall(section: Section, diameter: number): SectionBallView {
  const root = new Group();
  const colour = new Color(section.colour);
  const kind = KIND[section.id] ?? 'violin';

  const shell = new Mesh(shellGeometry, shellMaterial(colour));
  shell.name = 'BallShell';
  shell.scale.setScalar(diameter);

  const emblemMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.15,
    emissive: colour,
    emissiveIntensity: 0.25,
  });
  const emblem = new Mesh(colouredEmblem(kind, colour), emblemMaterial);
  emblem.name = 'Emblem';
  emblem.scale.setScalar(EMBLEM_SIZE);
  // Strings stand upright; the crossed woodwinds and the horn face the player.
  const pivot = new Group();
  pivot.name = 'EmblemPivot';
  pivot.add(emblem);

  const halo = new Sprite(
    new SpriteMaterial({
      map: getGlowTexture(),
      color: colour,
      transparent: true,
      opacity: 0.35,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.name = 'BallHalo';
  // Decoration only: three's Sprite.raycast throws without a camera, which
  // stops IWSDK's XR frame loop.
  halo.raycast = () => {};
  const haloBase = diameter * 2.2;
  halo.scale.setScalar(haloBase);

  root.add(halo, pivot, shell);
  const phase = section.seat * 3.1;
  const shellU = shell.material.uniforms.uIntensity;
  let swing = 0;

  return {
    root,
    setIntensity(v: number) {
      const t = Math.max(0, Math.min(1, v));
      shellU.value = t;
      emblemMaterial.emissiveIntensity = 0.2 + 1.3 * t;
      halo.scale.setScalar(haloBase * (1 + 0.5 * t));
      halo.material.opacity = 0.25 + 0.5 * t;
      shell.scale.setScalar(diameter * (1 + 0.06 * t));
    },
    animate(time: number, delta: number, level: number) {
      // A slow turn to and fro, a little livelier when the section plays.
      swing += delta * (0.5 + 0.8 * level);
      pivot.rotation.y = Math.sin(swing + phase) * 0.55;
      pivot.rotation.z = Math.sin(time * 0.7 + phase) * 0.06;
      pivot.position.y = Math.sin(time * 1.1 + phase) * 0.002;
    },
  };
}
