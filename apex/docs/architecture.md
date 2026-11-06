# Project Apex: technical architecture

A concise overview for technical readers. The detailed design is in [schema-design.md](schema-design.md)
(the TypeDB schema), [queries.md](queries.md) (the TypeQL behind each screen) and [plan.md](plan.md)
(decisions, risks and test results per phase).

## The shape of it

```
 Browser ──► web (nginx, 127.0.0.1:8091) ──► /api/* ──► api (TypeScript, Node 24, HTTP driver)
             React + TypeScript                           │  api/src/queries.ts: all TypeQL
             Tailwind CSS + shadcn/ui                     │  READ transactions only
             React Flow + ELK (graph layout)              ▼
                                                 typedb (TypeDB CE 3.14.1, HTTP on 127.0.0.1:8003)
                                                 the only database: schema, data, functions
```

Four Docker Compose services, all ports bound to 127.0.0.1:

| Service | What it does |
|---|---|
| `typedb` | TypeDB 3.14.1. The only place business data lives. The API and Studio use its HTTP port (8003); gRPC is on 1732 for other tools. |
| `seed` | One-off: creates the `apex` database (schema, functions, checked fictional data) if it is missing, then exits. Never replaces existing data. |
| `api` | Read-only TypeScript service (`api/server.ts`, Node 24). No published port; reached through `web`. |
| `web` | nginx serving the built React app and forwarding `/api` to `api`. |

## Data and rules live in TypeDB

- **Schema** (`schema/schema.tql`, then each file in `schema/migrations/` in number order; applied files
  are never edited, changes are new files): typed entities and relations with inheritance, for example
  `law-firm` < `professional-services-firm` < `organisation` < `party`, and `gating`/`sequencing` <
  `hard-dependency` < `dependency`. Role names are part of the model (`mandate` relates `client`,
  `adviser` and `engagement`; `authority-review` relates `reviewer`, `subject` and `applicant`).
- **Constraints** enforced by the database: at most one Accountable per item (`@card`), stakes 0-100%
  (`@range`), allowed status words (`@values`), unique codes (`@key`), and who may play which role.
- **Functions** (`schema/functions.tql`), saved in the schema and called by queries:
  - `downstream` and `impact_edges`: recursive walks along hard dependencies (the Impact Explorer).
  - `group_members`: recursive ownership, carrying the stake multiplied along each route.
  - `owners_above` and `ownership_cycles`: the ownership guards.
- **Data** (`data/seed/*.yaml`, the source of truth; `data/seed.tql` is generated from it): loaded in
  **one write transaction** that checks counts, ownership guards and data-quality rules before it commits.
  If anything is wrong, nothing is saved.

## The API (`api/src/`)

