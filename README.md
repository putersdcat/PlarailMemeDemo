# Plarail Meme — Real-2-Sim

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Play demo](https://img.shields.io/badge/demo-github.io-blue)](https://putersdcat.github.io/PlarailMemeDemo/)

Browser simulation of a Takara Tomy **Plarail**-style track set: magnetic snap building, paint colors, a white bullet engine that follows rails, derails at open ends, slides along plastic walls with a coffee-grinder motor, and re-rails when geometry allows.

**No build step, no npm runtime deps** — plain HTML + ES modules + Canvas + Web Audio.

## Play online

### [▶ Open the live demo on GitHub Pages](https://putersdcat.github.io/PlarailMemeDemo/)

Serve locally if you prefer:

```bash
# from the repo root
python -m http.server 8765
# or: npm run serve
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Inspiration

The layout and vibe come from this meme / layout energy:

<blockquote class="twitter-tweet"><p lang="en" dir="ltr">how my codebase written entirely with claude code runs <a href="https://t.co/sPDmqn63I2">pic.twitter.com/sPDmqn63I2</a></p>&mdash; Markov (@MarkovMagnifico) <a href="https://x.com/MarkovMagnifico/status/2012930198354764058?ref_src=twsrc%5Etfw">January 18, 2026</a></blockquote>
<script async src="https://platform.x.com/widgets.js" charset="utf-8"></script>

Fallback link (GitHub.com strips widgets.js; the [live demo](https://putersdcat.github.io/PlarailMemeDemo/) page can load the widget):  
[https://x.com/MarkovMagnifico/status/2012930198354764058](https://x.com/MarkovMagnifico/status/2012930198354764058)

> how my codebase written entirely with claude code runs  
> — Markov ([@MarkovMagnifico](https://x.com/MarkovMagnifico)), 18 Jan 2026

## Controls

| Input | Action |
|-------|--------|
| **Left-drag** from palette | Place track; **magnetic snap** when open ends get close |
| **Left-drag** a placed piece | Move with the same snap |
| **Box-select** / multi-drag | Move groups with group snap |
| **Right-click rail** / train tool | Place or seat the train |
| **Right-click piece** | Rotate 45° |
| **Yellow lever** | Cycle switch |
| **Paint swatches** | One-shot color a piece (blue / green / red / yellow / gray) |
| **Save JSON / Load JSON** | Download layout (+ browser autosave) |
| **R** / **F** / **Del** | Rotate / flip / delete |
| **Space** | Start / stop |

## Behaviour

1. **On rails** — follows the connected path graph (switches respected).
2. **Open end** — derails onto the floor with the same heading.
3. **Off rails** — soft wall-slide on track outer edges (compact physics wheelbase).
4. **Re-rail** — tight alignment window so drive-bys past perpendicular track do not steal the train.
5. **Canvas edge** — free train hits the playfield bound → **Stopped**; reset and place again.

Motor SFX is a synth “tiny coffee grinder” (Web Audio, no sample packs).

## Project layout

| Path | Role |
|------|------|
| `index.html` | Shell UI |
| `css/styles.css` | Layout / toolbar |
| `js/main.js` | Wiring, loop, I/O |
| `js/track.js` | Board, snap, serialize |
| `js/train.js` | Path follow, derail, wall glide |
| `js/sound.js` | Web Audio motor + impacts |
| `js/geometry/` | Piece templates + units |
| `layouts/real-meme-track.json` | Default gold-standard layout (with paint) |
| `tests/` | Node unit tests (`npm test`) |

## Docs

| File | Contents |
|------|----------|
| `DESIGN.md` | States, snapping, on/off-rail physics |
| `plarail_meme_track_components.md` | Piece inventory / product notes |
| `plarail_r01_to_r17_table.md` | Dimensional table |
| `js/README.md` | Module map |

## Develop

```bash
npm test          # node tests/run.mjs
npm run serve     # python -m http.server 8765
```

Hard-refresh after JS changes (cache-busted `?v=` on entry assets).

## License

[MIT](LICENSE) © 2026 Eric Anderson

Plarail is a trademark of Takara Tomy. This is an unofficial fan demo and is not affiliated with Takara Tomy.
