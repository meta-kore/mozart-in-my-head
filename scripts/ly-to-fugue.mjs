// Converts the Mutopia LilyPond source of BWV 846's fugue (public domain)
// into src/music/fugue.ts. Handles only the LilyPond subset that file uses:
// \relative mode, notes with is/es accidentals, octave marks, dotted
// durations, ties, rests, two-note chords and ignorable markup.
//
//   node scripts/ly-to-fugue.mjs
//
// Every \barNumberCheck in the source is verified, so a parsing mistake that
// shifts a voice by even a 32nd note stops the script.

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = new URL('./source/wtk1-fugue1.ly', import.meta.url);
const OUTPUT = new URL('../src/music/fugue.ts', import.meta.url);
const BEATS_PER_BAR = 4; // 4/4, durations measured in quarter-note beats

const STEP_OF = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
const SEMITONE_OF = [0, 2, 4, 5, 7, 9, 11];

const ly = readFileSync(SOURCE, 'utf8');

/** Returns the body of `name = \relative <ref> { ... }` and its reference pitch. */
function voiceBlock(name) {
  const start = ly.search(new RegExp(`^${name}\\s*=\\s*\\\\relative\\s+([a-g][',]*)\\s*\\{`, 'm'));
  if (start < 0) throw new Error(`voice ${name} not found`);
  const header = ly.slice(start).match(/\\relative\s+([a-g][',]*)\s*\{/);
  let i = start + ly.slice(start).indexOf('{') + 1;
  let depth = 1;
  const bodyStart = i;
  while (depth > 0) {
    if (ly[i] === '{') depth++;
    if (ly[i] === '}') depth--;
    i++;
  }
  return { ref: header[1], body: ly.slice(bodyStart, i - 1) };
}

/** Absolute pitch as diatonic step count from C0 plus a semitone alteration. */
function parseAbsolute(token) {
  const m = token.match(/^([a-g])([',]*)$/);
  const octave = 3 + (m[2].match(/'/g) || []).length - (m[2].match(/,/g) || []).length;
  return { step: octave * 7 + STEP_OF[m[1]] };
}

/** Resolve a note name relative to the previous pitch, LilyPond-style. */
function relativeStep(prevStep, letter, marks) {
  const target = STEP_OF[letter];
  let step = prevStep - (((prevStep % 7) + 7) % 7) + target;
  // Choose the octave that puts the note within a fourth of the previous one.
  while (step - prevStep > 3) step -= 7;
  while (prevStep - step > 3) step += 7;
  for (const ch of marks) step += ch === "'" ? 7 : -7;
  return step;
}

function midiOf(step, alteration) {
  const octave = Math.floor(step / 7);
  const degree = ((step % 7) + 7) % 7;
  return (octave + 1) * 12 + SEMITONE_OF[degree] + alteration;
}

function alterationOf(suffix) {
  if (suffix === 'is') return 1;
  if (suffix === 'es' || suffix === 's') return -1;
  return 0;
}

function parseVoice(name) {
  const { ref, body } = voiceBlock(name);
  let prevStep = parseAbsolute(ref).step;
  let duration = 1; // beats; LilyPond's default is a quarter
  let time = 0;
  let pendingTie = false;
  const notes = [];

  const text = body
    .replace(/%.*$/gm, '')
    .replace(/\\bar\s+"[^"]*"/g, '')
    .replace(/[\^_]\\[a-zA-Z]+/g, ''); // ornaments and fermatas

  const tokens = text.match(
    /\\barNumberCheck\s+#\d+|\\[a-zA-Z]+|<[^>]*>[\d.]*|[a-gr](?:is|es|s)?[',]*!?\d*\.*|~|\||\[|\]/g,
  );

  for (const tok of tokens) {
    if (tok.startsWith('\\barNumberCheck')) {
      const bar = Number(tok.match(/\d+/)[0]);
      const expected = (bar - 1) * BEATS_PER_BAR;
      if (Math.abs(time - expected) > 1e-9) {
        throw new Error(`${name}: bar ${bar} check failed, at beat ${time}, expected ${expected}`);
      }
      continue;
    }
    if (tok.startsWith('\\') || tok === '|' || tok === '[' || tok === ']') continue;
    if (tok === '~') {
      pendingTie = true;
      continue;
    }

    let pitches = [];
    let durText;
    if (tok.startsWith('<')) {
      const inner = tok.slice(1, tok.indexOf('>')).trim().split(/\s+/);
      durText = tok.slice(tok.indexOf('>') + 1);
      // First chord note is relative to the previous note; the rest chain
      // from it. Afterwards the reference is the chord's first note.
      let chainStep = prevStep;
      inner.forEach((n, idx) => {
        const m = n.match(/^([a-g])(is|es|s)?([',]*)!?$/);
        const step = relativeStep(chainStep, m[1], m[3]);
        pitches.push(midiOf(step, alterationOf(m[2])));
        if (idx === 0) prevStep = step;
        chainStep = step;
      });
    } else {
      const m = tok.match(/^([a-gr])(is|es|s)?([',]*)!?(\d*)(\.*)$/);
      durText = (m[4] || '') + (m[5] || '');
      if (m[1] !== 'r') {
        const step = relativeStep(prevStep, m[1], m[3]);
        prevStep = step;
        pitches = [midiOf(step, alterationOf(m[2]))];
      }
    }

    const d = durText.match(/^(\d*)(\.*)$/);
    if (d[1]) {
      duration = 4 / Number(d[1]);
      let add = duration / 2;
      for (let k = 0; k < d[2].length; k++, add /= 2) duration += add;
    }

    if (pitches.length === 0) {
      pendingTie = false;
    } else if (pendingTie) {
      // A tie extends the previous note(s) of the same pitch.
      for (const midi of pitches) {
        const prev = [...notes].reverse().find((n) => n.midi === midi && n.start + n.duration === time);
        if (!prev) throw new Error(`${name}: tie to ${midi} at beat ${time} has no matching note`);
        prev.duration += duration;
      }
      pendingTie = false;
    } else {
      for (const midi of pitches) notes.push({ start: time, duration, midi });
    }
    time += duration;
  }
  return { notes, length: time };
}

// LilyPond variable names follow staff layout; the voice roles are confirmed
// by entry order and register (alto enters bar 1, soprano bar 2, tenor bar 4,
// bass bar 5).
const voices = {
  soprano: parseVoice('soprane'),
  alto: parseVoice('tenor'),
  tenor: parseVoice('alt'),
  bass: parseVoice('bass'),
};

const lengths = Object.values(voices).map((v) => v.length);
if (new Set(lengths).size !== 1) throw new Error(`voice lengths differ: ${lengths}`);

for (const [role, v] of Object.entries(voices)) {
  const midis = v.notes.map((n) => n.midi);
  const first = v.notes[0];
  console.log(
    `${role.padEnd(8)} notes ${String(v.notes.length).padStart(3)}  range ${Math.min(...midis)}-${Math.max(...midis)}  enters beat ${first.start} on ${first.midi}`,
  );
}

const fmt = (notes) =>
  notes.map((n) => `      { start: ${n.start}, duration: ${n.duration}, midi: ${n.midi} },`).join('\n');

const ts = `// GENERATED by scripts/ly-to-fugue.mjs from scripts/source/wtk1-fugue1.ly.
// Do not edit by hand; edit the converter and re-run it.
//
// J. S. Bach, Fugue in C major, BWV 846 (Well-Tempered Clavier, Book 1).
// Note data: Mutopia Project, Mutopia-2013/03/22-4, public domain.
// See CREDITS.md.

export interface Note {
  /** Onset in quarter-note beats from the start of the piece. */
  start: number;
  /** Length in quarter-note beats. */
  duration: number;
  /** MIDI note number (60 = middle C). */
  midi: number;
}

export type VoiceName = 'soprano' | 'alto' | 'tenor' | 'bass';

export interface Piece {
  title: string;
  /** Quarter-note beats per minute. */
  tempo: number;
  /** Total length in beats. */
  lengthBeats: number;
  voices: Record<VoiceName, Note[]>;
}

export const fugue: Piece = {
  title: 'Fugue in C major, BWV 846',
  tempo: 66,
  lengthBeats: ${lengths[0]},
  voices: {
${Object.entries(voices)
  .map(([role, v]) => `    ${role}: [\n${fmt(v.notes)}\n    ],`)
  .join('\n')}
  },
};
`;

writeFileSync(OUTPUT, ts);
console.log(`wrote ${OUTPUT.pathname} (${lengths[0]} beats)`);
