# JS modules

No npm runtime dependencies. Browser loads ES modules; tests run with Node.

## Layout

| Path | Role |
|------|------|
| `main.js` | App bootstrap, input, loop (still the largest orchestrator) |
| `geometry.js` | Barrel re-export |
| `geometry/core.js` | Units, math, pivots, piece meta |
| `geometry/templates.js` | `buildTemplate` / piece shapes / `worldGeometry` |
| `track.js` | Board, snap, graph, serialize/load, colors |
| `train.js` | Train state machine (on-rail / off-rail / edge follow) |
| `render.js` | Scene + track drawing |
| `render/train.js` | Bullet-train sprite |
| `sound.js` | Web Audio synth (motor, scrape, clacks) |
| `presets.js` | Gold-standard layout + oval helpers |
| `app/paint.js` | One-shot paint bucket UI |
| `app/io.js` | Save/load/localStorage helpers (optional host) |

## Tests

```bash
npm test
# or
node tests/run.mjs
```
