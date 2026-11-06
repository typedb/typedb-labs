# TypeDB Labs

Demonstration projects built on [TypeDB](https://typedb.com), served together at
[labs.typedb.com](https://labs.typedb.com). Each lab is a self-contained project in its own folder, with
its own README, schema, data, API and web app, and runs on its own with `docker compose up -d --build`.

| Lab | What it shows | Live |
|---|---|---|
| [Project Apex](apex) | Deal intelligence for a fictional £2.4 billion acquisition: typed relationships, recursive functions, negation and what-if projections over a deal's workstreams, parties and deadlines | [labs.typedb.com/apex](https://labs.typedb.com/apex/) |
| [NoodleLab Visual Explorer](noodlelab) | An interactive 3D electric vehicle whose every part, system, connection and failure impact is answered by TypeDB, with the TypeQL shown beside the model | [labs.typedb.com/noodlelab](https://labs.typedb.com/noodlelab/) |

Both labs were originally created by Callum Hemsley (see each lab's NOTICE and licence).

## How a lab is built

Every lab follows the same shape, so the site can host any number of them:

```
<lab>/
  schema/        the TypeDB schema and functions
  data/          the seed data, loaded by the lab's own checked loader
  api/           a read-only TypeScript API on the TypeDB HTTP driver: api/src/app.ts exports
                 handle(request, settings) on web-standard Request/Response only, so the same code runs
                 under Node (api/server.ts, Docker) and on Netlify's edge
  web/           the React + Vite web app; it calls /api next to wherever it is served from
  compose.yaml   TypeDB + seed + API + web for local use
```

TypeDB is the only database in every lab. The browser never sends TypeQL: each API runs fixed, named
queries with validated parameters, every answer carries the exact TypeQL that produced it, and nothing
writes to the database.

## The site

[netlify.toml](netlify.toml) describes one Netlify site. `npm run build` ([scripts/build.mjs](scripts/build.mjs))
builds each lab's web app with `VITE_BASE=/<lab>/` into `dist/<lab>/`, and the index page from `site/`.
Each lab's API is an Edge Function at `/<lab>/api/*` ([netlify/edge-functions](netlify/edge-functions)),
which strips the path prefix, reads that lab's TypeDB Cloud settings from `<LAB>_TYPEDB_*` env vars and
caches successful answers on the CDN (the data only changes on reseed; purge the lab's cache tag then).

Seeding a cluster is done once from a laptop, from the lab's `api/` folder, with the cluster's address
and credentials in the environment: see each lab's README ("Rebuild the database").

## Adding a lab

1. Create `<lab>/` in the shape above (TypeScript API, `handle()` runtime-neutral, web app on `/api`).
2. Make the web app honour `VITE_BASE` (Vite `base`, router basename, absolute asset and API paths).
3. Add it to `LABS` in `scripts/build.mjs`, an edge function in `netlify/edge-functions/`, its
   `[[edge_functions]]` and redirect entries in `netlify.toml`, a card in `site/index.html`, and a row above.
