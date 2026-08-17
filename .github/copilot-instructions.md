# Plarail Simulation Guidelines

## Architecture

- Treat `js/geometry/piece-templates.js` as the shared source for rendering and solid collision geometry.
- Treat `js/world-model.js` as the machine-readable contract and invariant layer.
- Coupled cars use exact coincident hitch pins via `js/train/motion-trail.js`; never reintroduce whip/tether/spring placement or independently move a coupled follower after the pin solve.
- Never add layout-ID or piece-ID physics exceptions. Model topology, solid unions, and open-mouth portals generically.
- Keep rolling stock as separate entities in `train.cars`. Current layouts must not use a preset-specific `train.consist` template.
- A live chain has exactly one powered engine and supports zero to three middle cars plus an optional passive engine.
- Solid playfield bounds are world state, not camera state. Pan, zoom, resize, save, and autosave reload must not change collision geometry.
- North-aligned solid tracks keep the top wall flush with the renderer-solid track edge; never restore a camera-derived top gap.

## Validation

Read [Physics and World Validation](../docs/PHYSICS_VALIDATION.md) before changing geometry, physics, rolling stock, persistence, or saved tracks.

Always run:

    npm test

For physics/geometry/layout work also run:

    node scripts/inspect-world.mjs --layout=layouts/arntenoughrails.json --frames=900 --assert=true

Do not declare a physics fix complete unless the target trace has zero violations, zero bad invariant frames, no stall, and maximum coupler error at or below 0.05 px.

## Regression Tests

- Prefer end-to-end scenario traces over helper-only tests.
- Assert macro transition order, exact pin error, full-hull containment, overlap absence, and bounded pose continuity.
- Add component route/switch coverage for every new track template.
- Add save/load idempotence coverage for framing or persistence changes.
- Keep the rolling-stock composition matrix in `tests/world-model.test.mjs` passing.
