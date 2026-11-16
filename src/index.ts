import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { prepareAudio } from './audio/app-audio.js';
import { WholeBallSystem } from './systems/whole-ball.js';

// Decode the music now; unlock sound on the first click (e.g. Enter XR).
prepareAudio();

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(WholeBallSystem);
  // Development only: lets the browser console inspect the running world.
  if (import.meta.env.DEV) (window as unknown as { __world: unknown }).__world = world;
});
