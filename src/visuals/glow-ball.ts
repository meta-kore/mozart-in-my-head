import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';

export interface GlowBall {
  root: Group;
  core: Mesh<SphereGeometry, MeshStandardMaterial>;
  halo: Sprite;
  /** 0 = resting, 1 = loudest. Drives size, glow and halo together. */
  setIntensity(v: number): void;
}

let glowTexture: CanvasTexture | null = null;

/** A soft white radial falloff, shared by every halo. */
export function getGlowTexture(): CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowTexture = new CanvasTexture(canvas);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}

/**
 * A softly glowing sphere: an emissive core plus an additive radial-gradient
 * halo sprite. No post-processing, two draw calls.
 */
export function createGlowBall(diameter: number, colour: string): GlowBall {
  const root = new Group();
  const base = new Color(colour);

  const core = new Mesh(
    new SphereGeometry(diameter / 2, 32, 24),
    new MeshStandardMaterial({
      color: base.clone().multiplyScalar(0.5),
      emissive: base,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0,
    }),
  );
  core.name = 'BallCore';

  const halo = new Sprite(
    new SpriteMaterial({
      map: getGlowTexture(),
      color: base,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.name = 'BallHalo';
  // The halo is decoration only. Pointer rays must ignore it: three's
  // Sprite.raycast throws without a camera, which stops IWSDK's XR frame loop.
  halo.raycast = () => {};
  const haloBase = diameter * 2.4;
  halo.scale.setScalar(haloBase);

  root.add(core, halo);

  return {
    root,
    core,
    halo,
    setIntensity(v: number) {
      const t = Math.max(0, Math.min(1, v));
      core.material.emissiveIntensity = 0.6 + 2.2 * t;
      core.scale.setScalar(1 + 0.12 * t);
      halo.scale.setScalar(haloBase * (1 + 0.6 * t));
      halo.material.opacity = 0.45 + 0.55 * t;
    },
  };
}

export interface TextPanel {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  setText(lines: { text: string; size: number; colour?: string }[]): void;
}

/**
 * A flat text label drawn to a canvas texture. `width` is in metres; the
 * height follows the canvas aspect.
 */
export function createTextPanel(width: number, pixelWidth = 1024, pixelHeight = 256): TextPanel {
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new Mesh(
    new PlaneGeometry(width, (width * pixelHeight) / pixelWidth),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );

  return {
    mesh,
    setText(lines) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const total = lines.reduce((h, l) => h + l.size * 1.35, 0);
      let y = (canvas.height - total) / 2;
      for (const l of lines) {
        y += (l.size * 1.35) / 2;
        ctx.font = `500 ${l.size}px system-ui, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = l.colour ?? '#e8e9f0';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 8;
        ctx.fillText(l.text, canvas.width / 2, y);
        y += (l.size * 1.35) / 2;
      }
      texture.needsUpdate = true;
    },
  };
}
