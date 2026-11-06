# Schema design

Status: **implemented in Phase 1** (`schema/schema.tql`, `schema/functions.tql`), loaded and tested
on the project's TypeDB 3.14.1 server (see "Verified" at the end).

## Plain-English primer

TypeDB stores four kinds of things:

| Term | Plain English | Example |
|---|---|---|
| **entity** | A thing that exists on its own | Novacore plc, a person, a milestone |
| **relation** | A connection between things, where each thing plays a named **role** | a *mandate* in which Novacore is the *client* and Harrowgate & Co is the *adviser* |
| **attribute** | A value owned by an entity or relation | name "Novacore plc", due date 2026-11-30 |
| **function** | A saved, reusable question, which can call itself (recursion) | "everything downstream of the CMA approval" |

**Inheritance** (`sub`) means "is a kind of": a *law-firm* is a kind of *professional-services-firm*,
which is a kind of *organisation*. Anything true of the parent (attributes it owns, roles it plays) is
automatically true of the child, and a query for the parent finds all children. **Abstract** types
(`@abstract`) are categories only: you can't create a plain "organisation", only a specific kind.

## 1. Type hierarchy

```
ENTITIES                                         RELATIONS
party @abstract                                  transaction @abstract (buyer, seller)
├── person                                       └── acquisition (acquirer as buyer, target as seller)
└── organisation @abstract                       employment (employee, employer)
    ├── company                                  mandate (client, adviser, engagement)
    ├── financial-institution @abstract          financing (borrower, lender, purpose)
    │   ├── investment-bank                      deal-scope (deal, item)
    │   └── commercial-bank                      work-breakdown (whole, part)
    ├── professional-services-firm @abstract     authority-review (reviewer, subject, applicant)
    │   ├── law-firm                             bound-by (obligor, obligation)
    │   ├── accounting-firm                      deadline-limit (limited-item, deadline)
    │   ├── consultancy                          dependency @abstract (prerequisite, dependent)
    │   └── communications-firm                  ├── hard-dependency @abstract
    └── authority @abstract                      │   ├── gating      (a condition must be met first)
        ├── regulator                            │   └── sequencing  (X must finish before Y)
        └── court                                └── informing       (soft: Y needs input from X)
                                                 ownership (owner, owned)          [group structure]
                                                 consent-right (grantor, obligation)
                                                 raci-assignment @abstract (holder, item, via)
deal-item @abstract                              ├── responsibility   (R)
├── workstream                                   ├── accountability   (A: accountable-item as item)
├── milestone                                    ├── consultation     (C)
└── obligation @abstract                         └── notification     (I)
    ├── condition                                deal-event (actor, subject)
    │   ├── regulatory-clearance
    │   ├── shareholder-approval
    │   └── court-sanction
    ├── covenant
    └── deadline
```

Why these splits matter (each one is used by a screen, not decoration):

- **party → person / organisation**: a RACI holder can be a person *or* a firm. One role
  (`raci-assignment:holder`) is played by `party`, so both work with no extra tables or nullable columns.
- **organisation subtypes**: the Relationship Explorer colours and filters by type, and "show all
  advisers" is a single query on `professional-services-firm` + `investment-bank`.
- **Roles cut across the hierarchy**: `mandate:adviser` is played by both `investment-bank` and every
  `professional-services-firm`, but not by `commercial-bank`. The schema states who may advise; an
  attempt to make a regulator an adviser is rejected before any data is touched.
- **deal-item → workstream / milestone / obligation**: every unit of work shares status, dates,
  progress, dependencies and RACI by inheritance, so the impact query walks across all of them in one
  pass and still reports each item's specific kind.
- **dependency subtypes**: the Impact Explorer only pushes dates through `hard-dependency` (gating and
  sequencing). `informing` links are shown as "keep informed" but don't move dates. One word in the query
  (`hard-dependency` vs `dependency`) switches between the two meanings.
- **raci-assignment subtypes**: the letter is the relation's type, so "who is involved" is one query on
  the parent and "who is accountable" is one query on the child.

## 2. Attributes and who owns them

