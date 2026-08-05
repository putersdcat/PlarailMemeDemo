# Plarail Meme — Real-2-Sim

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Play demo](https://img.shields.io/badge/demo-github.io-blue)](https://putersdcat.github.io/PlarailMemeDemo/)

<!--
  GitHub.com does play in-repo MP4s in READMEs via <video>.
  autoplay usually needs muted; loop works. Click if your browser blocks autoplay.
-->
<video
  src="recordings/plarail-meme-demo-1080p.mp4"
  width="100%"
  controls
  loop
  muted
  autoplay
  playsinline
  poster=""
>
  <a href="recordings/plarail-meme-demo-1080p.mp4">Watch the 1080p demo (MP4)</a>
</video>

*1080p capture: on rails → derail → wall glide → re-rail (looped, muted autoplay).*

## Intro (synergistic rail-forward value proposition)

In today’s rapidly evolving multi-modal plastic ecosystem, stakeholders increasingly demand a **holistic end-to-end train-shaped experience** that empowers builders to *leverage* magnetic adjacency, *unlock* paint-adjacent brand moments, and *operationalize* derailment as a first-class citizen of the joy funnel.

**Plarail Meme — Real-2-Sim** is not merely a simulator. It is a paradigm-shifting **spatial narrative continuum** wherein a white bullet-adjacent locomotion unit traverses a graph of emotionally resonant connectors, occasionally exiting the rails in a deliberate act of floor-native disruption, then re-onboarding via geometrically consenting mouths. Our north-star OKR is simple: make the train go brrr, then make it go *fshhh* along the outer wall, then make it go brrr again, in a closed-loop feedback cycle of delight.

We ship zero runtime npm dependencies because we believe true innovation means **owning the full stack of vibes** — Canvas pixels, Web Audio coffee-grinder sonics, and localStorage as a lightweight CRM for your personal track estate. If it compiles in your brain at 2 a.m., it ships.

## Backstory (origins, but make it enterprise)

Long ago (in product time: last week), a sacred artifact appeared on the timeline: a dense blue layout, a lonely engine, and a caption about codebases that run exclusively on pure LLM energy. The internet, as is its custom, laughed, then asked *what if we productized the bit*.

Thus began a multi-sprint journey of **agentic pair-programming at scale**. Requirements were harvested from the collective unconscious:

- “Snap should feel sticky but not *too* sticky (unless we mean walls, then unsticky the stick).”
- “Motor sound: plastic gears, not a leaf blower possessed by a tuba.”
- “Train bigger. No, longer. Nose like airplane. Windshield like moon. Remove the orange circle that was definitely intentional.”
- “Also yellow paint. And publish it.”

Through countless iterations of *yes-and* refinement, a team of silicon interns (and one human who still has to click Hard Refresh) co-authored a living digital twin of childhood floor logistics. Gendered connectors found true love. Switches found purpose. The front virtual axle found religion, lost it, found it again at offset `+8`. Wall bounce was briefly a lifestyle, then a regression, then a frozen physics constant so the elongated body art would stop gaslighting the collision system.

Today we open-source this artifact under MIT, not because we must, but because **community is the real unit of track**. Fork it. Paint it gray. Drive it off the red dashed abyss of the canvas and call it a controlled experiment.

> *“We didn’t invent Plarail. We merely midwifed its memetic digital shadow into a browser tab.”*  
> — Generated in a meeting that never happened

---

## What it actually is (human translation)

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

The layout and vibe come from this meme / layout energy (the primal pitch deck):

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

## Thanks

Endless thanks to my wife **Denise** — for patience, floor space, and not declaring the living room a staging environment.

Thank you, **Japan**, for inventing (and endlessly iterating) the plastic rail universe that made childhood and this repo possible.

Dimensional and structural reality checks were made possible by the excellent community references at Parlorfleur:

- [Normal Rail](https://parlorfleur-pm.com/Normal_Rail.html)
- [Rail Structure List](https://parlorfleur-pm.com/Rail_Structure_List.html)

And by the internet’s long memory — the Internet Archive’s Plarail catalog scan:

- [Plarail Catalogue 2014 (archive.org)](https://archive.org/details/catalogue-plarail-catalogue-2014_202208/%5Bcatalogue%5D_plarail_catalogue_2014/page/n9/mode/2up)

If you measured a curve with a ruler at 1 a.m. so a stranger on the web wouldn’t have to: you’re the real unit of track.

## License

[MIT](LICENSE) © 2026 Eric Anderson

Plarail is a trademark of Takara Tomy. This is an unofficial fan demo and is not affiliated with Takara Tomy.
