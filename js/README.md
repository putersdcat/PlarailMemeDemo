# JS modules

No npm runtime dependencies. Browser loads ES modules; tests run with Node.

## Layout

| Path | Role |
|------|------|
| `main.js` | App bootstrap, input, loop (orchestrator) |
| `geometry.js` | Barrel re-export |
| `geometry/units-math.js` | Units, math, piece meta |
| `geometry/piece-templates.js` | Shapes, pivots, `worldGeometry` |
| `track.js` | Board, snap, graph, serialize/load, colors |
| `train.js` | On-rail path following + public train API |
| `train/constants.js` | Modes, wheelbase, re-rail windows |
| `train/pose.js` | Create train, axles, hit-test |
| `train/off-rail.js` | Wall glide (fixed steps) + re-rail |
| `render.js` | Scene, palette icons |
| `render/draw-piece.js` | Track piece drawing |
| `render/draw-train.js` | Bullet-train sprite |
| `sound.js` | Web Audio plastic gear motor + clacks |
| `presets.js` | Gold-standard layout + oval helpers |
| `app/paint.js` | One-shot paint bucket UI |
| `app/io.js` | Save/load/localStorage |
| `app/camera.js` | Pan, zoom, fit, playfield bounds |

## Tests

```bash
npm test
# or
node tests/run.mjs
```

Smoke tests cover: full catalog templates, meme layout round-trip, derail motion, camera math, sound API surface.

## Tooling

| Script | Role |
|--------|------|
| `scripts/record-demo.mjs` | Playwright demo capture (1080p/480p + screenshot) |
| `scripts/gen-presets.mjs` | Regenerate `presets.js` body from `layouts/real-meme-track.json` |
