# Physics and World Validation

## Purpose

Validate track geometry, full-body train physics, exact couplers, wall containment, and rail/floor transitions without screenshots. The renderer, collision solver, telemetry, browser hooks, CLI, and tests share the same world geometry.

## Required checks

Run all checks after changing track templates, connectors, walls, train dimensions, couplers, rerail behavior, persistence, or a saved layout:

    npm test
    npm run inspect:world -- --layout=layouts/arntenoughrails.json --frames=900 --assert=true

For explicit options on Windows, invoking the script directly is reliable:

    node scripts/inspect-world.mjs --layout=layouts/arntenoughrails.json --frames=900 --assert=true --out=recordings/world-report.json

A clean report requires:

- `endpointFailures: []`
- `finalMode` is not `stalled`
- `badInvariantFrames: 0`
- `violationCount: 0`
- `maxCouplerError <= 0.05`
- Expected `rail_exit`, `car_rail_exit`, `lead_rerail`, and `follower_rerail` order

## Inspect a new track

    node scripts/inspect-world.mjs --layout=layouts/my-track.json --frames=1800 --width=100 --height=36 --out=recordings/my-track-world.json

The JSON report contains:

- Quantized piece poses and connector topology
- Active/inactive centerline polylines
- Open rail mouths and outward headings
- Renderer-derived solid polygon union information
- Connector/path endpoint diagnostics
- Frame-by-frame train hull, axle, hitch, nearest-path, and invariant state
- Transition timeline and violations
- ASCII world maps for important frames

Use explicit maps for suspicious frames:

    node scripts/inspect-world.mjs --layout=layouts/my-track.json --frames=1200 --show=0,250,500,750 --width=100 --height=36

In the ASCII view:

- `#` is solid track plastic
- `=` is active rail
- `.` is inactive rail
- `0`, `1`, `2`, ... are cars in powered-chain order

## Browser diagnostics

Open the app with `?debug=1`, then use:

    window.__sim.getWorldContract()
    window.__sim.inspectWorld()
    window.__sim.renderWorldAscii({ width: 100, height: 36 })
    window.__sim.getTelemetry()
    window.__sim.analyzeTelemetry()

The same methods exist on `window.__plarailDemo`.

## Physics invariants

Never fix a scenario by hiding it from telemetry or by adding a layout-ID special case.

- Coupled hitch tips must coincide. A moving link may not stretch.
- A preexisting stretched link breaks before motion; a dynamically blocked link rolls back and stalls.
- Exactly one engine is powered in a live chain.
- Cars are solid rounded capsules against other cars, track plastic, and the playfield.
- Rail-owned cars use centerline/axle constraints; floor-owned cars use pin articulation and solid collision.
- Open-mouth collision exceptions are geometric portals owned by one piece, not timers that disable arbitrary walls.
- Runtime positions are quantized to 0.001 px and angles to 0.000001 rad.
- Camera pan/zoom/resize must not change solid-world collision bounds.
- For north-aligned solid layouts, the top wall must equal the renderer-solid
    track minimum (`world.playfieldBounds.minY === computeBoardBounds(board).minY`);
    do not add a camera-derived capture gap.

## Rolling-stock matrix

Keep coverage for all supported modular chains:

- One active engine
- Active engine + passive engine
- Active engine + one to three middle cars, no end engine
- Active engine + one to three middle cars + passive engine
- Active engine + passive engine with no middle car

Parts are separate entities. Do not add a preset-specific consist template. Middle and passive cars snap/couple at the powered chain tail. Power can switch to another coupled engine, but only one engine may be powered.

## Adding a track component

1. Add the canonical type and metadata in `js/geometry/units-math.js`.
2. Build paths, connectors, and renderer solids in `js/geometry/piece-templates.js`.
3. Derive collision solids from the same `bed`/`webbingPolys`; do not hand-maintain a second wall shape.
4. Keep connector endpoints coincident with path endpoints and tangent directions continuous.
5. Mark connector-mouth polygon edges as open portals where appropriate.
6. Add geometry tests for mirrors, genders, paths, connectors, and world transforms.
7. Create a synthetic layout that traverses every route and switch state.
8. Run `npm test` and `inspect-world --assert=true` on both the synthetic layout and representative saved layouts.

## Adding or changing a saved track

- Save cars as individual entries in `train.cars`, including `id`, `kind`, `role`, `powered`, `coupled`, and `facing`.
- Never use `train.consist` for current files.
- Preserve `solidPlayfield`, `northAlign`, and `world` framing metadata.
- A normalized autosave must reload with zero piece translation and the exact same `world.playfieldBounds`.
- Add an end-to-end trace test for the track’s intended macro cycle, not only helper-unit tests.

## Diagnosing a failure

1. Run the inspector with `--out`.
2. Read `analysis.transitions` and `analysis.violations` first.
3. Inspect the first bad frame’s `before`, `after`, and `invariants`.
4. Render that frame and adjacent transition frames as ASCII.
5. Determine whether the source is topology, path geometry, solid union, portal ownership, pin constraints, or persistence.
6. Fix the shared model; do not patch a piece ID or saved-layout ID.
7. Add a regression that fails on the original trace and asserts the macro outcome plus hard invariants.
