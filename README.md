# Plarail Meme Layout Simulator

Browser simulation of a Takara Tomy **Plarail**-style track set inspired by the “how my codebase written entirely with claude code runs” meme video: a white bullet engine on a dense blue layout that can leave the rails, slide along outer track edges, re-rail when geometry allows, or drive off the playfield edge and stop.

## Run

Serve the folder over HTTP (ES modules), then open `index.html`:

```bash
# Python
python -m http.server 8765

# Node
npx --yes serve -p 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Docs

| File | Contents |
|------|----------|
| `DESIGN.md` | Design concept: states, snapping, on/off-rail physics, success criteria |
| `plarail_meme_track_components.md` | Piece inventory & product references from the meme layout |

## Controls

| Input | Action |
|-------|--------|
| **Left-drag** from palette | Place track; **magnetic snap** when open ends get close |
| **Left-drag** a placed piece | Move with the same snap |
| **Left-click empty** | Deselect only (does **not** spawn track) |
| **Right-click rail** | Place the train |
| **Right-click piece** | Rotate 45° |
| **Right-click empty** + palette select | Stamp selected piece |
| **Yellow lever** | Cycle switch (incl. 1→3 Y) |
| **Save JSON / Load JSON** | Export or restore layout file |
| **R** / **F** / **Del** | Rotate / flip / delete |
| **Space** | Start / stop |
| **Alt-drag** | Pan |

Pieces: R-01, **R-L / R-Stop** long straights, R-02, R-03, **R-90 (90°)** , R-09 large, R-11, R-12, **Y-3 (1→3, outers 90°)**, R-14 with corner webbing.

Physics: front axle is ~⅓ of train length back from the nose (short wheelbase for curve exit + wall glide).

## Behaviour

1. **On rails** — follows connected centerline graph through switches.
2. **Open end** — derails onto the floor with the same heading.
3. **Off rails** — collides with outer (and groove) wall segments; slides/bounces along plastic edges.
4. **Re-rail** — if position and heading align with a path (especially near mouths), snaps back on.
5. **Canvas edge** — free train exits the red dashed bounds → **Stopped**; reset train, place again, Start.

Only one engine is simulated (parked consists from the video are omitted).
