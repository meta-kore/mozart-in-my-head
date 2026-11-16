import {
  AdditiveBlending,
  BufferAttribute,
  CircleGeometry,
  Color,
  createScenePrimitiveObject,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from '@iwsdk/core';

/**
 * A plain dark floor with a soft pool of light around the player, so the
 * dark room still has a sense of ground. The scene's DomeFade on this node
 * blends the floor into the night-sky DomeGradient with distance.
 *
 * Built from geometry and vertex colours only (no canvas), because this
 * module is also evaluated by the IWSDK editor, where it must not touch the
 * DOM.
 */
export function createDarkFloor(size = 30): Group {
  const floor = createScenePrimitiveObject(
    { geometry: { type: 'plane', size: [size, size] } },
    new MeshStandardMaterial({ color: '#14161f', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;

  const root = new Group();
  root.add(floor, createFloorGlow());
  return root;
}

/** A disc whose colour fades from a soft blue at the centre to nothing at the rim. */
function createFloorGlow(radius = 1.4): Mesh {
  const geometry = new CircleGeometry(radius, 64, 0, Math.PI * 2);
  const centre = new Color('#2a3566');
  const positions = geometry.getAttribute('position');
  const colours = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const r = Math.hypot(positions.getX(i), positions.getY(i)) / radius;
    const fade = Math.pow(1 - Math.min(1, r), 2); // bright middle, soft edge
    colours[i * 3] = centre.r * fade;
    colours[i * 3 + 1] = centre.g * fade;
    colours[i * 3 + 2] = centre.b * fade;
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  const glow = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false }),
  );
  glow.name = 'FloorGlow';
  glow.rotation.x = -Math.PI / 2;
  // Just above the floor, centred a little in front of the seated player.
  glow.position.set(0, 0.003, -0.3);
  glow.raycast = () => {};
  return glow;
}
