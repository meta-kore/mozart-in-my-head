// W. A. Mozart, Symphony No. 40 in G minor, K. 550, first movement exposition.
// Recording: The Spheres Dataset (Colibrì Ensemble), CC BY-SA 4.0.
// Stems built by scripts/make_stems.py. See CREDITS.md.

import type { InstrumentKind } from '../scene-assets/instruments.scene-asset.js';

export interface Section {
  id: string;
  /** Which instrument emblem floats inside the ball. */
  kind: InstrumentKind;
  /** Name shown on the section's ball. */
  label: string;
  /** Instruments in this section, for the label's second line and credits. */
  instruments: string;
  colour: string;
  /**
   * Seat in the Apart arc, -1 (far left) to 1 (far right) as the player sees
   * it, roughly following a classical orchestra's seating.
   */
  seat: number;
  /** Starting volume, to balance the raw recording (1 = as recorded). */
  gain: number;
}

export interface StemPiece {
  title: string;
  composer: string;
  /** Folder under public/ holding <section id>.ogg files. */
  stemPath: string;
  loopSeconds: number;
  sections: Section[];
  credit: string;
}

export const mozart40: StemPiece = {
  title: 'Symphony No. 40 in G minor, first movement',
  composer: 'Wolfgang Amadeus Mozart',
  stemPath: 'stems/mozart40',
  loopSeconds: 123.55,
  // Provisional balance: the raw recording is bass- and horn-heavy, measured
  // at about -24 LUFS for cellos and basses against -33 for first violins.
  // Tune by ear on stems-test.html.
  sections: [
    { id: 'violins-1', kind: 'violin', label: 'First violins', instruments: 'Violins', colour: '#8fb3ff', seat: -1, gain: 1.2 },
    { id: 'violins-2', kind: 'violin', label: 'Second violins', instruments: 'Violins', colour: '#b49cff', seat: -0.66, gain: 1.15 },
    { id: 'flute-oboes', kind: 'flute-oboe', label: 'Flute and oboes', instruments: 'Flute, 2 oboes', colour: '#5ce1d0', seat: -0.33, gain: 1.2 },
    { id: 'clarinets-bassoons', kind: 'clarinet-bassoon', label: 'Clarinets and bassoons', instruments: '2 clarinets, 2 bassoons', colour: '#5ce1a5', seat: 0, gain: 0.8 },
    { id: 'horns', kind: 'horn', label: 'Horns', instruments: '2 horns', colour: '#ffd166', seat: 0.33, gain: 0.7 },
    { id: 'violas', kind: 'viola', label: 'Violas', instruments: 'Violas', colour: '#ff9fc4', seat: 0.66, gain: 1.1 },
    { id: 'cellos-basses', kind: 'cello', label: 'Cellos and basses', instruments: 'Cellos, double basses', colour: '#ff8a5c', seat: 1, gain: 0.55 },
  ],
  credit:
    'Mozart, Symphony No. 40. Performed by the Colibrì Ensemble, from The Spheres Dataset (zenodo.org/records/17347681), CC BY-SA 4.0. Sections mixed and looped for this app.',
};
