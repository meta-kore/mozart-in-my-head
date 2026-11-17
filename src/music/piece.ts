// The pieces the app can play, and which one is playing now.
//
// Each piece is a set of seven looping section stems (see StemPiece), a
// listening guide timed to its loop, three listening challenges and its
// credits. Every piece has exactly seven sections, so the same seven balls
// re-dress themselves when the piece changes.

import { mozart40, type StemPiece } from './mozart40.js';
import { mozart40Guide } from './mozart40-guide.js';
import { romeoJuliet, romeoJulietGuide } from './romeo-juliet.js';

export interface Cue {
  /** Loop time (seconds) this passage starts. */
  at: number;
  /** Short name of the passage. */
  title: string;
  /** One line on what to listen for. */
  text: string;
  /** Section ids that carry this passage; their balls are highlighted. */
  featured: string[];
}

/**
 * A listening challenge. `solo`: done when any of `ids` is heard alone.
 * `seat`: done when `left` sits to the player's left and `right` to the right.
 */
export type Challenge = {
  /** The question, and a hint line (headset wording). */
  xr: [string, string];
  /** Computer wording, if different. */
  desk?: [string, string];
  /** Shown when done. */
  success: [string, string];
  /** The section that gets a little celebration. */
  celebrate: string;
} & ({ kind: 'solo'; ids: string[] } | { kind: 'seat'; left: string; right: string });

export interface PieceEntry {
  piece: StemPiece;
  /** Composer, for the picker and the finale (short). */
  composer: string;
  /** Short title for the picker. */
  short: string;
  /** Line for the finale credits. */
  finaleTitle: string;
  /** One-line credit under the whole ball. */
  creditLine: string;
  guide: Cue[];
  challenges: [Challenge, Challenge, Challenge];
}

export const pieces: PieceEntry[] = [
  {
    piece: mozart40,
    composer: 'Mozart',
    short: 'Symphony No. 40',
    finaleTitle: 'Mozart · Symphony No. 40 in G minor · first movement',
    creditLine: 'Mozart · Symphony No. 40 · Colibrì Ensemble · The Spheres Dataset · CC BY-SA 4.0',
    guide: mozart40Guide,
    challenges: [
      {
        kind: 'solo',
        ids: ['violas'],
        xr: ['Who starts the symphony?', 'Not the violins. Find them and listen to them alone.'],
        success: ['Yes: the violas.', 'Their restless pulse sets everything going.'],
        celebrate: 'violas',
      },
      {
        kind: 'solo',
        ids: ['violins-1', 'violins-2'],
        xr: ['Who sings the famous tune?', 'Find them and listen to them alone.'],
        success: ['The violins.', 'Firsts and seconds play it an octave apart.'],
        celebrate: 'violins-1',
      },
      {
        kind: 'seat',
        left: 'flute-oboes',
        right: 'violins-1',
        xr: ['Seat your own orchestra:', 'flute and oboes on your left, first violins on your right.'],
        desk: ['Seat your own orchestra: drag the flute and oboes', 'to your left, and the first violins to your right.'],
        success: ['Now they answer each other across you.', 'Listen for it in the second theme.'],
        celebrate: 'flute-oboes',
      },
    ],
  },
  romeoJuliet,
];

/** Which piece is selected; `version` counts changes so systems can react. */
export const pieceState = { index: 0, version: 0 };

export function currentPiece(): PieceEntry {
  return pieces[pieceState.index];
}

/** Index of the passage playing at loop time `t` (seconds). */
export function cueIndexAt(guide: readonly Cue[], t: number): number {
  let i = 0;
  while (i + 1 < guide.length && guide[i + 1].at <= t) i++;
  return i;
}
