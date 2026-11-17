// P. I. Tchaikovsky, Romeo and Juliet, Fantasy Overture: the love theme.
// Recording: The Spheres Dataset (Colibrì Ensemble), CC BY-SA 4.0.
// Stems built by scripts/make_stems_rj.py. See CREDITS.md.

import type { StemPiece } from './mozart40.js';
import type { Cue, PieceEntry } from './piece.js';

const piece: StemPiece = {
  title: 'Romeo and Juliet, Fantasy Overture: the love theme',
  composer: 'Pyotr Ilyich Tchaikovsky',
  stemPath: 'stems/romeo-juliet',
  loopSeconds: 174.2,
  // Balance: the raw lines put brass and low strings well above the harp
  // (loop RMS: brass -25 dB, cellos and basses -26, harp -37). Tune by ear.
  // Seven families of a romantic orchestra, seated left to right roughly as on stage.
  sections: [
    { id: 'rj-violins', kind: 'violin', label: 'Violins', instruments: 'First and second violins', colour: '#8fb3ff', seat: -1, gain: 1.15 },
    { id: 'rj-flutes-oboes', kind: 'flute-oboe', label: 'Flutes and oboes', instruments: 'Flutes, piccolo, oboes, cor anglais', colour: '#5ce1d0', seat: -0.66, gain: 1 },
    { id: 'rj-clarinets-bassoons', kind: 'clarinet-bassoon', label: 'Clarinets and bassoons', instruments: '2 clarinets, 2 bassoons', colour: '#5ce1a5', seat: -0.33, gain: 1 },
    { id: 'rj-brass', kind: 'trumpet', label: 'Brass', instruments: 'Horns, trumpets, trombones, tuba', colour: '#ffd166', seat: 0, gain: 0.75 },
    { id: 'rj-harp-percussion', kind: 'harp-timpani', label: 'Harp and percussion', instruments: 'Harp, timpani, cymbals, bass drum', colour: '#c7a6ff', seat: 0.33, gain: 1.35 },
    { id: 'rj-violas', kind: 'viola', label: 'Violas', instruments: 'Violas', colour: '#ff9fc4', seat: 0.66, gain: 1.1 },
    { id: 'rj-cellos-basses', kind: 'cello', label: 'Cellos and basses', instruments: 'Cellos, double basses', colour: '#ff8a5c', seat: 1, gain: 0.7 },
  ],
  credit:
    'Tchaikovsky, Romeo and Juliet. Performed by the Colibrì Ensemble, from The Spheres Dataset (zenodo.org/records/17347681), CC BY-SA 4.0. Sections mixed and looped for this app.',
};

// The excerpt runs from 9:54 to 12:48 of this recording (174.2 s loop).
// Passage times were read from each section's loudness in the stems; the
// descriptions are written for this app.
export const romeoJulietGuide: Cue[] = [
  {
    at: 0,
    title: 'The strings stir',
    text: 'Strings murmur; clarinets and bassoons rise beneath them.',
    featured: ['rj-violins', 'rj-violas', 'rj-clarinets-bassoons'],
  },
  {
    at: 15,
    title: 'The harp',
    text: 'Rippling harp chords open the way for the love theme.',
    featured: ['rj-harp-percussion'],
  },
  {
    at: 21,
    title: 'The love theme',
    text: 'Flutes, oboes and cor anglais sing the long melody; the horns hold it up.',
    featured: ['rj-flutes-oboes', 'rj-brass'],
  },
  {
    at: 60,
    title: 'The theme swells',
    text: 'The dark cor anglais leads; the whole orchestra grows around it.',
    featured: ['rj-flutes-oboes', 'rj-violins', 'rj-cellos-basses'],
  },
  {
    at: 99,
    title: 'Hushed strings',
    text: 'Winds and horns fall silent; the strings sway gently over the harp.',
    featured: ['rj-violins', 'rj-violas', 'rj-harp-percussion'],
  },
  {
    at: 123,
    title: 'An echo of the tune',
    text: 'The cor anglais remembers the melody, quietly, over the harp.',
    featured: ['rj-flutes-oboes', 'rj-harp-percussion'],
  },
  {
    at: 144,
    title: 'Fading away',
    text: 'The strings fall silent; cor anglais, clarinets and harp close the scene.',
    featured: ['rj-flutes-oboes', 'rj-clarinets-bassoons', 'rj-harp-percussion'],
  },
];

export const romeoJuliet: PieceEntry = {
  piece,
  composer: 'Tchaikovsky',
  short: 'Romeo and Juliet',
  finaleTitle: 'Tchaikovsky · Romeo and Juliet, Fantasy Overture · the love theme',
  creditLine: 'Tchaikovsky · Romeo and Juliet · Colibrì Ensemble · The Spheres Dataset · CC BY-SA 4.0',
  guide: romeoJulietGuide,
  challenges: [
    {
      kind: 'solo',
      ids: ['rj-flutes-oboes'],
      xr: ['Who sings the love theme?', 'Find them and listen to them alone.'],
      success: ['The flutes, oboes and cor anglais.', 'The cor anglais is the dark, tender voice you hear.'],
      celebrate: 'rj-flutes-oboes',
    },
    {
      kind: 'solo',
      ids: ['rj-brass'],
      xr: ['Something holds the love theme up', 'from underneath. Find it and listen alone.'],
      success: ['The horns.', 'Trumpets and trombones stay silent here, saved for the fight.'],
      celebrate: 'rj-brass',
    },
    {
      kind: 'seat',
      left: 'rj-violins',
      right: 'rj-cellos-basses',
      xr: ['Seat the strings as on a stage:', 'violins on your left, cellos and basses on your right.'],
      desk: ['Seat the strings as on a stage: drag the violins', 'to your left, and the cellos and basses to your right.'],
      success: ['That is how an orchestra sits.', 'High on the left, low on the right.'],
      celebrate: 'rj-violins',
    },
  ],
};
