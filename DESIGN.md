# Plarail Meme Layout – Simulation Design Concept

## Goal

Build a simple browser simulation of the Takara Tomy **Plarail** track system as seen in the “how my codebase written entirely with claude code runs” meme video:

- A dense blue multi-loop layout (top-down).
- A single white bullet-train engine that can leave the rails, bounce along the **outside edges** of track plastic, and (when the layout still forms an effective closed “pocket”) eventually get back onto the rails.
- If the player builds an **open** path so the free-running train drives off into open floor and hits the **canvas edge**, motion stops and the player must reset the train.

Stationary parked consists shown in the source video are **out of scope**. Only one movable engine is simulated.

Piece inventory and product references live in `plarail_meme_track_components.md`.

---

## Experience Summary

| Mode | Player action | Simulation response |
|------|---------------|---------------------|
| Build | Drag pieces from palette onto canvas | Connectors **snap** when male/female ends align |
| Build | Rotate / delete pieces | Rebuild connectivity graph |
| Build | Click yellow levers on turnouts / cross | Toggle switch routes |
| Run | Place train on a rail path, press Start | Train follows centerline graph |
| Run | Train reaches an open connector | Leaves rails → free motion with wall sliding |
| Run | Free train slides along outer track edges | Path bent by collision (meme “bounce around layout”) |
| Run | Free train approaches a rail path with matching heading | **Re-rails** and resumes path following |
| Run | Free train hits canvas boundary | **Stop**; require place + Start again |
| Run | Press Stop / Reset Train | Halt and allow reposition |

---

## Coordinate & Scale Model

All geometry is **2D top-down**. Elevation (R-06 / R-18 slopes and piers) is **not** simulated as true 3D; multi-level crossings from the video are approximated in plan by crossings / overlapping paths where useful. Focus is planar connectivity + edge physics.

| Quantity | Real Plarail (approx.) | Sim units |
|----------|------------------------|-----------|
| Full straight (R-01) length | ~216 mm | `UNIT = 96` px |
| Half straight (R-02) | ~108 mm | `UNIT / 2` |
| Standard curve (R-03) | 45°, radius ≈ 216 mm | 45° arc, radius `UNIT` |
| Full circle | 8 × R-03 | 360° |
| Track bed width | ~53 mm outer envelope | `TRACK_W = 40` px |
| Train length (engine) | short consist | ~`0.55 * UNIT` |

Connectors use Plarail-style **gender**:

- **Male** (凸): protruding tab
- **Female** (凹): receiving slot  
Only opposite genders may snap. Pieces may be flipped (180° / reverse orientation) so gender layout matches physical reversibility where the piece allows it.

Rotation is discrete at **45°** steps (matches curve geometry and keeps snaps stable).

---

## Track Piece Model

Each placed piece instance has:

```
{
  id, type, x, y, rotSteps,   // rotSteps * 45°
  flip,                       // optional reverse for gender / curve side
  switchState,                // for R-11 / R-12 / R-14
  connectors[],               // local → world ports
  paths[],                    // centerline polylines / arcs (local)
  walls[]                     // collision edge segments (local)
}
```

### Pieces implemented (meme-required set)

| Code | Name | Paths | Notes |
|------|------|-------|-------|
| R-01 | Straight | 1 centerline | Male–female ends |
| R-02 | Half straight | 1 centerline | Gender matching filler |
| R-03 | Curve 45° | 1 arc | Flip selects curve direction (CW/CCW) |
| R-90 | Curve 90° | 1 quarter arc | Long sharper right-angle turn |
| R-09 | Large / shallow curve | 1 arc | **2× radius** for sweeping outer loops |
| R-L | Long straight | 1 centerline | **2×** R-01 length |
| R-Stop | Stop straight | 1 + side bump | Long + station bump for wall glide |
| R-11 | Turnout L/R | main + branch | Yellow lever; branch uses R-03 radius |
| R-12 | Figure-8 / Y-point | two curved legs | Interlocking loops |
| Y-3 | Three-way Y-split | stem → L/C/R | **1→3**; outer exits **90° apart** |
| R-14 | Cross point | two routes + webbing | 4-way + **rounded corner fillets** |

