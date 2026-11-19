# Decision 0001: TypeDB is the only database

- Status: **accepted** (project owner, 30 October 2026). Permanent.
- Applies to: every phase, every environment (development, demo, production).

## Decision

TypeDB 3 is the sole database of the TypeDB Noodlelab Visual Explorer. No other database or persistent data store is
used for application data: no PostgreSQL, SQLite, MongoDB, Neo4j, Redis, DuckDB, browser IndexedDB, or
similar. The application exists to show that a complex interactive system can be built with TypeDB as
its only database.

## What TypeDB is authoritative for

Components and their stable ids; component types and properties; assembly and sub-assembly membership;
mechanical, electrical and software systems; functional dependencies; components taking part in several
systems; sensors, actuators and controllers; safety requirements; maintenance and failure-impact
relationships where modelled; every semantic relationship the app displays; and the **reference from each
component to its visual representation** (which asset file and node draws it).

The schema uses TypeDB's native modelling: entity, relation and attribute types, explicit roles, type
hierarchies, constraints, and multi-party relations where the domain genuinely has them (for example a
control loop of controller, sensors, actuator and controlled function). It must not collapse into a
generic node-and-edge model.

## What is not a database (allowed as static files)

Rendering resources: GLB/glTF geometry, textures, environment maps, animation trajectories and
choreography settings, rendering configuration, and build-time geometry manifests. These describe how
things look and move, not what they are or how they relate.

Seed and test data: JSON, CSV, YAML or TypeQL files used to create and seed the database, and fixtures in
tests. They must never be read by the running application as a source of domain facts.

In-memory UI state (slider position, selection, camera) is not persistence and is allowed.

## How the application gets domain data

```
Browser (React, Three.js)  --named read-only queries over HTTP-->  API (TypeScript, official TypeDB HTTP driver)  -->  TypeDB 3.14.1
        |
        +-- static assets (GLB, textures) served by the web server; no domain facts in them
```

- The browser never holds database credentials and cannot run arbitrary TypeQL. The API exposes a fixed
  set of named, read-only queries (component details, parent assembly, members of a system, systems a
  component takes part in, dependencies, failure impact, schema definitions). Each response includes the
  TypeQL that produced it, for the technical panel.
- Highlighting for semantic perspectives is driven by the ids those queries return. No hard-coded
  relationship maps or canned responses in the front end.
- If TypeDB or the API is unreachable, the 3D model still renders (it is static), but every semantic
  feature shows an explicit "TypeDB unavailable" state. There is no silent fallback to mock data.

## Ids and visual mapping

- The component id (for example `caliper-fr`) is owned by TypeDB.
- TypeDB stores each component's visual reference (asset file and node key). The app resolves the 3D
  object through that reference, so Blender object names never become authoritative identifiers. During
  visual development a build-time mapping file stands in for this lookup; a test keeps it identical to
  the TypeDB data once the database exists.
- When a component is split into several meaningful parts, each new part gets a new stable id, recorded
  in `docs/component-ids.md` with its parent assembly and semantic relationships. Existing ids are never
  renamed.

## Enforcement

- `web/src/architecture.test.ts` fails if a database client library or browser storage API appears in the
  web app, if a non-TypeDB database image appears in `compose.yaml`, or if the Blender environment depends
  on a database package.
- Integration tests added with the TypeDB phase (they need a running server):
  1. component metadata comes from TypeDB;
  2. assembly relationships come from TypeDB;
  3. semantic perspectives are produced by TypeQL;
  4. every component id in TypeDB resolves to a visual asset node, and every visual node to a component;
  5. no other database is used (the guard test above, run against the full stack);
  6. a stopped TypeDB produces the explicit error state, not mock data.

## Audit of the current code (30 October 2026)

No database, database client or browser storage is in use (checked: web dependencies, Blender
environment, Docker services, and `localStorage`, `sessionStorage`, IndexedDB, cookies, Cache API in the
source). Four places hold domain data in the front end today. That is acceptable during visual
development, and each has a planned move:

| Where | What it holds today | Move | Done (Phase B, 30 October 2026) |
|---|---|---|---|
| `web/src/vehicle/manifest.ts` | Part names, categories, assembly membership, assembly names and hierarchy, mixed with visual data (shape, position, material) | Split: visual fields stay in a build-time visual manifest; names, types and memberships move to the TypeDB seed | Yes: names, categories, assemblies removed (`data/seed/`); a test forbids them returning |
| `web/src/ui/PartLabel.tsx` | Reads part names and assembly path from the manifest at runtime | Query TypeDB through the API | Yes: replaced by `ComponentPanel.tsx`, fed only by the API |
| `web/src/vehicle/explode.ts` | Uses the assembly hierarchy to time and group the explosion | Explosion grouping becomes an animation asset generated at build time from TypeDB, checked by a test | Yes: `explosion-groups.json` from `api/src/animation.ts`; test 7 checks it matches TypeDB |
| `web/src/scene/assets.ts` | Treats GLB node names as component ids | Resolve through the explicit visual mapping (TypeDB visual references) | Yes (Phase A mapping file; TypeDB's visual references are tested identical to it) |

The six integration tests are in `api/tests/architecture.test.ts` (with `web/src/semantic/integration.test.ts`
and `web/src/architecture.test.ts` covering the web app's side).