| Attribute | Value type | Owned by | Notes |
|---|---|---|---|
| `code` | string, `@key` | party, deal-item, transaction, mandate, financing | Stable readable ID, e.g. `MS-COMPLETION`. Used as graph node IDs (TypeDB can't put its internal ID into `fetch`). Unique across the whole database. |
| `name`, `description` | string | most types | |
| `job-title` | string | **employment** | A title belongs to the job, not the person. |
| `jurisdiction`, `sector` | string | organisation | |
| `deal-value` | decimal | transaction, financing | Exact money (decimal, not floating point). |
| `currency` | string `@values("GBP","USD","EUR")` | transaction, financing | |
| `deal-structure` | string | transaction | "Scheme of arrangement" |
| `as-of-date` | date | transaction | The demo's "today", stored in data so the demo never goes stale. |
| `status` | string `@values("not-started","in-progress","at-risk","delayed","complete")` | deal-item | |
| `criticality` | string `@values("low","medium","high","critical")` | deal-item | |
| `planned-start`, `due-date`, `baseline-due-date`, `completed-date` | date | deal-item | Baseline = the plan at announcement, so slippage is visible. |
| `progress` | integer `@range(0..100)` | deal-item | |
| `lag-days` | integer `@range(0..365)` | dependency | Minimum days between prerequisite and dependent. |
| `stake` | decimal `@range(0.0dec..1.0dec)` | ownership | Fraction of shares held (0.6 = 60%). Exact decimal, so 0.7 + 0.2 is exactly 0.9. |
| `legal-basis`, `review-phase` | string | obligation / authority-review | e.g. "Enterprise Act 2002", "Phase 1" |
| `consequence` | string | obligation | What happens if it isn't met, e.g. "the Helix waiver lapses and its call option revives" |
| `mandate-type` | string | mandate | "Lead financial adviser", "Rule 3 adviser" |
| `occurred-at` | datetime | deal-event | |
| `summary`, `event-kind` | string | deal-event | |

Dates are `date` (calendar days). Date shifting for the Impact Explorer is done in Python (see
[queries.md](queries.md)), because TypeDB 3.14.1 can add durations to `datetime` but not to `date`.

## 3. Relations and roles

| Relation | Roles (who plays them) | What it says |
|---|---|---|
| `acquisition sub transaction` | acquirer, target (company) | Novacore acquires Atlas. Owns value, currency, structure. The relation itself plays roles in `deal-scope`, `mandate` and `financing`. |
| `employment` | employee (person), employer (organisation) | Owns `job-title`. |
| `mandate` | client (company), adviser (investment-bank, professional-services-firm), engagement (acquisition) | **Three-way**: who advises whom, on which deal. Plays `raci-assignment:via`. |
| `financing` | borrower (company), lender (financial-institution), purpose (acquisition) | The bridge facility; one relation per lender. |
| `deal-scope` | deal (acquisition), item (deal-item) | Which work belongs to the deal. |
| `work-breakdown` | whole (workstream), part (deal-item) | Each item sits in at most one workstream (`@card(0..1)`). |
| `authority-review` | reviewer (authority), subject (condition), applicant (company) | CMA reviews the UK merger clearance, applied for by Novacore. Owns legal basis and phase. |
| `bound-by` | obligor (organisation), obligation | The legal duty-holder, which is different from the operational RACI. |
| `deadline-limit` | limited-item (deal-item), deadline | "Completion must happen by the long-stop date." Separate from dependency on purpose: a deadline doesn't move when things slip; it gets breached. |
| `gating`, `sequencing`, `informing` | prerequisite, dependent (deal-item) | Owns `lag-days`. |
| `responsibility`, `accountability`, `consultation`, `notification` | holder (party), item (deal-item), via (mandate, optional) | RACI. `via` records *why* someone holds it: Blackwood Marsh is Responsible for the scheme document **through** its mandate from Novacore. |
| `deal-event` | actor (party), subject (deal-item) | Recent activity feed. |
| `ownership` | owner (company), owned (company) | Owns `stake`. The same relation at every level of a group: plc → holding company → subsidiary → joint venture. Outside shareholders (a JV partner, a university spin-out company) use it too. |
| `consent-right` | grantor (organisation), obligation (any obligation) | Who must give consent: e.g. Helix holds a change-of-control right over the JV. Kept separate from `bound-by` (who owes the obligation) because the two are different parties with different interests. |

## 4. Rules the schema enforces (checked by TypeDB on every write)

| Rule | How | Verified |
|---|---|---|
| Every item has a unique code | `owns code @key` | yes (`@key`, earlier projects) |
| At most one Accountable per item | `plays accountability:accountable-item @card(0..1)` | yes: second A rejected with [CNT5] |
| Progress is 0-100 | `@range(0..100)` | yes: 150 rejected with [CNT7] |
| Status, criticality, currency only from fixed lists | `@values(...)` | yes |
| Only advisers can hold mandates; only authorities review | `plays` declarations | yes (type inference rejects others) |
| An item is in at most one workstream | `plays work-breakdown:part @card(0..1)` | yes: second workstream rejected with [CNT5] |
| A stake is between 0% and 100% | `stake @range(0.0dec..1.0dec)` | yes: 1.5 rejected with [CNT7] |

Rules the schema **can't** express are checked by Phase 1 tests: every item has exactly one Accountable
(the schema enforces "at most"), no cycles in hard dependencies, every dependent's date is at least its
prerequisite's date plus lag, and every dated item sits before its deadlines in the base plan.

### Ownership guards: why effective ownership never returns a misleading total

Effective ownership multiplies stakes along every route and adds the routes up (§5). That is only
correct if ownership has **no cycles** and **no company is more than 100% owned**. If a cycle exists,
the recursion keeps going round it until decimal precision runs out, and returns plausible-looking but
wrong totals (tested: a 5% cross-holding produced 105% effective stakes and a 5.3% "self-ownership").
So three layers of protection, all written as TypeDB queries:

1. **Loader refuses bad data.** After loading, the loader runs `ownership_cycles()` and the
   over-ownership query (queries.md Q2.7, Q2.8). Any result → the load is rolled back with a message
   naming the companies.
2. **Every effective-ownership answer is guarded.** The API runs both guard queries in the **same READ
   transaction** before calling `group_members`. If either finds anything, the endpoint returns
   "ownership data inconsistent" plus the offending companies, and **no numbers at all**.
3. **Independent test oracle.** A Phase 1 test recomputes every effective stake from the seed YAML in
   plain Python (enumerating every route) and compares it with TypeDB's answer exactly (decimals, so no
   rounding tolerance). Tests also inject a cycle and a 120% case into a disposable database and assert
   both guards fire and the API refuses to answer.

