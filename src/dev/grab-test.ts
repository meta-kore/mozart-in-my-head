// Development-only experiment (step 4): do IWSDK's built-in grab components
// respond to a bare-hand pinch? Loaded only with ?grabtest in dev builds.
import {
  createSystem,
  Grabbed,
  Mesh,
  MeshStandardMaterial,
  OneHandGrabbable,
  SphereGeometry,
  TwoHandsGrabbable,
} from '@iwsdk/core';

export class GrabTestSystem extends createSystem({
  held: { required: [Grabbed] },
}) {
  init(): void {
    const make = (name: string, colour: string, x: number) => {
      const mesh = new Mesh(
        new SphereGeometry(0.045, 24, 16),
        new MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.5 }),
      );
      mesh.name = name;
      mesh.position.set(x, 1.3, -0.4);
      return this.world.createTransformEntity(mesh, { persistent: true });
    };
    make('GrabTestOne', '#5ce1a5', 0.22).addComponent(OneHandGrabbable, { rotate: false });
    make('GrabTestTwo', '#8fb3ff', -0.22).addComponent(TwoHandsGrabbable, {
      rotate: false,
      translate: true,
      scale: true,
    });
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (e) => console.info(`[grabtest] grabbed ${e.object3D?.name}`)),
      this.queries.held.subscribe('disqualify', (e) => console.info(`[grabtest] released ${e.object3D?.name}`)),
    );
  }
}
