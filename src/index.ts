import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { music, prepareAudio } from './audio/app-audio.js';
import { GuideSystem } from './systems/guide.js';
import { SectionsSystem } from './systems/sections.js';
import { WholeBallSystem } from './systems/whole-ball.js';

// Decode the music now (with progress on the page); unlock sound on the
// first click (e.g. Enter XR).
const status = document.getElementById('load-status');
prepareAudio((done, total) => {
  if (status) status.textContent = done < total ? `Tuning the orchestra… ${done} of ${total}` : 'Ready.';
});

// On a computer the page's instructions shrink to one line once the music
// starts, so they no longer cover the scene.
const intro = document.getElementById('intro');
const compactTimer = setInterval(() => {
  if (music.started) {
    intro?.classList.add('compact');
    clearInterval(compactTimer);
  }
}, 500);

/** The bundled title font (SIL OFL), loaded before any text is drawn. */
async function loadFonts(): Promise<void> {
  try {
    const face = new FontFace('Cormorant Garamond', `url(${import.meta.env.BASE_URL}fonts/CormorantGaramond.woff2)`, {
      weight: '300 700',
    });
    document.fonts.add(await Promise.race([face.load(), new Promise<never>((_, no) => setTimeout(no, 3000))]));
  } catch {
    // Fall back to the system serif; nothing else depends on the font.
  }
}

void loadFonts().then(() =>
  World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
    world.registerSystem(WholeBallSystem);
    world.registerSystem(SectionsSystem);
    world.registerSystem(GuideSystem);
    // Development only: lets the browser console inspect the running world.
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __world: world,
        __music: music,
        __sections: world.getSystem(SectionsSystem),
        __guide: world.getSystem(GuideSystem),
      });
      if (new URLSearchParams(location.search).has('demo')) {
        void import('./dev/demo.js').then((m) => m.installDemo(world));
      }
      if (new URLSearchParams(location.search).has('grabtest')) {
        void import('./dev/grab-test.js').then((m) => world.registerSystem(m.GrabTestSystem));
      }
    }
  }),
);