Slopes removed (planar sim). Train path/collision uses **front axle ~⅓ body length back from nose**.

### Connectivity graph

After each edit:

1. Transform all connectors to world space.
2. Pair opposite-gender ports within snap distance + angle tolerance.
3. Build an undirected multigraph of **path endpoints**.
4. At switches, active edges depend on `switchState`.

Open (unpaired) connectors are **exit ramps**: a train that rides a path to that endpoint leaves rail mode with its last heading and speed.

---

## Snap Placement UX

**Intent:** when two **open ends** get near each other, they magnetically join—player does not need puzzle-perfect pre-alignment.

1. **Left-drag** from palette or move an existing piece (ghost follows cursor).
2. For every free port on the ghost × every free port on the board (opposite gender):
   - Compute the **ideal 45° rotation** so ports face each other.
   - Compute origin so ports **coincide**.
   - If that origin is within `SNAP_DIST` (~56 px) of the current pose (or ends are already near), accept as candidate.
3. Auto-**flip** is tried when it enables a gender match.
4. Best candidate wins; green ring = snapped. Drop commits.
5. **Left-click** palette tool + **left-click** canvas also stamps a piece (with snap).

### Pointer map

| Input | Action |
|-------|--------|
| Left-drag palette / piece | Place or move with magnetic snap |
| Left-click empty (tool active) | Stamp piece |
| Right-click rail | Place train |
| Right-click piece | Rotate 45° |
| Right-click / left yellow lever | Cycle switch |
| Alt-drag / middle | Pan |

Pieces can also be free-placed without a snap (open layouts / intentional derail ramps).

---

## Train State Machine

```
        place on path                 Start
  [Idle] ───────────► [Ready] ───────────► [OnRail]
                         ▲                    │
                         │                    │ open end / forced derail
              reposition │                    ▼
                         │               [OffRail]
                         │                    │
                         │   re-rail          │ canvas edge
                         │◄───────────────────┤
                         │                    ▼
                         └──────────── [Stopped]
```

### OnRail

- Train position is parameterized by `(segmentId, s ∈ [0,1], direction ±1)`.
- Advance `s` by `speed * dt / segmentLength`.
- At segment end: follow graph edge preferred by switch state and arrival direction; if none → transition **OffRail**.
- Visual orientation = path tangent.

### OffRail (meme bounce mode)

- Position is free `(x, y)`; velocity is constant-speed heading `θ` (toy-like, low friction).
- Each frame:
  1. Propose `pos += v * dt`.
  2. Resolve circle (train nose/body radius) vs **wall segments** of all track pieces (and optionally filled bed polygons).
  3. On hit: push out along surface normal; set velocity to **slide** along the wall (retain tangent component, kill normal component, slight restitution for “bounce” flavor matching the video).
- Wall set is the **outer envelope** of each rail piece (and end caps that are *not* open connector mouths). This reproduces “train skids along the outside of the blue plastic” from the clip.
- Optional inner groove walls are *not* used while off-rail; once re-railed, grooves are implicit in the centerline constraint.

### Re-rail

While OffRail, sample nearby path centerlines:

- Lateral distance from train center to path &lt; `RE_RAIL_LATERAL`
- Heading vs path tangent &lt; `RE_RAIL_ANGLE` (or opposite; then reverse direction)
- Prefer open mouths / segment interiors the train is crossing

On success → **OnRail** at closest `(segment, s)` with aligned direction. This is how a layout that still forms a closed “catch basin” of walls can return the train to rails after a full exterior tour—same qualitative loop as the meme—even though the rail *graph* had a temporary exit.

### Canvas edge → Stopped

If the train’s center leaves the playfield AABB (padded), enter **Stopped**:

- Velocity zeroed; no auto-resume.
- UI prompts: drag train onto a rail (or click “Place train”) and press **Start**.

This covers open-loop builds where the engine simply drives into empty floor.

---

## Collision Detail (OffRail)

Walls are line segments in world space, rebuilt when the layout changes.

