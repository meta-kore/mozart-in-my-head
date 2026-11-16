import type { Object3D, PerspectiveCamera, Quaternion, Vector3 } from '@iwsdk/core';

interface ViewerSource {
  world: { session: XRSession | undefined };
  player: { head: Object3D };
  camera: PerspectiveCamera;
}

/**
 * Read the viewer's eye position and orientation. IWSDK owns the XR session
 * (three's renderer.xr.isPresenting stays false), and in XR the tracked head
 * lives in player.head; outside XR the camera is the view.
 * Returns true when in XR.
 */
export function readViewer(s: ViewerSource, position: Vector3, orientation: Quaternion): boolean {
  const presenting = s.world.session !== undefined;
  const viewer = presenting ? s.player.head : s.camera;
  viewer.getWorldPosition(position);
  viewer.getWorldQuaternion(orientation);
  return presenting;
}

/** Turn a flat label to face the eyes, staying upright (yaw and pitch only). */
export function faceViewer(label: Object3D, eyes: Vector3): void {
  const dx = eyes.x - label.position.x;
  const dy = eyes.y - label.position.y;
  const dz = eyes.z - label.position.z;
  // Rotating about X by +θ turns the plane's front (+Z) downward, so tilt
  // by -atan(dy / horizontal) to face eyes above the label.
  label.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
}
