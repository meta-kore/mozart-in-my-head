import { mozart40 } from '../music/mozart40.js';
import { StemPlayer } from './stems.js';

/** The app's one music player, shared by every system. */
export const music = new StemPlayer(
  mozart40.sections.map((s) => ({
    id: s.id,
    url: `${import.meta.env.BASE_URL}${mozart40.stemPath}/${s.id}.ogg`,
  })),
);

/**
 * Start decoding the stems straight away, and unlock audio on the first real
 * user gesture: the Enter XR click on a headset, or any click or key on a
 * desktop. Inside VR, touching the ball is not a browser gesture, so audio
 * must already be unlocked by then.
 */
export function prepareAudio(): void {
  void music.load().then(() => {
    for (const s of mozart40.sections) music.setGain(s.id, s.gain, 0);
    // Development only: ?mute runs everything silently (automated tests).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('mute')) music.setMasterGain(0);
  });
  const unlock = () => music.unlock();
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}
