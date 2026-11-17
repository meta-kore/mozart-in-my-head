import { currentPiece, pieces, pieceState } from '../music/piece.js';
import { Cues } from './cues.js';
import { StemPlayer, type StemSpec } from './stems.js';

function specsFor(index: number): StemSpec[] {
  const p = pieces[index].piece;
  return p.sections.map((s) => ({ id: s.id, url: `${import.meta.env.BASE_URL}${p.stemPath}/${s.id}.ogg` }));
}

/** The app's one music player, shared by every system. */
export const music = new StemPlayer(specsFor(pieceState.index));

/** Interaction sound effects, played through the music's master bus. */
export const cues = new Cues(music);

/** How many stems have decoded so far, for loading feedback. */
export const loadProgress = { done: 0, total: currentPiece().piece.sections.length, failed: false };

let progressListener: ((done: number, total: number) => void) | undefined;

function onProgress(done: number, total: number): void {
  loadProgress.done = done;
  loadProgress.total = total;
  progressListener?.(done, total);
}

function afterLoad(): void {
  for (const s of currentPiece().piece.sections) music.setGain(s.id, s.gain, 0);
  // Development only: ?mute runs everything silently (automated tests).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mute')) music.setMasterGain(0);
}

function onFail(err: unknown): void {
  loadProgress.failed = true;
  console.error('[audio] could not load the music', err);
}

/**
 * Start decoding the stems straight away, and unlock audio on the first real
 * user gesture: the Enter XR click on a headset, or any click or key on a
 * desktop. Inside VR, touching the ball is not a browser gesture, so audio
 * must already be unlocked by then.
 */
export function prepareAudio(listener?: (done: number, total: number) => void): void {
  progressListener = listener;
  void music.load(onProgress).then(afterLoad).catch(onFail);
  const unlock = () => music.unlock();
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/**
 * Change the piece: stop the current music, release it, and load the new
 * one's stems. Systems notice `pieceState.version` changing and re-dress.
 */
export function selectPiece(index: number): void {
  if (index === pieceState.index || index < 0 || index >= pieces.length) return;
  pieceState.index = index;
  pieceState.version++;
  loadProgress.done = 0;
  loadProgress.total = pieces[index].piece.sections.length;
  loadProgress.failed = false;
  void music.switchTo(specsFor(index), onProgress).then(afterLoad).catch(onFail);
}
