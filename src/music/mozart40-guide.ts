// A listening guide to the first-movement exposition of Mozart's Symphony
// No. 40, timed to this recording's loop (seconds). The times were read from
// each section's loudness in the stems (scripts' analysis, November 2026);
// the descriptions follow the standard analysis of the score.

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

export const mozart40Guide: Cue[] = [
  {
    at: 0,
    title: 'First theme',
    text: 'Violas set off a restless pulse; the violins sing the sighing tune.',
    featured: ['violins-1', 'violas'],
  },
  {
    at: 16,
    title: 'Winds and horns join',
    text: 'Held notes in the winds lift the music towards a loud answer.',
    featured: ['flute-oboes', 'clarinets-bassoons', 'horns'],
  },
  {
    at: 20,
    title: 'The full orchestra',
    text: 'Everyone together, loud: horns and basses drive it home.',
    featured: ['horns', 'cellos-basses'],
  },
  {
    at: 25,
    title: 'The tune again',
    text: 'Quiet once more: the violins restart the theme.',
    featured: ['violins-1', 'violins-2'],
  },
  {
    at: 34,
    title: 'Transition',
    text: 'Loud and driving, the orchestra travels to a new, brighter key.',
    featured: ['cellos-basses', 'horns', 'violins-1'],
  },
  {
    at: 52,
    title: 'A breath',
    text: 'Silence. Listen for what comes next.',
    featured: [],
  },
  {
    at: 54,
    title: 'Second theme',
    text: 'Strings and woodwinds trade a gliding, chromatic phrase.',
    featured: ['violins-1', 'clarinets-bassoons', 'flute-oboes'],
  },
  {
    at: 69,
    title: 'The second theme grows',
    text: 'The phrases overlap, and the whole orchestra builds.',
    featured: ['clarinets-bassoons', 'violins-1'],
  },
  {
    at: 77,
    title: 'All together',
    text: 'A loud climax: listen to the horns underneath.',
    featured: ['horns', 'cellos-basses'],
  },
  {
    at: 87,
    title: 'The opening motif returns',
    text: 'Clarinets and bassoons pass the sighing figure back and forth.',
    featured: ['clarinets-bassoons'],
  },
  {
    at: 95,
    title: 'Closing',
    text: 'The full orchestra hammers home the new key, then the exposition repeats.',
    featured: ['horns', 'cellos-basses', 'violins-1'],
  },
];

/** Index of the passage playing at loop time `t` (seconds). */
export function cueIndexAt(t: number): number {
  let i = 0;
  while (i + 1 < mozart40Guide.length && mozart40Guide[i + 1].at <= t) i++;
  return i;
}
