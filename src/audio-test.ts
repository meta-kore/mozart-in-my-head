// Desktop test page for the audio engine (audio-test.html). No XR.
import { AudioEngine, VOICE_NAMES } from './audio/engine.js';
import { fugue, type VoiceName } from './music/fugue.js';

const COLOURS: Record<VoiceName, string> = {
  bass: '#ff8a5c',
  tenor: '#ffd166',
  alto: '#5ce1a5',
  soprano: '#8fb3ff',
};

// Same layout as the Apart state: an arc in front of the listener, bass on
// the left through soprano on the right.
const START_X: Record<VoiceName, number> = { bass: -0.3, tenor: -0.1, alto: 0.1, soprano: 0.3 };

const engine = new AudioEngine(fugue);
const playButton = document.getElementById('play') as HTMLButtonElement;
const positionLabel = document.getElementById('position') as HTMLSpanElement;
const container = document.getElementById('voices') as HTMLDivElement;

const state = Object.fromEntries(
  VOICE_NAMES.map((v) => [v, { volume: 1, x: START_X[v] }]),
) as Record<VoiceName, { volume: number; x: number }>;
let soloed: VoiceName | null = null;
const meters = new Map<VoiceName, HTMLDivElement>();
const soloButtons = new Map<VoiceName, HTMLButtonElement>();
const flash = new Map<VoiceName, number>();

for (const voice of ['bass', 'tenor', 'alto', 'soprano'] as VoiceName[]) {
  const row = document.createElement('div');
  row.className = 'voice';
  row.style.setProperty('--c', COLOURS[voice]);
  row.innerHTML = `
    <strong>${voice[0].toUpperCase() + voice.slice(1)}</strong>
    <div class="meter"><div></div></div>
    <div class="controls">
      <label>Volume <input type="range" min="0" max="1" step="0.01" value="1" data-k="volume"></label>
      <label>Left / right <input type="range" min="-1" max="1" step="0.01" value="${START_X[voice]}" data-k="x"></label>
    </div>
    <div class="controls"><button aria-pressed="false">Solo</button></div>`;
  container.append(row);
  meters.set(voice, row.querySelector('.meter div') as HTMLDivElement);

  row.querySelectorAll('input').forEach((input) =>
    input.addEventListener('input', () => {
      state[voice][input.dataset.k as 'volume' | 'x'] = Number(input.value);
      applyMix();
    }),
  );
  const solo = row.querySelector('button') as HTMLButtonElement;
  soloButtons.set(voice, solo);
  solo.addEventListener('click', () => {
    soloed = soloed === voice ? null : voice;
    soloButtons.forEach((b, v) => b.setAttribute('aria-pressed', String(v === soloed)));
    applyMix();
  });
}

function applyMix(): void {
  for (const voice of VOICE_NAMES) {
    const ducked = soloed !== null && soloed !== voice;
    engine.setVoiceGain(voice, state[voice].volume * (ducked ? 0.1 : 1), 0.25);
    engine.setVoicePosition(voice, { x: state[voice].x, y: 0, z: -0.45 });
  }
}

playButton.addEventListener('click', async () => {
  if (!engine.started) {
    await engine.start();
    engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    applyMix();
  } else if (engine.playing) {
    await engine.pause();
  } else {
    await engine.resume();
  }
  playButton.textContent = engine.playing ? 'Pause' : 'Play';
});

document.addEventListener('visibilitychange', () => {
  void engine.setAppVisible(document.visibilityState === 'visible');
});

function frame(): void {
  for (const e of engine.takeOnsets()) flash.set(e.voice, 1);
  for (const voice of VOICE_NAMES) {
    const level = Math.min(1, engine.voiceLevel(voice) * 6);
    const f = (flash.get(voice) ?? 0) * 0.85;
    flash.set(voice, f);
    const meter = meters.get(voice)!;
    meter.style.width = `${Math.round(level * 100)}%`;
    meter.style.opacity = String(0.6 + 0.4 * f);
  }
  const beats = engine.positionBeats();
  positionLabel.textContent =
    beats === null
      ? 'stopped'
      : `bar ${Math.min(27, Math.floor(beats / 4) + 1)} of 27${engine.playing ? '' : ' (paused)'}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
