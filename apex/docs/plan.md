# Project Apex: plan

**Status: all five phases complete (2026-10-27). Local only: not pushed or deployed.**

A demonstration application, powered by TypeDB, of a fictional £2.4bn acquisition (Novacore plc acquiring
Atlas Biopharma plc), for senior executives and technical stakeholders at a major consulting firm.
Goal: a **working, technically credible** demo of TypeDB's entity-relation model, typed relationships,
schema inheritance and queries over connected information. Depth over breadth.

Related documents: [schema-design.md](schema-design.md), [queries.md](queries.md), [dataset.md](dataset.md),
[demo-script.md](demo-script.md).

**Revision 2 (2026-10-26), after reviewing the private-markets mini demo:** adds the Atlas group
ownership structure with effective-ownership queries and a change-of-control consent scenario, three
data-quality checks on the Overview, and optional live-extension and constraint-enforcement steps for
the Phase 5 demo. Same three screens, same five phases.

## 1. Environment (inspected 2026-10-26)

| Item | Finding | Consequence |
|---|---|---|
| Docker Desktop | Installed and running; CLI at `/Applications/Docker.app/Contents/Resources/bin/docker` (not on PATH) | Use the full path or `~/.docker/bin` |
| TypeDB | Apex now has its **own** server: container `apex-typedb`, CE 3.14.1, ports 127.0.0.1:**1732** (driver) / **8003** (Studio), volume `apex-typedb-data`. Other projects' servers (1729-1731) are untouched | Running and healthy |
| Python | uv 0.13.5 available; system Python is 3.9 | uv manages Python 3.13, as in the other projects |
| Python driver | typedb-driver 3.14.0 | Same, proven version as the other projects |
| Node.js | **Not installed** | Frontend tools run inside the official Node Docker image (`scripts/npm-docker.sh`), the pattern NewsLens already uses |
| Reference | NewsLens (`../newslens`) already runs React + Vite + Tailwind + shadcn/ui behind FastAPI in Docker Compose | Reuse its proven config and versions, checked first |
| TypeDB docs | typedb.com/docs confirms recursive functions and nested `fetch` sub-queries but doesn't cover several details | Every feature we depend on was tested on the real server instead (see schema-design.md §8) |

## 2. Architecture

```
 Browser ──► web (nginx, 127.0.0.1:8091) ──► /api/* ──► api (FastAPI, Python 3.13)
             React + TypeScript + Tailwind                 │  apex/queries.py: ALL TypeQL
             + shadcn/ui + React Flow                      │  READ transactions only
                                                           ▼
                                               typedb (CE 3.14.1, 127.0.0.1:1732)
                                               the ONLY database: schema, data, functions
```

**Containers (Docker Compose):** `apex-typedb`, `apex-api` (no published port; reached through the web
container), `apex-web` (nginx serving the built React app and proxying `/api`). One command starts it all:
`docker compose up -d --build`. All ports bound to 127.0.0.1.

**Backend (Python, FastAPI)**
- `apex/db.py`: connect, `read()` (READ transactions only), `write()` (loader only), `string()` for safe
  text in queries. Reuses the proven helpers from the other projects.
- `apex/queries.py`: every TypeQL query, each a named function returning plain data **and** the query text.
- `apex/impact.py`: date propagation over the dependency edges TypeDB returns (pure Python, unit-tested).
- Ownership answers are always guarded: the cycle and over-100% guard queries run first in the same
  READ transaction; if either finds anything, the API returns the problem and no figures.
- `apex/api.py`: read-only endpoints; validated inputs (codes by pattern, days 0-365). No auth, no
  external calls, no LLM (as specified).
- `apex/seed.py` + `data/seed/*.yaml`: loader that validates the YAML, inserts in one transaction, and
  checks counts afterwards (a `match … insert` that matches nothing silently inserts nothing).

**Proposed endpoints**

