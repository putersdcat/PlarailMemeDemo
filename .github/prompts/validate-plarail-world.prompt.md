---
name: Validate Plarail World
description: "Validate a Plarail layout or new track component using topology, solid-world invariants, telemetry, and ASCII rendering without screenshots."
argument-hint: "Layout path and intended behavior, or component type and routes"
agent: agent
---

Validate the requested Plarail layout/component end to end.

1. Read `docs/PHYSICS_VALIDATION.md` and `.github/copilot-instructions.md`.
2. Run `npm test` and preserve unrelated behavior.
3. For a layout, run `node scripts/inspect-world.mjs --layout=<path> --frames=<enough for at least one full cycle> --assert=true --out=recordings/<name>-world-report.json`.
4. For a component, audit every connector/path endpoint and tangent, mirror/gender variant, route, and switch state; create a synthetic traversal layout if needed.
5. Inspect transition frames via ASCII and JSON telemetry—not screenshots.
6. Require zero hard violations/bad invariant frames, no unintended stall, exact ordered transitions, and maximum coupler error at or below 0.05 px.
7. Exercise rolling-stock variants relevant to the route: active engine only; two engines; one to three middle cars with and without a passive end engine.
8. Verify save/load/autosave is idempotent for piece poses and `world.playfieldBounds`.
9. Fix shared topology/geometry/physics rather than adding layout-ID or piece-ID special cases.
10. Add a regression reproducing the original macro scenario and report commands plus measured results.