```
resolveCircleSegment(circle, seg):
  closest = clamp projection of center onto seg
  n = center - closest
  if |n| < radius and |n| > ε:
    push center out to radius along n̂
    if v · n̂ < 0:
      v = v - (1 + e) * (v · n̂) * n̂   // bounce / slide
      // then re-normalize |v| ≈ cruise speed (toy motor keeps driving)
```

Toy motor model: while OffRail and not Stopped, after collision response **re-normalize speed** to cruise (with a short post-hit cooldown) so the train keeps “driving” along walls instead of stopping—matching battery toys in the video.

---

## Rendering

- **Canvas 2D**, full layout pan optional; fixed large playfield is fine for v1.
- Track color: Plarail blue (`#3a8fd6` / darker ties).
- Rails: two darker parallel lines along centerline.
- Connectors: small male tab / female notch glyphs (debug toggle for ports).
- Switch levers: yellow clickable markers.
- Train: white streamlined body, blue nose stripe, three headlight dots; shadow for read on floor.
- Floor: light neutral “table” texture / solid `#e8e4dc`.
- State badge: On rails / Off rails / Stopped at edge.

---

## UI Layout

```
┌──────── palette ────────┬──────────── canvas ────────────────┐
│ R-01 Straight           │                                    │
│ R-02 Half               │         [track layout]             │
│ R-03 Curve              │         [train]                    │
│ R-11 Turnout            │                                    │
│ R-12 Y-Point            │                                    │
│ R-14 Cross              │                                    │
│ ───────────────         │                                    │
│ Rotate  Flip  Delete    │                                    │
│ Load Meme Preset        │                                    │
│ Clear Board             │                                    │
└─────────────────────────┴────────────────────────────────────┘
┌ Start/Stop │ Reset Train │ Speed │ Status │ Help ────────────┐
```

---

## Meme Preset Layout

A built-in **Load Meme-Style Layout** button assembles a dense planar network using R-01/R-02/R-03/R-11/R-12/R-14 that approximates the video’s multi-loop, multi-junction character (not a frame-perfect reverse-engineer):

- Nested / adjacent ovals from curves + straights.
- At least one R-14 cross and several turnouts for chaotic routing.
- One intentional “soft exit” opportunity (open or switchable path) so demos can show derail → wall tour → re-rail without the player designing it first.

Exact piece counts are tuned so the engine can run indefinitely on rails, or derail and still be guided by the outer silhouette when the cluster remains compact.

---

## Non-Goals (v1)

- True 3D elevation, bridges, piers, gravity.
- Multiple rolling stock / couplings / parked trains.
- Sound, motors, battery UI, product SKUs beyond piece codes.
- Pixel-perfect plastic molds or licensed artwork.
- Networked multiplayer.

---

## File Map

| File | Role |
|------|------|
| `DESIGN.md` | This design concept |
| `plarail_meme_track_components.md` | Source piece inventory & references |
| `index.html` | Shell page |
| `css/styles.css` | Layout / chrome |
| `js/geometry.js` | Piece templates, transforms, walls, paths |
| `js/track.js` | Placement, snap, connectivity graph |
| `js/train.js` | State machine, on-rail, off-rail physics |
| `js/render.js` | Canvas drawing |
| `js/presets.js` | Meme-style layout |
| `js/main.js` | Input, loop, UI wiring |

---

## Success Criteria

1. Player can construct closed loops and the train runs continuously on rails.
2. Connectors snap reliably (male↔female, 45° grid).
3. Open ends derail the train onto the floor with preserved heading.
4. Off-rail motion is visibly steered by **outer track edges** (slides / light bounces).
5. Compact closed *wall* clusters can re-capture the train onto a path (meme recover).
6. Driving off the canvas stops the sim until the user resets the train.
7. The meme-style preset is constructible from supported pieces and exhibits (4)+(5).
8. Only one engine is ever drawn.

---

## Implementation Notes

- Prefer discrete 45° rotation and gender-aware snaps over free-angle CAD precision.
- Keep wall generation consistent with drawn mesh so “what you see is what collides.”
- Rebuild graph + wall cache on every edit; hot path is only integration + collision.
- Use `requestAnimationFrame`; fixed cruise speeds in px/s for deterministic feel.