| Screen | Endpoint |
|---|---|
| Overview | `GET /api/deal`, `/api/participants`, `/api/milestones`, `/api/progress`, `/api/approvals`, `/api/activity?limit=10`, `/api/raci?workstream=WS-REG`, `/api/checks` (the three data-quality checks) |
| Explorer | `GET /api/graph?types=…`, `/api/graph/node/{code}`, `/api/graph/paths?from=…&to=…`, `/api/schema/types` (hierarchy for the legend), `/api/ownership?parent=ORG-ATL` (group tree, effective stakes, consents; guarded) |
| Impact | `GET /api/impact?item=CP-CMA&delay_days=28` (includes affected obligations inside the Atlas group) |
| All | every response: `{ data, typeql: [..], elapsed_ms }` |

**Frontend (React + TypeScript)**: Vite build; Tailwind v4 + shadcn/ui components (Card, Badge, Table,
Tabs, Slider, Sheet, Tooltip); React Flow (`@xyflow/react`) for graphs, with an automatic layout library
(dagre or ELK, chosen in Phase 3 by trying both on the real data); TanStack Query for data fetching. Three
routes: `/` Overview (with an "Attention needed" card), `/explorer` (network view and a group-structure
view), `/impact`. A "Show TypeQL" drawer on every relevant panel (collapsed by default), and a "Fictional demonstration data" label on
every screen. The frontend holds **no business data or logic**: every figure, warning and effective
stake comes from TypeDB via the API (tested in Phase 2 by checking the built app contains no seed values).

**Why this shape:** one place for TypeQL makes the "everything is in TypeDB" claim easy to audit; read-only
API means nothing in the demo can damage the data; the Impact Explorer computes "what if" without writing.

## 3. Phases and what "done" means

Each phase ends at an **approval gate**: stop, report what works, what failed and what's next.

| Phase | Builds | Done when (tested) |
|---|---|---|
| **1. Data model and seed data** | `schema/schema.tql` (+ functions, incl. ownership), seed YAML (incl. Atlas group and consents), loader with ownership guards, `scripts.create_database`, Studio walkthrough queries | Schema loads on a fresh database; seed loads with counts matching the YAML (relations included); tests pass for: one Accountable per item, no hard-dependency cycles, base dates consistent with lags, every item inside its deadlines, schema rejects bad data (6 negative tests incl. stake > 100%); the three data-quality checks return nothing on the seed; **effective stakes match an independent Python route-by-route calculation exactly** (incl. the 2-route 90% case); an injected cycle and an injected 120% case make both guards fire and the loader refuse; the Impact answer-key numbers come out of TypeDB + a Python oracle |
| **2. Backend and Overview** | FastAPI app, Overview endpoints incl. `/api/checks`, React app shell, Overview screen + compact RACI matrix + Attention-needed card, Compose with all 3 containers | API tests against a disposable database; checks endpoint tested on clean and planted-problem databases; screen renders real data; built frontend contains no seed values; `docker compose up` from a clean clone works |
| **3. Relationship Explorer** | Graph endpoints, React Flow view, type filters from the schema, node focus, "how connected?" paths, group-structure view (`/api/ownership`) | Each relation type appears with role labels; filters by parent type work; group tree shows effective stakes and routes as TypeDB returns them; `/api/ownership` refuses to answer on a database with a cycle; layout readable at full data size; tested in the browser |
| **4. Impact Explorer** | `/api/impact`, delay slider, affected items with old → new dates and cause chains, deadline breach warnings, RACI of affected items, affected obligations inside the Atlas group | Answer-key scenarios (0, 28, 119, 120, 168 days) give exactly the documented results, incl. the Helix call-option window |
| **5. Testing, polish, demo** | Visual polish, light/dark, demo script (10-minute main path + optional Studio steps T1 constraint enforcement and T2 live schema extension), `scripts.reset_demo`, README, screenshots, final security pass | Full test suite green; clean-start rehearsal from a fresh clone; demo script timed; T1 and T2 rehearsed on `apex-demo` with exactly the documented outcomes, then reset |

## 4. Technical risks and assumptions

