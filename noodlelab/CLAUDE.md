# Project notes for AI coding agents

Project: **TypeDB Noodlelab Visual Explorer** (`typedb-noodlelab-visual-explorer`). Noodlelab is the owner's
umbrella name for experimental software projects.

## Who this is for
The project owner has no programming background and is learning as we go.
Explain new terms in plain English, keep steps small, and verify each step works before moving on.

## Approval gates
Stop at the end of every milestone and report what's done, what failed and what's next.
Current work: Phase B of docs/mechanical-upgrade-plan.md, in the owner's order: TypeDB integration (done,
awaiting review), then a one-day Blender exterior trial (stop for review), then mechanical systems against
the provisional dimensions in docs/design-targets.md. No commissioning or vendor contact.

## Rules
- **TypeDB is the only database** (permanent: docs/decisions/0001-typedb-sole-database.md). No other
  database, database client or browser storage for application data; `web/src/architecture.test.ts`
  enforces it. Static assets (GLB, textures, animation data) and seed files are allowed; the running app
  must get domain facts from TypeDB, and show an explicit error when TypeDB is unavailable.
- The vehicle is original and unbranded. No manufacturer names, logos or claims of endorsement.
  Never present invented specifications as real; label the vehicle as a concept.
- Component ids are stable: never rename one. `data/seed/components.yaml` (loaded into TypeDB) is where
  components are defined; `web/src/vehicle/manifest.ts` only says how each id is drawn (shape, position,
  material) and must hold no names, types or memberships. Tests keep the two id lists identical.
- Everything the app displays about a component comes from a named TypeQL query through the API; never
  fake query results or add domain data in the frontend.
- Without Node.js on the host, run npm, tsc and vitest inside the containers (`docker exec
  noodlelab-web-dev ...` for the web app, `docker exec noodlelab-api ...` for the API).
- Ports: 5180 (web dev), 1733 (TypeDB driver, for Studio), 8004 (TypeDB HTTP: the API and Studio use it).
  Reserved: 8092 (web). The API has no published port: the web dev server forwards /api to it.
  Other projects on this machine use 1729-1732, 8002-8003, 8090-8091. Bind everything to 127.0.0.1.
- TypeDB is 3.x only (3.14.1). See the TypeDB notes in ../typedb-cyber-intel/CLAUDE.md; log TypeDB
  friction in ../typedb-cyber-intel/notes/typedb-feedback.md.

## TypeDB and the semantic API
- Services (compose.yaml): `typedb` (noodlelab-typedb, data in the noodlelab-typedb-data volume), `seed`
  (one-off, creates the `vehicle` database if missing), `api` (noodlelab-api, TypeScript on Node.js, restarts on
  code change). The API talks to TypeDB over its HTTP API (`@typedb/driver-http`), so the same code also runs
  as a Netlify Edge Function (`netlify/edge-functions/api.ts`, Deno) against TypeDB Cloud.
- Recreate the database after changing schema/ or data/seed/: first `docker compose run --rm --no-deps api npm run gen`
  (the schema, seed and model-map files are generated into `api/src/generated/assets.ts`, because the edge runtime
  cannot read files; a test fails if it is stale), then
  `docker compose run --rm --no-deps seed node scripts/create-database.ts --replace`.
  Then regenerate the explosion grouping (an animation asset, checked against TypeDB by a test):
  `docker compose run --rm --no-deps api npm run -s animation > web/src/vehicle/explosion-groups.json`.
- Code (`api/src/`): `schema/schema.tql` + `schema/functions.tql`; `data/seed/*.yaml` (placeholders `<c>`, `<a>`, `<s>`);
  `seed.ts` (validate, one insert, count check), `queries.ts` (the only queries the API runs),
  `app.ts` (GET-only endpoints; 503 typedb-unavailable, 500 query-failed, 404, 422; `handle(request, settings)` uses
  only web-standard APIs, so it runs on Node and Deno alike), `typedb.ts` (the connection and the recording transaction),
  `animation.ts`, `export.ts` (the downloadable model ZIP, built from the live database; `npm run export-check` validates it).
  Only the adapters (`api/server.ts` for Node, the edge function for Deno) and `api/scripts/` touch the runtime.
  Plain TypeScript only (no enums, no parameter properties): the files run unbundled, without a build step.
