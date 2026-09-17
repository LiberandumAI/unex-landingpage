# UNEX Academy — landing

Vite + TypeScript + Three.js + GSAP ScrollTrigger + Lenis. One fixed WebGL canvas,
one gold coin (`public/assets/unex-coin.glb`, v2: 87k tris, 2K WebP textures, meshopt, 1.4 MB)
choreographed by scroll. Sections are tall wrappers with a pinned 100vh panel (the Liber
technique): the coin holds while a panel is pinned and moves in the gap between panels. Design tokens adapted from the ORYZO style reference
(warm walnut / cream / one accent), accent switched to UNEX brand red.

## Languages

Russian is the source page (`index.html`). `scripts/i18n.mjs` generates `/uz/` and `/en/` from it
using `i18n/uz.json` and `i18n/en.json` (keys are the exact Russian strings). It runs automatically
before `dev` and `build`; edit the JSON files and rebuild. Untranslated strings are listed in the log.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```

## Assets to drop in

- `public/hero-desk.jpg` — top-down desk photo for the hero (Gemini). In place.
- `public/hands.mp4` / `hands.jpg` — hands entering the frame (Kling, cropped to drop the
  watermark, re-encoded all-intra with `-g 1` so scroll scrubbing is smooth). In place.
- `public/favicon.svg` — UNEX cube mark (waiting for vector files from the client).
- Logo wordmark in a reversed (cream) version for dark backgrounds — waiting for vectors.

## Where things live

- `src/scene.ts` — Three.js scene, lights, custom environment, GLB loading, LOD pick.
- `src/main.ts` — Lenis, master scroll timeline (`KEYFRAMES` = coin pose per section),
  text reveals, nav behaviour. In dev, `window.__coin.measure()` reports the projected
  coin size in px.
- `src/style.css` — tokens and all layout. Type: Geologica 400/500 (Cyrillic + Latin).
- `index.html` — content from the client brief (RU only for now; UZ/EN are stubs).

## Model source

v2: `C:\Users\user\OneDrive\Документы\unex-coin-v2-delivery` (Blender 4.5 source, 4K textures, QA).
v1 (bronze): `...\Voyager\unex-coin\unex-coin-delivery`. Recompress after any re-export:

```bash
npx gltf-transform resize in.glb tmp.glb --width 2048 --height 2048
npx gltf-transform webp tmp.glb tmp.glb --slots baseColorTexture --quality 90
npx gltf-transform webp tmp.glb tmp.glb --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}" --near-lossless 70
npx gltf-transform meshopt tmp.glb public/assets/unex-coin.glb --level medium
```

## Deploy

Vercel, Hobby plan: every commit must be attributed to the repo owner's GitHub account (`vladislavlazarev`).
Commit as `34607118+vladislavlazarev@users.noreply.github.com` — `vlad.lazarev0303@gmail.com` belongs to
`vladislavlazarevhq` on GitHub, and `Co-Authored-By` trailers count as extra authors; either blocks the deploy.