**Verified (2026-10-26, on apex-typedb):** the full draft schema loads; recursive functions (including on
cycles, and returning relations in tuples); role specialisation; `@card` on roles; `@range`/`@values`;
exact type and role labels in results; `fetch { $x.* }` over abstract types; `count groupby`; `sort`/`limit`.

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | `date + duration` isn't supported in TypeQL (verified) | Certain / low | Date shifting in Python (`apex/impact.py`), clearly labelled "projected" |
| R2 | TypeDB can't return its internal IDs in `fetch` (verified) | Certain / low | Every node has a `code @key`; edges keyed in Python |
| R3 | `distinct` doesn't de-duplicate after `or` (TypeDB bug, found in earlier project) | Known / medium | Avoid `or` in listing queries; de-duplicate in Python; tests |
| R4 | `fetch`/`insert` reject `$x.attr` when any possible type of `$x` lacks `attr` | Known / medium | Bind concrete types or use `$x.*`; covered by tests |
| R5 | Recursive function speed at full data size | **Closed** | Measured in Phase 1: 2-6 ms on the full seed (target was < 100 ms) |
| R6 | Relationship graph unreadable (~45 parties + hubs) | Medium / high for the demo | Default view = organisations only; people on demand; filters; focus mode; test layouts on real data |
| R7 | No read-only database user in TypeDB CE | Certain / low (local demo) | READ transactions only in the API (tested); ports bound to 127.0.0.1 |
| R8 | Node.js not installed | Certain / low | Docker-based npm (works in NewsLens) |
| R9 | Python driver is synchronous; FastAPI is async | Medium / low | Run queries in FastAPI's thread pool (plain `def` endpoints); one shared driver; check with concurrent requests in Phase 2 |
| R10 | Deal mechanics wrong in front of an expert audience | Medium / **high** | Timeline uses real Takeover Code / CMA / EC / HSR / NSIA periods (worked out in dataset.md); **needs a sanity check by someone with UK M&A experience** before the demo |
| R11 | Fictional names collide with real firms | Medium / medium | Check names against Companies House and a web search before publishing; disclaimer on every screen |
| R12 | Library versions drift (React Flow, shadcn, Tailwind v4) | Low / low | Pin exact versions; reuse NewsLens's working set |
| R13 | Over-claiming vs SQL in the demo | Medium / high (credibility) | schema-design.md §7 states honest limits; each claim backed by a live query on screen |
| R14 | Effective-ownership recursion gives wrong totals if ownership ever has a cycle (verified: 105% stakes from a 5% cross-holding, no error) | Low in our data / **high** if it happened | Guard queries in loader and API; independent Python oracle; "no cross-shareholdings" stated on screen as a deliberate simplification |
| R15 | A relation inserted with no role players is silently dropped at commit (verified) | Medium / medium | Loader compares relation counts too, not only entities |
| R16 | Live demo steps (T1, T2) change data in front of an audience | Low / medium | Only on `apex-demo`, never `apex`; one-command reset; rehearsed in Phase 5 |

**Assumptions to confirm**
- A1. Calendar-day lags are acceptable (statutory dates were worked out in working days, but propagation
  adds calendar days).
- A2. One deal only. The schema supports several (`deal-scope`), but the UI won't offer a deal picker.
- A3. The demo runs on a laptop, offline, via Docker Compose; no hosting in v1.
- A4. "Today" is fixed at 26 Oct 2026 in the data, so the demo always looks the same.
- A5. British English and £ throughout.

## 5. Decisions (approved 2026-10-26)

| # | Decision | Approved |
|---|---|---|
| D1 | Project folder | `~/Desktop/TypeDB/project-apex`, own git repo, own TypeDB container |
| D2 | Open-source licence | **Apache-2.0** (`LICENSE`, `NOTICE`) |
| D3 | Authorities | Real public bodies (CMA, European Commission, FTC, DOJ, ISU, Takeover Panel, High Court) in a fictional scenario, with a clear disclaimer. All companies and people are invented. Roles checked against sources: see dataset.md |
| D4 | Impact Explorer | Read-only "what if"; nothing saved |
| D5 | "Show TypeQL" | On every relevant panel, **collapsed by default** (a small "Show TypeQL" toggle), so screens stay clean for executives and the proof is one click away |
| D6 | Web address | 127.0.0.1:8091 |

