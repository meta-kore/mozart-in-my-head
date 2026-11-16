// Listening test for the Mozart 40 section stems (stems-test.html). No XR.
import { StemPlayer } from './audio/stems.js';
import { mozart40 } from './music/mozart40.js';

// Seats spread over 0.9 m, left to right as the listener faces the arc.
const SECTIONS = mozart40.sections.map((s) => ({ ...s, x: s.seat * 0.45 }));

const base = import.meta.env.BASE_URL;
const player = new StemPlayer(
  SECTIONS.map((s) => ({ id: s.id, url: `${base}${mozart40.stemPath}/${s.id}.ogg` })),
);

const playButton = document.getElementById('play') as HTMLButtonElement;
const abButton = document.getElementById('ab') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;
const container = document.getElementById('stems') as HTMLDivElement;

const state = new Map(SECTIONS.map((s) => [s.id, { volume: s.gain, x: s.x }]));
let soloed: string | null = null;
const meters = new Map<string, HTMLDivElement>();
const soloButtons = new Map<string, HTMLButtonElement>();

for (const s of SECTIONS) {
  const row = document.createElement('div');
  row.className = 'stem';
  row.style.setProperty('--c', s.colour);
  row.innerHTML = `
    <strong>${s.label}<br><small style="color:var(--muted);font-weight:400">${s.instruments}</small></strong>
    <div class="controls">
      <label>Volume <input type="range" min="0" max="2" step="0.01" value="${s.gain}" data-k="volume"></label>
      <label>Left / right <input type="range" min="-1" max="1" step="0.01" value="${s.x}" data-k="x"></label>
    </div>
    <button aria-pressed="false">Solo</button>
    <div class="meter"><div></div></div>`;
  container.append(row);
  meters.set(s.id, row.querySelector('.meter div') as HTMLDivElement);
  row.querySelectorAll('input').forEach((input) =>
    input.addEventListener('input', () => {
      state.get(s.id)![input.dataset.k as 'volume' | 'x'] = Number(input.value);
      applyMix();
    }),
  );
  const solo = row.querySelector('button') as HTMLButtonElement;
  soloButtons.set(s.id, solo);
  solo.addEventListener('click', () => {
    soloed = soloed === s.id ? null : s.id;
    soloButtons.forEach((b, id) => b.setAttribute('aria-pressed', String(id === soloed)));
    applyMix();
  });
}

let plain = false;
function applyMix(): void {
  for (const s of SECTIONS) {
    const st = state.get(s.id)!;
    const ducked = soloed !== null && soloed !== s.id;
    player.setGain(s.id, plain ? 1 : st.volume * (ducked ? 0.1 : 1), 0.25);
    player.setPosition(s.id, plain ? { x: 0, y: 0, z: -0.6 } : { x: st.x, y: 0, z: -0.6 });
  }
}

abButton.addEventListener('click', () => {
  plain = !plain;
  abButton.setAttribute('aria-pressed', String(plain));
  applyMix();
});

playButton.addEventListener('click', async () => {
  if (!player.started) {
    playButton.disabled = true;
    status.textContent = 'loading…';
    const t0 = performance.now();
    try {
      await player.start((d, n) => (status.textContent = `decoded ${d} of ${n}`));
    } catch (err) {
      status.textContent = `failed: ${(err as Error).message}`;
      playButton.disabled = false;
      return;
    }
    player.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    applyMix();
    console.info(
      `stems ready in ${((performance.now() - t0) / 1000).toFixed(1)}s, ` +
        `${player.decodedMegabytes().toFixed(0)} MB decoded, loop ${player.loopLength.toFixed(2)}s`,
    );
    playButton.disabled = false;
  } else if (player.playing) {
    await player.pause();
  } else {
    await player.resume();
  }
  playButton.textContent = player.playing ? 'Pause' : 'Play';
});

document.addEventListener('visibilitychange', () => {
  void player.setAppVisible(document.visibilityState === 'visible');
});

function frame(): void {
  for (const s of SECTIONS) {
    const level = Math.min(1, player.level(s.id) * 5);
    meters.get(s.id)!.style.width = `${Math.round(level * 100)}%`;
  }
  const pos = player.position();
  if (pos !== null) {
    const m = Math.floor(pos / 60);
    const sec = Math.floor(pos % 60).toString().padStart(2, '0');
    const total = player.loopLength;
    status.textContent = `${m}:${sec} of ${Math.floor(total / 60)}:${Math.floor(total % 60)
      .toString()
      .padStart(2, '0')}${player.playing ? '' : ' (paused)'}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