- Web side: `web/src/semantic/api.ts` (client), `web/src/ui/ComponentPanel.tsx`, `web/src/ui/focus.ts`
  (perspectives: highlighted ids come from TypeDB answers).
- Explorer (web/src/ui/Explore.tsx): Systems, Assemblies, Types, Questions; named questions live in
  api/src/questions.ts. Review screenshots and frame timing in a separate headless Chrome:
  `uv run --with websocket-client python -I scripts/browser/review.py` (and `perf.py`).
- TypeDB 3.14.1 planner bug QPL1: avoid `{ $x is $s; } or { <relation binding $x> };` (see queries.system; write-up and repro in docs/typedb-issues/).

## Git workflow (permanent)
Every piece of work follows this loop:
1. Complete one meaningful, clearly scoped step.
2. Run the checks (needs `docker compose up -d`):
   - web: `docker exec noodlelab-web-dev sh -c "npx tsc -p . && npx vitest run && npx vite build"`
   - API and TypeDB: `docker exec noodlelab-api sh -c "npx tsc --noEmit && npx vitest run"` (uses disposable `vehicle-test-*` databases)
   - web against the live API: `docker exec -e TYPEDB_INTEGRATION=1 noodlelab-web-dev npx vitest run src/semantic`
3. Commit with a conventional commit message: `type(scope): imperative summary`, where type is one of
   feat, fix, docs, test, refactor, perf, build, chore (e.g. `feat(typedb): add component schema`).
   Then a body saying what changed and why, ending with the co-author line.
4. Report the commit hash and the check results.

Branches:
- `main` holds reviewed, working states only; every commit on it passes the checks.
- In-progress and experimental work lives on a feature branch (`feature/<milestone>-<topic>`, e.g.
  `feature/m2.2-mechanical`). Merge into `main` only after the owner approves (normally at a phase review).

Also:
- Never commit secrets (`.env`) or review screenshots (`web/shots/`).
- Generated 3D assets (`web/public/assets/*.glb`) are committed because the app needs them (no Git LFS
  here); keep them compressed and regenerate rather than hand-edit.
- This project lives in the public typedb-labs repository (see the root README and CLAUDE.md), so never
  commit anything confidential.

## Blender pipeline (approved for mechanical systems; full rebuild follows docs/mechanical-upgrade-plan.md once approved)
- `blender/` holds Python scripts that model parts with Blender's `bpy` (5.2.3, isolated uv env in
  `blender/.venv`; it runs on the Mac, not Docker: there is no Linux ARM wheel). Rebuild the corner with
  `uv run --project blender python -I blender/corner.py` → `web/public/assets/corner-fr.glb`.
- Every top-level GLB node is named by a manifest component id; `web/src/scene/assets.test.ts` checks it.
  Material names in Blender are roles matched by `web/src/vehicle/studioMaterials.ts`.
- `import bpy` must come before `import bmesh` / `mathutils`.
- Comparison switches: `?corner=procedural` (old corner), `?fx=off` (no ambient occlusion / effects).
- `blender/exterior_trial.py`: the time-boxed exterior trial (scripted subdivision body, renders in Blender to
  web/shots/exterior-trial-*.png). Not used by the app; see docs/exterior-trial/README.md.

## Checking visuals in the Claude browser pane
The pane throttles animation when it is in the background, and screenshots can lag one frame.
In development the app installs helpers (`web/src/scene/devtools.ts`): `window.__vx` (React Three Fiber
state), `window.__vxProgress`, and `await __shot(progress, turntableAngle?, cameraPolarAngle?)`, which
renders a settled frame. Call `__shot` twice before a screenshot. Click "Explore the vehicle" first.
Emulated large viewports can freeze the pane; instead keep the pane's own size and call
`__size(1440, 900, 1.5)` to render at a fixed resolution, `__focus(p, ids, azimuth, elevation, distance, only?)`
for repeatable close-ups, and `await __save(name)` to write web/shots/<name>.jpg (git-ignored, includes the tier's effects), and
`__select(id)` to select a part (opens the TypeDB panel),
`await __perf()` for the checkpoint benchmark (frame time, triangles, draw calls; noisy in the pane).
