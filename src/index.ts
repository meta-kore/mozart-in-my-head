import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { music, prepareAudio } from './audio/app-audio.js';
import { SectionsSystem } from './systems/sections.js';
import { WholeBallSystem } from './systems/whole-ball.js';

// Decode the music now; unlock sound on the first click (e.g. Enter XR).
prepareAudio();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(WholeBallSystem);
  world.registerSystem(SectionsSystem);
  // Development only: lets the browser console inspect the running world.
  if (import.meta.env.DEV) {
    Object.assign(window, { __world: world, __music: music, __sections: world.getSystem(SectionsSystem) });
    if (new URLSearchParams(location.search).has('grabtest')) {
      void import('./dev/grab-test.js').then((m) => world.registerSystem(m.GrabTestSystem));
    }
  }
});
