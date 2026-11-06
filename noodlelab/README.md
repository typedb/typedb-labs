# TypeDB Noodlelab Visual Explorer

A Noodlelab project (Noodlelab is an umbrella name for experimental software projects).

An interactive 3D demonstration of how TypeDB models a complex physical system. An original,
unbranded autonomous electric SUV floats in a dark studio and separates into an exploded assembly.
Selecting a part asks TypeDB 3 what it is, where it sits, what systems it serves, what it is connected
to and what stops working if it fails; the answers, and the TypeQL behind them, appear beside the model.

> The vehicle is an original concept built for this demonstration. It is not a production model
> and is not affiliated with or endorsed by any manufacturer.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Asset research and plan | Done: original procedural vehicle chosen ([docs/asset-strategy.md](docs/asset-strategy.md)) |
| 2.1 | Assembled vehicle, studio lighting, opening screen | Done |
| 2.2 / A | Exploded view, scrubber, selection; wheel corner rebuilt in Blender | Done, provisionally approved ([Phase A](docs/phase-a/README.md)) |
| B | TypeDB schema, data, read-only API, component panel and perspectives | **Done, awaiting review** ([checkpoint](docs/phase-b/typedb-checkpoint.md)) |
| B | Exterior trial (Blender, one day), then drive units, battery, power electronics | Next ([plan](docs/mechanical-upgrade-plan.md), [design targets](docs/design-targets.md)) |

## Run it

Only Docker is needed; Node.js runs inside a container.

```bash
docker compose up -d --build
```

Then open http://127.0.0.1:5180. The first start downloads TypeDB, builds the API, creates the database
and installs the web dependencies; it takes a few minutes. TypeDB Studio can connect to 127.0.0.1:1733
(or its HTTP port, 8004) with TypeDB's default local login.

Tests and type checks (with everything running):

```bash
docker exec noodlelab-web-dev sh -c "npx tsc -p . && npx vitest run"
```

```bash
docker exec noodlelab-api sh -c "npx tsc --noEmit && npx vitest run"
```

Without Docker (Node.js 22.6 or newer, a TypeDB server on 127.0.0.1:8004): `cd api && npm ci && npm run create-database`
once, then `npm run dev` for the API and `cd web && npm install && npm run dev` for the web app.

## Deploying to Netlify

The web app is built as static files and `/api/*` is answered by a Netlify Edge Function
(`netlify/edge-functions/api.ts`) running the same backend code against TypeDB Cloud. `netlify.toml` holds the
build settings; set `TYPEDB_ADDRESS` (the cluster's https address), `TYPEDB_USERNAME`, `TYPEDB_PASSWORD` and
`TYPEDB_DATABASE` in the site's environment variables, and create the database there with
`TYPEDB_ADDRESS=https://... npm run create-database` from `api/`.

## How it is built

- `schema/`: the TypeDB schema (component type hierarchy, assemblies, systems, connections, dependencies,
  control loops, links to 3D objects) and recursive functions (failure impact, requirements, ancestry).
- `data/seed/`: the vehicle's engineering data, loaded into TypeDB by `api/src/seed.ts`.
- `api/`: the read-only semantic API (TypeScript, official TypeDB HTTP driver; runs on Node.js locally and as
  a Netlify Edge Function when deployed). A fixed set of named TypeQL queries; every answer includes the
  TypeQL that produced it.
- `web/src/semantic/`, `web/src/ui/ComponentPanel.tsx`: the web app's side of the semantic layer.
- `web/src/vehicle/manifest.ts`: the visual manifest: how each component id is drawn (shape, position,
  material). It holds no names or relationships; tests keep its ids identical to TypeDB's.
- `web/src/vehicle/body.ts`: the body shell, lofted through cross-sections and cut into panels.
- `web/src/vehicle/shapes.ts`: geometry for the mechanical and electronic parts.
- `web/src/vehicle/materials.ts`: physically based materials.
- `web/src/vehicle/explode.ts`: the exploded view. An expansion field pushes every part away from the
  vehicle's centre (about 2x lengthwise, 2.6x sideways, 1.75x upwards) while parts keep their size, so
  neighbours open up but stay in their region. On top, each assembly moves relative to its parent and
  each part within its assembly, in four timed tiers ending with a fine-detail step. A pure function of
  progress (0 to 1), so it can be scrubbed and reversed exactly. Tests in `explode.test.ts`. The assembly
  tree it uses comes from `explosion-groups.json`, generated from TypeDB.
- `web/src/scene/`: the 3D studio (camera, lighting, turntable) and the vehicle renderer.
- React, TypeScript, Vite, Three.js, React Three Fiber and Drei.

Everything is generated in code (in the browser, or by Blender scripts in `blender/`): there are no
third-party 3D model files and no licence restrictions. The studio lighting is a CC0 Poly Haven HDRI.

**TypeDB is the only database** ([decision 0001](docs/decisions/0001-typedb-sole-database.md)).
