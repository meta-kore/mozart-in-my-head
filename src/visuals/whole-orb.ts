import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from '@iwsdk/core';
import { getGlowTexture } from './glow-ball.js';

export interface WholeOrb {
  root: Group;
  /** 0 = resting, 1 = loudest. */
  setIntensity(v: number): void;
  /** Move the inner lights; `levels` are each section's loudness, 0..1. */
  animate(time: number, delta: number, levels: readonly number[]): void;
}

/**
 * The whole orchestra as one orb: a warm glass sphere with a small light for
 * every section circling inside it, each brightening with its own part of
 * the music. Pull it apart and those lights become the section balls.
 */
export function createWholeOrb(diameter: number, colours: readonly string[]): WholeOrb {
  const root = new Group();
  const gold = new Color('#ffe2a8');

  const shellMat = new ShaderMaterial({
    uniforms: { uColor: { value: gold.clone() }, uIntensity: { value: 0.2 } },
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
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, 2.0);
        vec3 c = uColor * (0.1 + 0.12 * uIntensity + rim * (0.7 + 1.2 * uIntensity));
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const shell = new Mesh(new SphereGeometry(diameter / 2, 40, 30), shellMat);
  shell.name = 'OrbShell';

  // A warm heart of light in the middle.
  const heart = new Sprite(
    new SpriteMaterial({ map: getGlowTexture(), color: gold, transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  heart.name = 'OrbHeart';
  heart.raycast = () => {};
  const heartBase = diameter * 0.9;
  heart.scale.setScalar(heartBase);

  const halo = new Sprite(
    new SpriteMaterial({ map: getGlowTexture(), color: gold, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false }),
  );
  halo.name = 'OrbHalo';
  halo.raycast = () => {};
  const haloBase = diameter * 2.3;
  halo.scale.setScalar(haloBase);

  // One small light per section, each on its own tilted orbit.
  const lightGeometry = new SphereGeometry(diameter * 0.075, 12, 8);
  const lights = colours.map((c, i) => {
    const m = new Mesh(lightGeometry, new MeshBasicMaterial({ color: new Color(c) }));
    m.name = `OrbLight${i}`;
    m.raycast = () => {};
    return {
      mesh: m,
      base: new Color(c),
      radius: diameter * (0.22 + 0.1 * ((i * 3) % 4) / 3),
      speed: 0.35 + 0.12 * ((i * 5) % 7) / 6,
      tilt: (i / colours.length) * Math.PI,
      phase: (i / colours.length) * Math.PI * 2,
      level: 0,
    };
  });
  const inner = new Group();
  inner.name = 'OrbLights';
  for (const l of lights) inner.add(l.mesh);

  root.add(halo, heart, inner, shell);
  let intensity = 0;

  return {
    root,
    setIntensity(v: number) {
      intensity = Math.max(0, Math.min(1, v));
      shellMat.uniforms.uIntensity.value = intensity;
      heart.scale.setScalar(heartBase * (0.8 + 0.5 * intensity));
      heart.material.opacity = 0.35 + 0.45 * intensity;
      halo.scale.setScalar(haloBase * (1 + 0.5 * intensity));
      halo.material.opacity = 0.3 + 0.55 * intensity;
    },
    animate(time: number, delta: number, levels: readonly number[]) {
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        const target = levels[i] ?? 0;
        l.level += (target - l.level) * Math.min(1, (target > l.level ? 18 : 5) * delta);
        const a = l.phase + time * l.speed * (1 + intensity);
        const x = Math.cos(a) * l.radius;
        const z = Math.sin(a) * l.radius;
        // Tilt each orbit about the X axis so the lights weave around each other.
        l.mesh.position.set(x, z * Math.sin(l.tilt), z * Math.cos(l.tilt));
        l.mesh.scale.setScalar(0.7 + 0.7 * l.level);
        l.mesh.material.color.copy(l.base).multiplyScalar(0.45 + 0.9 * l.level);
      }
    },
  };
}
