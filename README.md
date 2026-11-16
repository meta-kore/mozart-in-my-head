# Mozart in My Head

A hands-first VR music toy for Meta Quest, built with Meta's Immersive Web SDK (WebXR). Mozart's Symphony No. 40 floats in front of you as one glowing ball. Take it in both hands and pull it apart into the sections of the orchestra, place each one around you, and hear the music come from where you put it. Bring a section to your ear to hear it alone; push them back together to rebuild the whole.

Entry for the Meta VR Start Developer Competition 2026 (Entertainment track).

**Live:** https://meta-kore.github.io/mozart-in-my-head/

**Status:** work in progress.

## Run locally

Requires Node 20.19+, 22.12+ or 24+.

```bash
npm install
npm run dev        # managed dev session over HTTPS (use this for a headset on the same Wi-Fi)
npm run dev:http   # plain HTTP on http://localhost:8081, for desktop browsers that refuse the dev certificate
```

Open the page, press **Enter XR**, and use the emulator toolbar to switch between controllers and hands.

Two desktop test pages need no headset:

- `stems-test.html`: the seven orchestral sections, with volume, position and solo for each.
- `audio-test.html`: the synthesised Bach fallback.

```bash
npm run typecheck
npm run build      # output in dist/
```

## Deploying

GitHub Pages serves the `gh-pages` branch. The Actions workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main` once Actions can run on this account; until then, build locally and push `dist/` to `gh-pages`.

## Music

A real orchestral recording: the Colibrì Ensemble's performance of Mozart's Symphony No. 40 from [The Spheres Dataset](https://zenodo.org/records/17347681). Every instrument was recorded separately, which is what lets the app pull the sections apart cleanly. Used under CC BY-SA 4.0. Details in `CREDITS.md`.

## Licence

Code: MIT, see `LICENSE`. Audio in `public/stems/`: CC BY-SA 4.0, see `public/stems/mozart40/LICENSE.txt`.
