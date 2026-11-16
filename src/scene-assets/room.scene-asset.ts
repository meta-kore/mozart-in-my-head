import {
  createScenePrimitiveObject,
  Group,
  MeshStandardMaterial,
} from '@iwsdk/core';

/**
 * A plain dark floor. The scene's DomeFade on this node blends it into the
 * night-sky DomeGradient with distance, so the room has no visible edge.
 */
export function createDarkFloor(size = 30): Group {
  const floor = createScenePrimitiveObject(
    { geometry: { type: 'plane', size: [size, size] } },
    new MeshStandardMaterial({ color: '#14161f', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  const root = new Group();
  root.add(floor);
  return root;
}
