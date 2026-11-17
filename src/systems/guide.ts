import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { cues, music } from '../audio/app-audio.js';
import { BallStates, MusicBall } from '../components.js';
import { cueIndexAt, currentPiece, pieceState, type Challenge } from '../music/piece.js';
import { createTextPanel, type TextLine, type TextPanel } from '../visuals/glow-ball.js';
import { SectionsSystem } from './sections.js';
import { faceViewer, readViewer } from './viewer.js';

/** Seconds a "yes, that's it" message stays before the next step appears. */
const SUCCESS_SECONDS = 3.8;
/** A step must be on show this long before it can be completed. */
const MIN_STEP_SECONDS = 1.2;
/** How long the finale message stays. */
const FINALE_SECONDS = 20;
/** Seating challenge: how far left / right of the head counts (metres). */
const SIDE_MARGIN = 0.05;
const GOLD = '#f3d9a4';
const SOFT = '#c9cbd8';

interface Step {
  /** Lines in a headset, and on a computer (mouse). */
  xr: [string, string];
  desk?: [string, string];
  /** Listening challenge number (1-based), or 0 for a how-to lesson. */
  challenge: number;
  done(g: GuideSystem, s: SectionsSystem): boolean;
  /** Shown when done, with a chime and a celebration on `celebrate`. */
  success?: [string, string];
  celebrate?: string;
}

const CHALLENGES = 3;
/** Steps before the piece's challenges (the two how-to lessons). */
const LESSONS = 2;

const LESSON_STEPS: Step[] = [
  {
    xr: ['Pinch a section and move it.', 'Its sound moves with it.'],
    desk: ['Drag a section to move it.', 'Scroll over one to bring it nearer or push it away.'],
    challenge: 0,
    done: (_g, s) => s.grabs > 0,
  },
  {
    xr: ['Hold one up to your ear', 'to hear it alone.'],
    desk: ['Click a section to hear it alone.', 'Click it again to bring the others back.'],
    challenge: 0,
    done: (_g, s) => s.soloIndex >= 0,
  },
];

const MERGE_STEP: Step = {
  xr: ['Bring any two together', 'to rebuild the music.'],
  desk: ['Drag one section onto another', 'to rebuild the music (or press S).'],
  challenge: 0,
  done: (g, s) => s.merges > g.mergesAtStep,
};

function challengeStep(c: Challenge, n: number): Step {
  return {
    xr: c.xr,
    desk: c.desk,
    challenge: n,
    success: c.success,
    celebrate: c.celebrate,
    done:
      c.kind === 'solo'
        ? (g, s) => c.ids.some((id) => s.soloIndex === g.idx(id))
        : (g, s) => s.sideways(g.idx(c.left)) < -SIDE_MARGIN && s.sideways(g.idx(c.right)) > SIDE_MARGIN,
  };
}

/** The guided steps for the current piece: lessons, its three challenges, then put it back. */
function buildSteps(): Step[] {
  return [...LESSON_STEPS, ...currentPiece().challenges.map((c, i) => challengeStep(c, i + 1)), MERGE_STEP];
}

/**
 * The listening guide: a "now playing" caption that follows the piece's
 * structure and highlights the sections carrying it; a short sequence of
 * lessons and listening challenges in the Apart state; and a finale with
 * the credits once the orchestra is put back together.
 */
