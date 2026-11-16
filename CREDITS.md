# Credits

## Music

**J. S. Bach (1685–1750), Fugue in C major, BWV 846**, from *The Well-Tempered Clavier*, Book 1. The composition is in the public domain.

The app uses **no recordings**. Every sound is synthesised in the browser from note data.

### Note data

- **Source:** Mutopia Project, "Das Wohltemperierte Clavier I, Fuga I", reference Mutopia-2013/03/22-4.
- **Page:** https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=4
- **File used:** https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-fugue1/wtk1-fugue1.ly (a copy is in `scripts/source/wtk1-fugue1.ly`)
- **Entered by:** Shay Rojansky, updated and maintained by Andreas Scherer.
- **Licence:** Public Domain. The file's header reads `copyright = "Public Domain"`, and the typesetter placed the edition in the public domain under the Creative Commons public-domain dedication (http://creativecommons.org/licenses/publicdomain).

`src/music/fugue.ts` is generated from that file by `scripts/ly-to-fugue.mjs`. The converter checks every bar line against the source's bar-number checks. Ornaments marked in the source (one mordent and two trills) are not yet played.

## Software

- [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) by Meta, MIT licence. Parts of `vite.config.ts` and the project setup come from its starter template.
- [Three.js](https://threejs.org/), MIT licence.
