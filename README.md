# Bach in My Head

A hands-first VR music toy for Meta Quest, built with Meta's Immersive Web SDK (WebXR). A Bach fugue floats in front of you as one glowing ball. Take it in both hands and pull it apart into its four voices, place each voice around you, and hear the music come from where you put it.

Entry for the Meta VR Start Developer Competition 2026 (Entertainment track).

**Live:** https://meta-kore.github.io/bach-in-my-head/

**Status:** work in progress. The project is scaffolded and deployed, with an empty dark room. Music and interaction are not built yet.

**Tested on:** the IWER emulator (Quest 3 profile) in a desktop Chromium browser. Not yet tested on a headset.

## Run locally

Requires Node 20.19+, 22.12+ or 24+.

```bash
npm install
npm run dev        # managed dev session over HTTPS (use this for a headset on the same Wi-Fi)
npm run dev:http   # plain HTTP on http://localhost:8081, for desktop browsers that refuse the dev certificate
```

Open the page, press **Enter XR**, and use the emulator toolbar to switch between controllers and hands.

```bash
npm run typecheck
npm run build      # output in dist/
```

## Deploying

GitHub Pages serves the `gh-pages` branch. The Actions workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main` once Actions can run on this account; until then, build locally and push `dist/` to `gh-pages`.

## Music

No recordings are used. The music is synthesised in the browser from note data. Score source and licence: see `CREDITS.md` (to be added with the note data).

## Licence

MIT. See `LICENSE`.
