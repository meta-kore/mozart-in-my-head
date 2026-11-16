# Mozart in My Head

**Pull a symphony apart with your hands.**

A hands-first VR music toy for Meta Quest, built with Meta's Immersive Web SDK (WebXR). Mozart's Symphony No. 40 floats in front of you as one glowing ball. Take it in both hands and pull: it comes apart into the seven sections of the orchestra, each a small glowing ball that plays from wherever you put it. Bring one to your ear to hear it alone; push two together to rebuild the whole. The music never stops.

Entry for the Meta VR Start Developer Competition 2026 (Entertainment track).

**Live:** https://meta-kore.github.io/mozart-in-my-head/

## How to play

Sit comfortably. Everything is within arm's reach, and hands are all you need.

| | Hands | Controllers | Computer (no headset) |
|---|---|---|---|
| Start the music | Touch the ball, or pinch it | Trigger at the ball | Click the ball |
| Pull it apart | Pinch it with both hands and pull them apart | Both triggers on the ball, pull apart | **S** key |
| …or with one hand | Pinch and hold the ball for 1.5 seconds | Hold the trigger on it | |
| Move a section | Pinch its ball and carry it | Grip button | |
| Hear one section alone | Hold its ball beside your ear | Same | |
| Put it back together | Bring any two balls together | Same | **S** key |

The sections, left to right as they first appear: first violins, second violins, flute and oboes, clarinets and bassoons, horns, violas, cellos and basses. Each has its own colour and name label. Each section's ball glows with its own loudness and throws sparks on its notes, so you can see who is playing. A section gets quieter as you move it away from you, and is never silent.

The music pauses when you open the Quest menu or leave VR, and carries on from the same moment.

## Run locally

Requires Node 20.19+, 22.12+ or 24+.

```bash
npm install
npm run dev        # dev session over HTTPS (use this for a headset on the same Wi-Fi)
npm run dev:http   # plain HTTP on http://localhost:8081, for desktop browsers that refuse the dev certificate
```

Open the page and press **Enter XR**. In development the page includes Meta's IWER emulator, so you can try everything without a headset; switch it to hand tracking from its toolbar.

```bash
npm run typecheck
npm run build      # output in dist/
```

`stems-test.html` is a desktop listening page: the seven sections with volume, position and solo for each.

## How it works

- **Seven real, separately recorded sections.** The recording comes from a research dataset in which every instrument was recorded on its own, so the sections come apart cleanly with no bleed between them. `scripts/make_stems.py` builds seven section stems from its 14 instrument lines and cuts the first-movement exposition (2 min 3.5 s) as a seamless loop, ending where Mozart repeats back to bar 1.
- **Web Audio.** All seven stems start on one clock, so they stay sample-locked. Each runs through its own volume control and HRTF 3D panner, placed at its ball. The listener follows your head. Volume falls with distance from your head (full within 30 cm, a 10% floor at 1 m); holding a ball within 20 cm of an ear ducks the others to 10% over a quarter second.
- **Interaction.** IWSDK's one-hand grab moves the section balls; the two-hand pull, the one-hand hold and the merge are custom systems that read fingertip positions and pinch state each frame.
- **Comfort.** Everything sits within 60 cm of a seated player. A ball let go out of reach or behind you floats back in front.
- **Offline.** Everything ships with the page: no third-party services or network requests after loading.

Source layout: `src/audio/` (stem player, mix rules, Bach synth fallback), `src/music/` (piece definitions), `src/systems/` (whole ball, sections), `src/visuals/` (glow, sparks, text), `scripts/` (stem and note-data builders).

**Tested on:** Meta's IWER emulator (Quest 3 profile, hand tracking and controllers) in desktop Chromium. Not yet tested on a physical headset.

## Music and licences

The recording is the Colibrì Ensemble's performance of Mozart's Symphony No. 40 from [The Spheres Dataset](https://zenodo.org/records/17347681), used under CC BY-SA 4.0. Details and the changes made are in `CREDITS.md`.

Code: MIT, see `LICENSE`. Audio in `public/stems/`: CC BY-SA 4.0, see `public/stems/mozart40/LICENSE.txt`.