**Deliberate simplification.** Rejecting cycles is a choice for this fictional dataset, not how the
real world works. Real corporate groups can contain cross-shareholdings (A owns part of B, B owns part
of A), and regulators define control in other ways too (voting rights, board appointment rights,
"significant influence"). Handling those correctly needs more sophisticated methods, for example solving
the ownership equations as a matrix (Leontief inverse) or applying jurisdiction-specific control tests.
Apex says so on screen ("Effective ownership assumes no cross-shareholdings") and in the README.

Implemented in Phase 1: the guards are `ownership_problems()` in `apex/queries.py`, used by the loader
(`apex/seed.py`) and by `effective_ownership()` / `group_consents()`. They are tested in
`tests/test_ownership.py`, including injected cycles and over-ownership, a deliberately unguarded
query showing the misleading total, and the loader refusing a cross-shareholding.

## 5. Functions (saved queries stored in the schema)

```typeql
# Everything whose dates move if $start moves (follows hard dependencies, any depth).
fun downstream($start: deal-item) -> { deal-item }:
  match
    { hard-dependency (prerequisite: $start, dependent: $next); }
    or { let $mid in downstream($start); hard-dependency (prerequisite: $mid, dependent: $next); };
  return { $next };

# The same walk, returning each step with its dependency (so the API can read lag-days).
fun impact_edges($start: deal-item) -> { deal-item, hard-dependency, deal-item }:
  match
    { $d isa hard-dependency (prerequisite: $from, dependent: $to); $from is $start; }
    or { let $p, $e, $from in impact_edges($start);
         $d isa hard-dependency (prerequisite: $from, dependent: $to); };
  return { $from, $d, $to };

# Everything that must happen before $end (the "what's blocking completion?" view).
fun upstream($end: deal-item) -> { deal-item }: ...   # mirror of downstream
```

Both were run on the real server; the edge walk also stopped correctly on a dependency cycle.

