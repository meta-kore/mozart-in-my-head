// Mixing rules for the Apart state, kept free of XR so they can be tested
// in isolation. Starting values from CLAUDE.md; tune on a headset.

/** Full volume at or inside this distance from the head (metres). */
export const FULL_VOLUME_WITHIN = 0.3;
/** Distance at which the volume reaches its floor. */
export const FLOOR_AT = 1.0;
/** The quietest a section ever gets from distance: never fully silent. */
export const DISTANCE_FLOOR = 0.1;

/** Solo engages when a ball comes this close to either ear... */
export const SOLO_ENTER = 0.2;
/** ...and releases when it moves further than this (no flicker at the edge). */
export const SOLO_EXIT = 0.24;
/** Level the other sections duck to during a solo. */
export const SOLO_DUCK = 0.1;
/** Seconds for the duck to (nearly) complete. */
export const SOLO_RAMP_SECONDS = 0.25;
/** Each ear sits this far either side of the head's centre. */
export const EAR_OFFSET = 0.075;

/** Volume multiplier for a sound this far from the head: smooth, 1 → floor. */
export function distanceGain(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - FULL_VOLUME_WITHIN) / (FLOOR_AT - FULL_VOLUME_WITHIN)));
  const eased = t * t * (3 - 2 * t); // smoothstep
  return 1 - (1 - DISTANCE_FLOOR) * eased;
}

/**
 * Decide which ball (if any) is soloed, given each ball's distance to the
 * nearer ear. Keeps the current solo until it moves past SOLO_EXIT; picks a
 * new one only when it comes inside SOLO_ENTER.
 */
export function chooseSolo(current: number, earDistances: readonly number[]): number {
  if (current >= 0 && earDistances[current] <= SOLO_EXIT) return current;
  let best = -1;
  let bestDist = SOLO_ENTER;
  earDistances.forEach((d, i) => {
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/** Move a duck value towards its target so a 0.25 s ramp is ~95% done. */
export function stepDuck(value: number, target: number, delta: number): number {
  const k = 1 - Math.exp((-3 * delta) / SOLO_RAMP_SECONDS);
  return value + (target - value) * k;
}