## 6. Architectural decisions (approved 2026-10-26)

| # | Decision | Approved choice | When needed |
|---|---|---|---|
| A1 | Which database the app reads. Optional demo step T2 writes in Studio and the app must show it | App reads the database named in `.env` (`APEX_DATABASE`, default `apex`). Two databases: `apex` (pristine) and `apex-demo` (for live steps), rebuilt by `scripts.reset_demo` (both exist from Phase 1) | Phase 2 |
| A2 | Seed format | YAML source (readable, validated, checked by the loader), plus a generated `seed.tql` committed for people who want to load it in Studio, as the reference project does | Phase 1 |
| A3 | Keeping backend and frontend data shapes in step | Generate TypeScript types from FastAPI's OpenAPI description (`openapi-typescript`), not hand-written copies | Phase 2 |
| A4 | Graph layout library | Try dagre and ELK on the real data, keep the more readable one. **Done: ELK** (see §9) | Phase 3 |

## 7. Phase 1 results (2026-10-26)

Built: `schema/schema.tql` + `schema/functions.tql`; `data/seed/*.yaml` (the fictional dataset) and the
generated `data/seed.tql`; `apex/seed.py` (validation, rendering, one-transaction load with checks);
`apex/queries.py` (guards, effective ownership, group consents, data-quality checks, impact inputs);
`apex/impact.py` (date projection); `apex/database.py` and `scripts/` (`create_database`, `reset_demo`,
`export_seed_tql`, `check_connection`); 75 tests.

| Acceptance criterion | Result |
|---|---|
| Schema loads on a fresh database | Pass (every test database, `apex`, `apex-demo`) |
| Seed loads with counts matching the YAML, relations included | Pass: 471 entities and relations across 36 exact types, checked inside the load transaction |
| One Accountable per item; no hard-dependency cycles; base dates respect lags; base plan meets every deadline | Pass (checked in TypeDB) |
| Schema rejects bad data | Pass: 8 negative tests (second Accountable, stake > 100%, unknown status, progress > 100, regulator as adviser, second workstream, duplicate code, attribute on the wrong type) |
| Data-quality checks return nothing on the seed, and fire on planted problems | Pass |
| Effective stakes match an independent route-by-route calculation exactly, incl. the 2-route 90% | Pass (exact decimals) |
| Injected cycle and 120% case: both guards fire, figures are withheld, the loader refuses | Pass; an unguarded query is shown to give >100% |
| Impact answer key (0, 28, 60/61, 119/120, 135/136, 149/150, 168, 365 days) | Pass; every projected date also matches an independent calculation |
| Generated `seed.tql` is up to date and loads on its own (Studio path) | Pass |

Deliberate-break checks: summing only the best ownership route, and letting the impact walk follow soft
links, each made tests fail, as intended.

## 8. Phase 2 results (2026-10-27)

Built: `apex/api.py` (FastAPI, GET only, READ transactions only), `apex/overview.py` (the Overview's
answers: counting, the headline status rule and date arithmetic, over TypeQL results),
`apex/models.py` (response models; the TypeScript types in `web/src/api/schema.d.ts` are generated from
them via `web/openapi.json`), the Overview queries Q1.1-Q1.7 in `apex/queries.py`, the React app in `web/`,
and Compose services `seed` (one-off), `api` and `web`. 97 tests (75 from Phase 1 + 22).

| Acceptance criterion | Result |
|---|---|
| API tests against a disposable database | Pass: every endpoint checked against figures recomputed from the YAML (20 tests) |
| Checks endpoint on clean and planted-problem databases | Pass: all clear on the seed; one planted problem per check is reported by name |
| Ownership endpoint refuses on a cycle | Pass: 409 with the guard query that fired, and no figures |
| "Show TypeQL" shows the actual queries | Pass: recorded as they run, parameters included; a test re-runs every recorded query and gets the same answer |
| Read-only | Pass: only GET routes; POST/DELETE give 405; the API modules contain no WRITE/SCHEMA/commit |
| Connection failures | Pass: TypeDB down or database missing gives a plain 503 message; concurrent requests work |
| Screen renders real data | Pass: checked in a browser at 1440 px and 375 px; 85 values on screen compared with the API's answers |
| Built frontend contains no seed values | Pass: source and bundle scanned for every seed name, code, date, amount and text |
| `docker compose up` from a clean state | Pass: `seed` creates `apex` only if missing, then `api` and `web` start; app at http://127.0.0.1:8091 |