**Ownership functions.** Two kinds of recursion, on purpose: `group_members` *carries a value* (the
stake, multiplied at each level), while `owners_above` only asks "who can be reached", which is
cycle-safe, so it can be used to detect cycles.

```typeql
# Every company $parent holds, at any depth, with the effective stake along EACH route.
# A company reached by two routes comes back twice: callers sum them (queries.md Q2.6).
# Only correct when ownership has no cycles: always run the guards first (§4).
fun group_members($parent: company) -> { company, decimal }:
  match
    { ownership (owner: $parent, owned: $sub), has stake $s; let $eff = $s; }
    or { let $mid, $m in group_members($parent);
         ownership (owner: $mid, owned: $sub), has stake $s; let $eff = $m * $s; };
  return { $sub, $eff };

# Everyone above $c in the ownership chain (reachability only: safe on cycles).
fun owners_above($c: company) -> { company }:
  match
    { ownership (owner: $o, owned: $c); }
    or { let $mid in owners_above($c); ownership (owner: $o, owned: $mid); };
  return { $o };

# Companies that (indirectly) own themselves. Must always be empty.
fun ownership_cycles() -> { company }:
  match $c isa company; let $o in owners_above($c); $o is $c;
  return { $c };
```

## 6. The schema (TypeQL)

The schema is in [`schema/schema.tql`](../schema/schema.tql) (types, attributes, relations, roles)
and [`schema/functions.tql`](../schema/functions.tql) (the functions in §5). Those files are the source
of truth. This document explains them and doesn't repeat them, so the two can't drift apart.

Changes from the reviewed draft, made in Phase 1:
- `consequence` (string), owned by `obligation`: what happens if it isn't met. Every deadline has one
  (the loader refuses a deadline without it).
