# Credits

## Music

### Mozart, Symphony No. 40 (the music the app plays)

**Wolfgang Amadeus Mozart (1756–1791), Symphony No. 40 in G minor, K. 550**, first movement, exposition. The composition is in the public domain.

- **Performance and recording:** the Colibrì Ensemble, recorded at The Spheres studio, published as **The Spheres Dataset**.
- **Source:** https://zenodo.org/records/17347681 (DOI 10.5281/zenodo.17347680), file `TheSpheresDataset-Multichannel.zip`, folder `TheSpheres_data/Mozart/StereoMix/`.
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/

**Changes made:** the 14 instrument lines were folded to mono, summed into seven sections (first violins; second violins; violas; cellos and basses; flute and oboes; clarinets and bassoons; horns), trimmed to the opening 123.55 seconds (the exposition, up to its repeat), crossfaded at the loop point, scaled by one common gain and encoded as Ogg Opus. The script that does this is `scripts/make_stems.py`.

The resulting files in `public/stems/mozart40/` are an adaptation of the dataset and are licensed under **CC BY-SA 4.0**, not under the MIT licence that covers the code. See `public/stems/mozart40/LICENSE.txt`.

### Bach, Fugue in C major (synthesised fallback)

The repository also contains a synthesised fallback that plays **J. S. Bach's Fugue in C major, BWV 846** from note data, with no recordings.

- **Note data:** Mutopia Project, "Das Wohltemperierte Clavier I, Fuga I", reference Mutopia-2013/03/22-4, https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=4
- **Entered by:** Shay Rojansky, updated and maintained by Andreas Scherer.
- **Licence:** Public Domain. The file's header reads `copyright = "Public Domain"`, and the typesetter placed the edition in the public domain under the Creative Commons public-domain dedication.

`src/music/fugue.ts` is generated from the copy in `scripts/source/wtk1-fugue1.ly` by `scripts/ly-to-fugue.mjs`.

## Software

- [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) by Meta, MIT licence. Parts of `vite.config.ts` and the project setup come from its starter template.
- [Three.js](https://threejs.org/), MIT licence.
