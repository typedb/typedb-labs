# TypeDB Labs

Demonstration projects built on [TypeDB](https://typedb.com), served together at
[labs.typedb.com](https://labs.typedb.com). Each lab is a self-contained project in its own folder, with
its own README, schema, data, API and web app, and runs on its own with `docker compose up -d --build`.

| Lab | What it shows | Live |
|---|---|---|
| [Project Apex](apex) | Deal intelligence for a fictional £2.4 billion acquisition: typed relationships, recursive functions, negation and what-if projections over a deal's workstreams, parties and deadlines | [labs.typedb.com/apex](https://labs.typedb.com/apex/) |
| [Nuts & Volts](nuts-and-volts) | An interactive 3D electric vehicle whose every part, system, connection and failure impact is answered by TypeDB, with the TypeQL shown beside the model | [labs.typedb.com/nuts-and-volts](https://labs.typedb.com/nuts-and-volts/) |

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
caches successful answers on the CDN. The one npm package the functions use at request time (the TypeDB HTTP
driver) is a dependency of the root `package.json`, which is where Netlify's edge bundler looks for it (the data only changes on reseed; purge the lab's cache tag then).

Every page carries the top bar of [typedb.com](https://typedb.com), and the index page its base styles
and footer too. They come from the `typedb-web` submodule (`typedb-web/common`), as on the docs site:
[scripts/chrome.mjs](scripts/chrome.mjs) renders the top bar and footer from the main site's CMS at build
time, compiles [site/chrome.scss](site/chrome.scss) and [site/index.scss](site/index.scss) against the
shared styles into `dist/_site/`, and adds the top bar to each lab's built page. Clone with
`--recurse-submodules`, or run `git submodule update --init`. 
To view the site locally, run `npm run build` once, then `npm run serve` ([scripts/serve.mjs](scripts/serve.mjs))
and open http://localhost:8765. It serves `dist/` and forwards each lab's API calls to the deployed site,
so the labs show live data without a local TypeDB. Each `npm run serve` first rebuilds the index page and
the shared styles (`npm run build -- --index-only`, which leaves the built labs alone); a change to a lab
needs a full `npm run build`.

Seeding a cluster is done once from a laptop, from the lab's `api/` folder, with the cluster's address
and credentials in the environment: see each lab's README ("Rebuild the database").

## Adding a lab

1. Create `<lab>/` in the shape above (TypeScript API, `handle()` runtime-neutral, web app on `/api`).
2. Make the web app honour `VITE_BASE` (Vite `base`, router basename, absolute asset and API paths).
3. Add it to `LABS` in `scripts/build.mjs` (its `title` appears in the breadcrumb back to the index page;
   set `fill: true` if the app fills the viewport instead of scrolling, so it shares the height with the
   top bar), an edge function in `netlify/edge-functions/`, its `[[edge_functions]]` and redirect entries in
   `netlify.toml`, a card with a 16:9 preview image (`site/img/`) in `site/index.html`, and a row above.