- `consent-right:obligation` is played by any `obligation`, not only `covenant`, so a consent's
  deadline (the Helix waiver's completion date) can name its grantor.
- `description` is also owned by `transaction`.

### Migration 001 (Phase 6A.2): `schema/migrations/001-phase6-foundation.tql`

Loaded after the base schema and functions, in number order (`apex/database.py`); applied files are
never edited.
- **Work:** `activity sub deal-item` (work with a duration); `actual-start-date` on every item.
- **Parties:** `email @unique` and `phone @unique` on `person` (fictional values; never returned by the
  API); `registrar sub professional-services-firm`; `description` on `ownership` (why a holding exists).
- **Activity history:** `deal-event` owns a `code @key` and splits into
  - `engagement` (things a party does): `response`, `meeting` (attendees), `delivery`, `decision`;
  - `outreach` (things sent to parties): `request` (with `response-due-date`), `notice` (`automated`);
  - `status-change` (`previous-status`, `new-status`).
  `reply (original: request, answer: response)` is a relation between two relations, which lets a
  single negation (`not { reply (original: $q); }`) find unanswered requests.
- **Risk register:** `risk` (likelihood, severity, risk-status, mitigation), `risk-ownership` (exactly
  one owner per risk) and `risk-exposure` (the work items it threatens).

Three things TypeDB required that differ from the plan: `engagement` and `outreach` are concrete, not
abstract (an abstract type needs an abstract parent, and `deal-event` is concrete; the loader never
creates them directly); the event type is `notice` because `notification` already names the RACI
"Informed" relation (type names are global); and `recipient` and `attendee` need `@card(0..)` because a
role allows one player per relation by default.

### Migration 002 (Phase 6E): `schema/migrations/002-meeting-agenda.tql`

`meeting relates agenda-item @card(0..)`, played by any `deal-item`: a meeting can name the items it
discussed. A steering meeting's subject is the workstream (oversight); its agenda items are the activities
whose engagement it counts for.

## 7. What this shows that a conventional relational design doesn't

A relational version is entirely possible. The point is what each design makes you build and maintain
yourself. Each claim below is backed by a query the demo runs.

1. **Typed, named relationships are first-class.** In SQL a mandate is a join table with foreign keys;
   what "client" and "adviser" mean lives in column names and developers' heads. In TypeDB the roles are
   part of the schema, enforced on write, and visible to anyone exploring the data (the Relationship
   Explorer's legend is generated from the schema, not hard-coded).
2. **Relationships can be about relationships.** RACI assignments point at a mandate (`via`), and
   mandates and financing point at the acquisition. In SQL each "relationship about a relationship"
   needs another surrogate key and join table; in TypeDB a relation simply plays a role.
3. **Three-way (n-ary) relationships are natural.** `mandate` (client, adviser, deal) and
   `authority-review` (reviewer, subject, applicant) are single facts, not pairs of binary links that
   can drift apart.
4. **Inheritance in both data and queries.** One query on `deal-item` returns milestones, workstreams,
   clearances and covenants, each with its own fields (`fetch { $x.* }`) and its exact type. SQL needs
   either one wide table full of NULLs, a table per type stitched together with `UNION`, or an EAV layer.
5. **Polymorphic roles.** `raci-assignment:holder` accepts a person or a firm. SQL needs two nullable
   foreign keys plus a check constraint, or a generic "party" table with type codes.
6. **Recursion is a saved, named query.** `downstream()` follows dependencies to any depth in the
   database, stops on cycles, and other queries call it like a built-in. `group_members()` walks the
   Atlas group multiplying stakes, and composes with ordinary relations in one query ("consents owed
   anywhere in the group, by whom, to whom, at what effective stake"). SQL needs a recursive CTE
   repeated in each query (or a stored procedure), with its own cycle guard. TypeDB doesn't remove the
   need for that guard when a value is carried (§4), and the demo says so.
7. **Business rules live in the schema.** "One Accountable per item", allowed status values, 0-100
   progress, and "only advisers hold mandates" are rejected by TypeDB itself, whatever program writes
   the data. In SQL most of these need triggers, check constraints or application code.
8. **Meaning-preserving variants.** Hard vs soft dependencies, and the four RACI letters, are subtypes:
   query the parent for "all", a child for "just these". Adding a new kind later (say, `funding-dependency`)
   doesn't change existing queries.
9. **Schema-driven generic views.** Because types and roles come back in query results
   (`$x isa! $t`, `$r links ($role: $p)`), the explorer can draw any relation, including ones added later,
   without new code.

Honest limits to say out loud in the demo: this is a dataset of about a thousand records, so it shows *expressiveness*, not
scale or speed; and a skilled SQL team could build the same screens. The argument is how much less
model-translation code and how many fewer hidden rules there are.

## 8. Verified on the real server (2026-10-26, TypeDB CE 3.14.1)

**Phase 1:** the full schema and functions load on a new database; the seed (471 entities and
relations) loads in about 0.3 s with every count, guard and check passing; 75 automated tests pass.
Recursive queries on the full data take about 2-6 ms (effective ownership with guards about 3.5 ms;
a full 168-day impact projection about 6 ms).

**Planning-stage checks:**

Abstract entity hierarchy; relations playing roles in relations; role specialisation (`as`) with
parent-role queries; relation inheritance (3 levels); `@card` on `plays` (violation rejected);
`@range`, `@values`, `decimal`; recursive stream function and recursive tuple function, including on a
cycle; fetching exact type labels and role labels; `fetch { $x.* }` over an abstract type; `count groupby`;
`sort` + `limit`; role-less neighbourhood (`$r links ($x)`); negation. Not supported: `date + duration`
(works for `datetime`), fetching internal IDs. The spike scripts themselves are not published.

The draft schema in section 6 and the three functions in section 5 (`downstream`, `impact_edges` with
the dependency relation in its tuple, and a scalar `accountable_for` using `return first`) were also
loaded as written into a disposable database, with sample data: `@key` on a relation-owned `code`
works, `impact_edges` returned each step with its `lag-days`, and putting one item into two workstreams
was rejected ([CNT5]).

Ownership additions (same day, a further spike): the schema additions and all three ownership
functions load; on the Atlas group in dataset.md, effective stakes came out exactly as computed by hand
(Atlas IP Holdings 0.9 via 2 routes, the JV 0.6 via 1); both guards returned nothing on clean data and
**both fired** after injecting a 5% cross-holding (cycle reported at ORG-ATL, ORG-ATL-UK, ORG-ATL-US)
and a 120% over-ownership; the change-of-control query found both consents with their grantors; and
`downstream(CP-CMA)` reached the JV's obligation. The three Overview data-quality checks (queries.md
Q1.8) each returned exactly the planted problem. Note found along the way: a relation inserted with
no role players is silently dropped at commit, so the loader checks counts for relations too.
