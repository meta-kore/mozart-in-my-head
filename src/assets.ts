import { defineAssets } from '@iwsdk/core';
import { createDarkFloor } from './scene-assets/room.scene-asset.js';

// Everything is built in code or synthesised at run time: no models, no audio
// files, and no requests to any other host, so the app works offline.
export default defineAssets({
  'dark-floor': createDarkFloor(),
});
