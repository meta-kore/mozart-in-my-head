import { defineAssets } from '@iwsdk/core';
import { createConcertHall } from './scene-assets/hall.scene-asset.js';
import { createDarkFloor } from './scene-assets/room.scene-asset.js';
import { buildInstrument } from './scene-assets/instruments.scene-asset.js';

// Everything is built in code: no models from other hosts, so the app works
// offline. The instrument emblems are listed so the editor can preview them;
// the app builds its own copies inside the section balls.
export default defineAssets({
  'dark-floor': createDarkFloor(),
  'concert-hall': createConcertHall(),
  'instrument-violin': buildInstrument('violin'),
  'instrument-cello': buildInstrument('cello'),
  'instrument-flute-oboe': buildInstrument('flute-oboe'),
  'instrument-clarinet-bassoon': buildInstrument('clarinet-bassoon'),
  'instrument-horn': buildInstrument('horn'),
});