| Module | Role |
|---|---|
| `queries.ts` | Every TypeQL query the app runs (the loader's inserts are in `seed.ts`). |
| `overview.ts`, `explorer.ts`, `impact.ts`, `schedule.ts`, `workstreams.ts`, `parties.ts`, `engagement.ts`, `connections.ts` | Compose each screen's answer from query results. The only calculations outside TypeQL are counting, date arithmetic (TypeQL has no `date + duration`) and listing ownership routes, which must reproduce TypeDB's own recursive figures exactly (`decimal.ts`: exact decimals, never floating point) or nothing is returned. |
| `app.ts` | `handle(request, settings)`: the GET endpoints, built on web-standard `Request`/`Response` only, so the same code runs under Node (`api/server.ts`) and Deno (`netlify/edge-functions/api.ts`). One READ transaction per request. Every response carries the exact TypeQL that ran, recorded as it ran (`typedb.ts`: the recording transaction), with its parameters: this is what "Show TypeQL" displays. Each response also lists the capabilities those queries use (`capabilities.ts`: recursive functions, n-ary relationships, polymorphism, negation, aggregation, typed relationships, nested queries), detected from the recorded TypeQL against the schema files. |
| `advantage.ts`, `analyst.ts`, `guide.ts` | The TypeDB advantage panel (schema excerpts read from the files that built the database, plus live figures), the AI Analyst concept preview (fixed investigations, no AI model) and the guided demonstration's steps. |
| `database.ts`, `seed.ts` | Create a database (schema, migrations, functions) and load the checked seed data. Used by the `seed` service, `api/scripts/` and the tests, never by the API. |
| `settings.ts`, `typedb.ts`, `decimal.ts`, `py.ts` | Settings from the environment (`api/scripts/env.ts` adds the local `.env`); the TypeDB HTTP connection and the read-only, recording transaction; exact decimals; and the few Python conventions the port keeps so answers stay identical (code-point sorting, banker's rounding, calendar-day arithmetic). |
| `generated/assets.ts` | The schema files and `config/*.yaml` as string constants, written by `npm run gen`. The API reads these at runtime (capability detection, schema excerpts, the engagement and connection policies) because the edge runtime cannot read the repository; a test fails if they are stale. |
| `config/*.yaml` | Policy, not data: how engagement is assessed and which relations count as connections. |
| `models.ts` | Response types, re-exported from `web/src/api/schema.d.ts`, which is generated from `web/openapi.json`. The OpenAPI file is the documented contract and is maintained by hand alongside the code; frontend and API share one set of types. |

Endpoints: `/api/deal`, `/milestones`, `/approvals`, `/activity`, `/parties`, `/progress`, `/raci`,
`/checks`, `/graph`, `/graph/node/{code}`, `/ownership`, `/impact`, `/schedule` (the Gantt chart, `schedule.ts`),
`/items/{code}` (the shared item panel), `/workstreams` and `/workstreams/{code}` (`workstreams.ts`), `/connections`, `/connectables`, `/advantage`, `/analyst/{key}` (concept preview, no AI model), `/guide`,
`/register`, `/parties/{code}` and `/engagement-policy`
(`parties.ts`, `engagement.ts`, `config/engagement-policy.yaml`), `/health`. The OpenAPI description is
`web/openapi.json` (the API no longer serves interactive docs).

**Safety and robustness:** no writes (tested: no write transactions in the API code, and the database
fingerprint is unchanged after a simulation run); inputs validated against fixed patterns; ownership
figures withheld (HTTP 409) if the guards find a cycle or a company over 100% owned; a lost TypeDB
connection gives a plain 503 and is reopened automatically; `/api/health` asks TypeDB on every call.

## The frontend (`web/`)

- React 19 + TypeScript, built by Vite (locally, or inside the official Node image with
  `scripts/npm-docker.sh`).
- Tailwind CSS 4 and shadcn/ui; one set of colour tokens (`src/index.css`) for every screen.
- TanStack Query for data; the Explorer and Impact screens load on demand (they include the layout engine).
- Graphs: React Flow, laid out by ELK. ELK was chosen over dagre after measuring both on the real graph
  (`web/scripts/compare-layouts.ts`; results in plan.md §9); `?layout=dagre` still shows the alternative.
  The group tree and impact chain use a small tree layout of their own.
- **No business data or rules in the frontend.** Tests scan the source and the built bundle for every seed
  name, code, date and amount, and the Impact screen's code for any threshold or outcome.
- While TypeDB is unreachable, one banner says so and the screens refresh by themselves when it returns.

## Databases

| Name | Use |
|---|---|
| `apex` | The pristine demonstration data the app reads (set by `APEX_DATABASE`). |
| `apex-demo` | A copy for the optional live steps (schema extension, constraint violations). `npm run reset-demo` (in `api/`) rebuilds it. |
| `apex-test-*` | Throwaway databases created and deleted by the tests. |

## Running, seeding and resetting

`docker compose up -d --build` starts `typedb`, waits for it to answer, runs `seed` (which creates `apex` only
if it is missing), then starts `api` and finally `web`, each waiting for the previous one to report healthy.
Data lives in the named volume `apex-typedb-data`, so `docker compose down` keeps it and `down -v` removes it.
`npm run create-database -- --replace` and `npm run reset-demo` (in `api/`) rebuild a database from `data/seed/`;
both can run inside the API image (`docker compose run --rm seed node scripts/create-database.ts --replace`) or
on the host with Node. The Docker files were updated with the TypeScript port but have not yet been rebuilt
from scratch since (Docker was not available where the port was made): check the first `docker compose up`.

## Tests

`npm test` in `api/` (vitest, TypeDB running): about 290 tests in ~30 seconds, against real throwaway
databases. Expected answers come from `api/tests/oracle.ts`, which reads the YAML directly and uses different
algorithms from the app (for example Bellman-Ford instead of the app's dependency-order walk), so a wrong query
can't pass by agreeing with itself. Deliberately broken versions of key functions were used to confirm
the tests fail when they should (plan.md §7-§11).

The port from Python was verified request by request against the original API on the same database: every
endpoint, parameter and error case answered identically except the timing fields.