export class GuideSystem extends createSystem({
  whole: { required: [MusicBall] },
}) {
  private instruction!: TextPanel;
  private caption!: TextPanel;
  private finalePanel!: TextPanel;
  private step = 0;
  private stepSeconds = 0;
  private successSeconds = 0;
  private finaleSeconds = 0;
  private finaleDue = false;
  private shownStep = -1;
  private shownDesk = false;
  private shownCue = -1;
  /** The step's sections.merges when it began (for the merge step). */
  mergesAtStep = 0;
  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly wholePos = new Vector3();
  private readonly labelPos = new Vector3();
  private sections!: SectionsSystem;
  private steps: Step[] = buildSteps();
  private pieceVersion = pieceState.version;

  init(): void {
    this.instruction = this.panel('GuideInstruction', 0.36, 1024, 300);
    this.caption = this.panel('GuideCaption', 0.32, 1024, 190);
    this.finalePanel = this.panel('GuideFinale', 0.44, 1024, 520);
  }

  private panel(name: string, width: number, w: number, h: number): TextPanel {
    const p = createTextPanel(width, w, h, { plate: true });
    p.mesh.name = name;
    p.mesh.raycast = () => {};
    p.mesh.visible = false;
    this.world.createTransformEntity(p.mesh, { persistent: true });
    return p;
  }

  /** Index of a section by id. */
  idx(id: string): number {
    return this.sections.indexOf(id);
  }

  /** True once the guided steps and the finale are complete. */
  get finished(): boolean {
    return this.step >= this.steps.length && !this.finaleDue;
  }

  update(delta: number): void {
    this.sections ??= this.world.getSystem(SectionsSystem)!;
    const s = this.sections;
    let whole: ReturnType<typeof this.wholeEntity>;
    if (!s || !(whole = this.wholeEntity())) return;
    readViewer(this, this.head, this.headQuat);
    if (this.pieceVersion !== pieceState.version) this.onPieceChanged();
    const state = whole.getValue(MusicBall, 'state') as string;
    whole.object3D?.getWorldPosition(this.wholePos);
    const apart = state === BallStates.Apart && s.settled;

    // "Now playing": the passage, and its sections highlighted.
    const t = music.position();
    const guide = currentPiece().guide;
    const cueIdx = t === null ? -1 : cueIndexAt(guide, t);
    if (cueIdx !== this.shownCue) {
      this.shownCue = cueIdx;
      const cue = guide[cueIdx];
      if (cue) {
        this.caption.setText([
          { text: cue.title, size: 66, font: 'serif', weight: 600, colour: GOLD },
          { text: cue.text, size: 34, colour: SOFT },
        ]);
      }
      s.setFeatured(cue?.featured ?? []);
    }

    this.updateSteps(delta, apart, s);
    this.updateFinale(delta, state);

    // Layout: the instruction above the arc, the caption above that.
    const ins = this.instruction.mesh;
    ins.visible = apart && this.step < this.steps.length;
    if (ins.visible) {
      ins.position.copy(s.panelAnchor);
      faceViewer(ins, this.head);
    }
    const cap = this.caption.mesh;
    cap.visible = apart && cueIdx >= 0;
    if (cap.visible) {
      cap.position.copy(s.panelAnchor);
      cap.position.y += ins.visible ? 0.105 : 0.02;
      faceViewer(cap, this.head);
    }
  }

  private updateSteps(delta: number, apart: boolean, s: SectionsSystem): void {
    const STEPS = this.steps;
    if (this.step >= STEPS.length) return;
    if (this.successSeconds > 0) {
      this.successSeconds -= delta;
      if (this.successSeconds <= 0) this.advance(s);
      return;
    }
    const step = STEPS[this.step];
    // The last step (putting it back) completes the moment the sections merge.
    const last = this.step === STEPS.length - 1;
    if (!apart && !(last && this.stepSeconds > 0)) return;
    if (apart) this.stepSeconds += delta;
    const desk = !s.immersive;
    if (apart && (this.shownStep !== this.step || this.shownDesk !== desk)) this.showStep(step, desk);
    if ((!last && this.stepSeconds < MIN_STEP_SECONDS) || !step.done(this, s)) return;

    if (last) this.finaleDue = true;
    if (step.success) {
      this.successSeconds = SUCCESS_SECONDS;
      this.instruction.setText([
        { text: `Listening challenge ${step.challenge} of ${CHALLENGES}  ✓`, size: 30, colour: GOLD, weight: 600 },
        { text: step.success[0], size: 58, font: 'serif', weight: 600, gap: 0.15 },
        { text: step.success[1], size: 40, colour: SOFT },
      ]);
      cues.play('success');
      if (step.celebrate) s.celebrate(this.idx(step.celebrate));
    } else {
      this.advance(s);
    }
  }

  /**
   * A new piece: its own captions and challenges. Lessons already learnt stay
   * learnt; the challenges start again from the first.
   */
  private onPieceChanged(): void {
    this.pieceVersion = pieceState.version;
    this.steps = buildSteps();
    if (this.step > LESSONS) this.step = LESSONS;
    this.stepSeconds = 0;
    this.successSeconds = 0;
    this.finaleDue = false;
    this.finaleSeconds = 0;
    this.shownStep = -1;
    this.shownCue = -1;
  }

  private advance(s: SectionsSystem): void {
    this.step++;
    this.stepSeconds = 0;
    this.successSeconds = 0;
    this.mergesAtStep = s.merges;
  }

  private showStep(step: Step, desk: boolean): void {
    this.shownStep = this.step;
    this.shownDesk = desk;
    const [a, b] = desk && step.desk ? step.desk : step.xr;
    const lines: TextLine[] = [];
    if (step.challenge > 0) {
      lines.push({ text: `Listening challenge ${step.challenge} of ${CHALLENGES}`, size: 30, colour: GOLD, weight: 600 });
    }
    lines.push({ text: a, size: 56, font: step.challenge > 0 ? 'serif' : 'sans', weight: 600, gap: 0.1 });
    lines.push({ text: b, size: 40, colour: SOFT });
    this.instruction.setText(lines);
  }

  private updateFinale(delta: number, state: string): void {
    const panel = this.finalePanel.mesh;
    if (this.finaleDue && state === BallStates.Playing) {
      this.finaleDue = false;
      this.finaleSeconds = FINALE_SECONDS;
      this.sections.finale(this.wholePos);
      cues.play('finale', this.wholePos);
      this.finalePanel.setText([
        { text: 'Bravo!', size: 120, font: 'serif', weight: 600, colour: GOLD },
        { text: `You took ${currentPiece().composer}’s orchestra apart and put it back together.`, size: 38 },
        { text: 'Pull it apart again, or try another piece.', size: 34, colour: SOFT },
        { text: currentPiece().finaleTitle, size: 28, colour: '#a9acbd', gap: 0.9 },
        { text: 'Performed by the Colibrì Ensemble · The Spheres Dataset · CC BY-SA 4.0', size: 26, colour: '#a9acbd' },
      ]);
    }
    if (this.finaleSeconds > 0 && state !== BallStates.Apart) {
      this.finaleSeconds -= delta;
      panel.visible = true;
      const label = this.world.scene.getObjectByName('WholeBallLabel');
      if (label) label.getWorldPosition(this.labelPos);
      else this.labelPos.copy(this.wholePos);
      panel.position.copy(this.labelPos);
      panel.position.y += 0.165;
      faceViewer(panel, this.head);
      const fade = Math.min(1, this.finaleSeconds / 1.5, (FINALE_SECONDS - this.finaleSeconds) / 0.6);
      panel.material.opacity = fade;
    } else {
      if (state === BallStates.Apart) this.finaleSeconds = 0;
      panel.visible = false;
    }
  }

  private wholeEntity() {
    for (const e of this.queries.whole.entities) return e;
    return undefined;
  }
}