**Deviations from the plan (all minor, no schema change):**
- `/api/participants` is called `/api/parties`. `/api/ownership` (planned for Phase 3) was built and
  tested now, as requested, but the Overview doesn't display it; the group view comes in Phase 3.
- The planned `/api/progress` returns the workstreams with their items' status counts; the headline
  progress figure is in `/api/deal` with the other key metrics.
- Headline status ("at risk" / "on track" / "conditions satisfied"), days remaining and deadline headroom
  are computed on the server from TypeDB results (approved 2026-10-27): TypeQL can't subtract dates.
- The data-quality check queries now also fetch each item's name; what they check is unchanged.
- `openapi-typescript` expects TypeScript 5 while the app uses 6, so it runs as its own pinned tool
  (`npx openapi-typescript@7.13.0`) rather than as a project dependency.
- New `scripts.create_database --if-missing`, used by the Compose `seed` step; it never replaces data.

Deliberate-break checks: treating "at risk" as healthy made the status test fail; adding a seed name to
the frontend source made the no-hard-coded-data test fail.

## 9. Phase 3 results (2026-10-27)

Built: `apex/explorer.py` (graph, node detail and group structure, composed from TypeQL in
`apex/queries.py`), endpoints `/api/graph`, `/api/graph/node/{code}` and an extended `/api/ownership`
(direct stakes, every route, outside shareholders; parent defaults to the deal's target), the React Flow
Relationship Explorer with two views (transaction network, group structure) in `web/src/components/explorer/`,
and `web/scripts/compare-layouts.ts`. 107 tests (97 + 10).

| Acceptance criterion | Result |
|---|---|
| Each relation type appears with role labels | Pass: relations are read generically (`$r links ($role: $p)`) with every player and role, n-ary ones whole (a mandate's client, adviser **and** deal; a review's authority, clearance and applicant). Tested against the YAML; checked on screen: 26 of 26 lines, each between the right role players |
| Filters by parent type work | Pass: organisation families come from the schema hierarchy (hiding "professional services firm" hides all four firm types, not the investment banks, which are financial institutions); relation types can be switched off too |
| Group tree shows effective stakes and routes as TypeDB returns them | Pass: stakes and route counts from `group_members`; each route listed from the direct holdings and **required to add up to TypeDB's figure exactly** or no figures are returned. Atlas IP Holdings 90% = 70% + 20% (2 routes), the JV 60% (1 route); all match the independent oracle |
| `/api/ownership` refuses to answer on a database with a cycle | Pass: 409 with the guard queries, no figures; also on a company over 100% owned. The network itself still draws (it has no percentages) |
| Layout readable at full data size | Pass, with progressive disclosure: the target's group starts folded into one box (it has its own view); every group can be collapsed or expanded; people appear on demand |
| Tested in the browser | Pass at 1440 px and 375 px: selection and focus, detail panel, people, expand/collapse, relation and family filters, route highlighting, no console errors, no sideways scrolling |

**Layout choice (A4), measured on the real graph** (`web/scripts/compare-layouts.ts`, straight lines between box centres):

| Engine | Crossings | Lines through other boxes | Group overlaps | Size | Aspect |
|---|---|---|---|---|---|
| **ELK layered, groups, left-to-right (chosen)** | 3 | 5 | 0 | 1858 × 1022 | 1.82 |
| ELK layered, groups, top-down | 4 | 3 | 0 | 2655 × 946 | 2.81 |
| dagre, groups, left-to-right | 2 | 5 | 0 | 2261 × 1168 | 1.94 |
| dagre, groups, top-down | 2 | 0 | 0 | 3041 × 1337 | 2.27 |
| dagre, no groups | 0 | 6 | 8 | 1766 × 722 | 2.45 |

ELK and dagre score similarly on crossings; ELK was chosen because its layout is about a third smaller
for the same groups (so text is larger on screen), it handles groups natively, and side by side in the
browser its grouping read more clearly. Top-down layouts are too wide for a screen. The group structure
uses ELK's top-down tree with right-angled routing, so ownership lines go around companies, not through them.

**Deviations from the plan:**
- Planned `/api/schema/types` is part of `/api/graph` (`types`: the party hierarchy and each relation type's
  roles, straight from the schema); planned `/api/graph?types=` filtering is done in the browser on the
  one answer (27 organisations), so switching filters doesn't re-query.
- "How are two parties connected?" (`/api/graph/paths`, Q2.4) was not built: not in the Phase 3
  acceptance criteria and not required by the brief; can be added later.
- Review lines are laid out applicant -> authority (and drawn without arrowheads) so the authorities sit
  beside the deal instead of stacking with the advisers; their roles are unchanged and shown in full.
- Obligation names for consents are looked up separately, so the Phase 1 `group_consents` query and its
  test are unchanged.
- nginx now tells browsers to re-check the page on every load (built files are cached for good), after a
  stale cached page served an old version during testing.

Deliberate-break checks: dropping non-party players from relations made the n-ary test fail; keeping only
one route per company (with the cross-check off) made both ownership tests fail.

## 10. Phase 4 results (2026-10-27)

Built: `GET /api/impact?item=&delay_days=` (READ only; `apex.impact.scenario` composes it), the Impact
Explorer screen (`web/src/pages/Impact.tsx`, `web/src/components/impact/`): scenario control with slider,
presets and reset; escalation banner; deadline cards; dependency chain graph with detail panel; before and
after timeline; "Who needs to act". 129 tests (107 + 22).

| Acceptance criterion | Result |
|---|---|
| Answer-key scenarios give exactly the documented results | Pass: 0, 28, 61, 120, 136 and 168 days, plus both sides of every deadline (60/61, 119/120, 135/136, 149/150): every projected date, breach and days-over equals the independent oracle (Bellman-Ford over the YAML); 168 days gives Helix +108, long-stop +49, drawdown +19, settlement +33 |
| Thresholds and presets come from the data | Pass: the API finds the first breaching delay for each deadline (61, 120, 136) by searching the projection; the frontend contains none of these numbers or outcomes (tested by scanning its source) |
| Dependency graph from TypeDB, hard vs soft | Pass: 15 hard edges from the recursive `impact_edges`, 5 soft (informing) edges, 4 deadline limits; checked on screen (24 of 24 lines, every lag label) and against the YAML; which kinds are "hard" comes from the schema (`$k sub hard-dependency`) |
| Who needs to act | Pass: RACI of the delayed approval, of everything downstream (via the recursive `downstream`) and of the deadlines; matches the YAML for every item; people and organisations listed with mandates, obligations and consent rights |
| Never modifies the database | Pass: GET only, READ transactions only; a test runs 26 scenarios and checks counts, dates and statuses are unchanged |
| Desktop and mobile | Pass at 1440 px and 375 px: slider (each boundary checked), presets, reset, graph selection and path highlighting, toggles, no console errors, no sideways scrolling |

**How the three levels are kept apart on screen:** a *delayed* item is amber with "+N days" (projected,
never stored); a *breached deadline* is red, with the days over (a calculation from stored dates and
dependencies); its *consequence* sits in a separate violet box headed "Potential exposure · needs legal
judgement", quoting the consequence recorded on the deadline, with who is bound and who holds the consent right.

**Deviations from the plan:**
- Reference scenarios (28 days: CMA Phase 1 extension; 168 days: Phase 2) are scenario *inputs*, kept in
  `apex/impact.py` (`REFERENCE_SCENARIOS`); the schema has no place for them and the dataset was not to be
  expanded. The thresholds (61/120/136) are calculated, never configured.
- With no item given, the API simulates the condition TypeDB records as at risk (the CMA clearance); the
  court sanction can be chosen too. Other items can be simulated through the API.
- Q3.2/Q3.3 are served by the Phase 1 queries (all items, all deadline limits) filtered to the recursion's
  result; Q3.4 by one query for all dependencies plus the schema's hard kinds; Q3.6 by the guarded
  `group_consents`. If the ownership guards fire, the impact still shows, without the group stakes.
- The graph opens on the critical path (the delayed approval to the deadline-limited items, 8 boxes);
  "Show all affected items" and "Show soft dependencies" disclose the rest (23 boxes).
- The "Show TypeQL" drawer also shows the two recursive functions, read from `schema/functions.tql`.
- **Resolved in Phase 5 (approved 2026-10-27):** the Helix deadline's stored consequence now ends "If Helix
  exercised the option, Novacore could lose control of manufacturing", so the data itself describes a
  potential exposure, not a certainty.

Deliberate-break checks: treating a deadline as missed on its due date made the threshold test fail;
dropping deadlines from the RACI query made the RACI test fail; planting "61" in the screen's code made the
no-hard-coded-outcomes test fail.

## 11. Phase 5 results (2026-10-27)

| Check | Result |
|---|---|
| Approved data change (Helix consequence wording) | Done in `data/seed/work.yaml`; `data/seed.tql` regenerated; `apex` and `apex-demo` rebuilt (471 records, all load checks passed); all tests pass |
| Visual consistency | One page-header pattern and one segmented switch on all three screens; panel spacing aligned; checked at 1440 px and 1280 × 800 |
| End-to-end demo | All eight steps of the executive script walked through in the browser; each step shows exactly what the script says (figures checked against the API) |
| Automated tests | **130 passed** (~22 s) |
| Read-only | 58 simulations plus every other endpoint against the live `apex`: record counts, dates and statuses identical before and after (fingerprint match) |
| Database shutdown and recovery | With TypeDB stopped: data requests fail in under 50 ms with a plain message, one banner says TypeDB is unreachable, figures already on screen stay visible. On restart: the API reconnects in about 2 s and every panel reloads by itself; no restarts or refreshes |
| API container loss | Fails in milliseconds (was up to 60 s); a recreated API container is found again within about 2 s without restarting the web container |
| Clean start | Fresh copy (no `.env`, no packages, empty volume): `docker compose up -d --build` ready in 21 s with cached images; database built and checked; all screens and endpoints answer |
| `apex-demo` reset | After optional step T2 (474 records and a new type), `scripts.reset_demo` restores exactly the seed data: same fingerprint as `apex`; the new type is gone |
| Optional technical steps | T1 (five constraint violations, each refused: CNT5, CNT7, CNT8, INF11, CNT5), T2 (live schema extension with the app pointed at `apex-demo`) and T3 rehearsed with exactly the documented results, then reset |
| Browser console and network | No console errors on any screen; every request succeeds and goes only to the app itself (no external calls) |
| No business data in the frontend | Source and built bundle scanned for every seed value; the Impact screen's code for every threshold and outcome |
| Secrets | No `.env`, keys, notes or databases in any commit; the only credential-like value is TypeDB's documented default password in `.env.example`, acceptable because TypeDB is reachable from this computer only |
| Licences | Apache-2.0 for Apex; third-party licences read from the installed packages and listed in NOTICE (TypeDB CE: MPL-2.0; elkjs: EPL-2.0; Inter: OFL-1.1; the rest MIT/BSD/ISC/Apache-2.0) |

**Fixed in Phase 5:** `/api/health` now asks TypeDB on every call (it reported "ok" during an outage);
nginx fails fast and re-resolves the API's address; one connection banner with automatic refresh instead of
an error in every panel; the RACI panel no longer waits forever when its workstream list fails; the Impact
screen follows the address (Back, or an edited `?days=`).

**Not done (out of the approved scope, no new features):** a dark theme (in the original Phase 5 plan);
"how are two parties connected?" paths (noted in Phase 3). The demo script's timings are estimates from a
scripted walk-through, not a spoken rehearsal.
