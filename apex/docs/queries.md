# TypeQL queries for the three screens

All screen queries run in **READ transactions**. They live in one backend module (`apex/queries.py`),
and every API response includes the TypeQL that produced it, so the demo can show the query behind
any panel ("Show TypeQL"). Codes such as `CP-CMA` are the `@key` identifiers from
[dataset.md](dataset.md). Patterns marked ✓ were run on the real server on 2026-10-26; the rest use
the same constructs and get tests in Phase 2-4.

**Implemented in Phase 1** (`apex/queries.py`, tested): Q1.8 (data-quality checks), Q2.6-Q2.8
(effective ownership and its guards), Q2.10 (group consents) and the Impact inputs. The Impact inputs
are slightly simpler than Q3.1-Q3.3 below: `impact_edges` plus one query for all items' dates and one
for all deadline limits, filtered in the API. The rest are implemented with their screens in Phases 2-4.

**Implemented in Phase 2** (`apex/queries.py`, tested in `tests/test_api.py`): Q1.1-Q1.7, served by
`apex/api.py`: `/api/deal` (Q1.1, conditions, headline progress, committed financing, next deadline),
`/api/milestones` (Q1.3 plus deadlines), `/api/approvals` (Q1.5), `/api/activity` (Q1.6),
`/api/parties` (Q1.2), `/api/progress` (Q1.4), `/api/raci` (Q1.7), `/api/checks` (Q1.8) and
`/api/ownership` (Q2.6-Q2.10, guarded). The exact text of each is in `apex/queries.py`. The versions below
are the designs, and differ in small ways: the deal is found as "the one acquisition" rather than by code;
an approval's authorities are a sub-query, so a clearance with no authority still appears (demo step T2);
counts use `reduce ... groupby` followed by `fetch`. Every API response lists the queries that actually
ran, in order, parameters included.

**Implemented in Phase 3** (`apex/queries.py`, tested in `tests/test_explorer.py`): Q2.1 as
`ORGANISATION_RELATIONS` (every relation with an organisation among its players, all players and roles;
the frontend draws those linking two or more organisations), Q2.2 as `PARTY_TYPES` + `ORGANISATIONS`
(types come from the schema with `$t sub! $parent`), relation types and roles with
`match relation $r; $r relates $role;`, Q2.3/Q2.5 as `party()` (one party, its relations with every other
player, its people and RACI letters), and Q2.9 as `ownership_edges()`. Group membership for the layout uses
the reachability function `owners_above` (safe even with cycles), never the value-carrying one. Q2.4
(connection paths) is not implemented yet.

**Implemented in Phase 4** (`apex/queries.py`, `apex/impact.py`; tested in `tests/test_impact_api.py`):
Q3.1 as `impact_edges()` (the recursive function), Q3.4 as `ALL_DEPENDENCIES` plus `HARD_DEPENDENCY_KINDS`
(`match $k sub hard-dependency;`), Q3.5 as `impact_raci_query()` (RACI on the start item, on everything
`downstream($start)` returns, and on the deadlines limiting those items, in one query with `or` branches,
de-duplicated in the API), Q3.6 through the guarded `group_consents()`. Served by `GET /api/impact`.

**No business data or logic in the frontend.** Every number, list, label, status, warning and
effective stake on screen comes from these queries via the API. The frontend only lays out and
formats what it is given: no hard-coded parties, dates, thresholds or ownership figures. The only
calculation outside TypeQL is date shifting in `apex/impact.py` (backend, unit-tested), and its
inputs all come from TypeDB.

Where a query takes user input (a code, a number of days), the backend validates it against a fixed
pattern (codes: `^[A-Z]{2,4}-[A-Z0-9-]+$`; days: integer 0-365) and inserts it with the `string()`
helper, never raw.

## 1. Deal Overview

**Q1.1 Deal summary** (one document)
```typeql
match $d isa acquisition (acquirer: $buyer, target: $target), has code "DEAL-APEX";
fetch {
  "deal": { $d.* },
  "acquirer": { $buyer.* },
  "target": { $target.* }
};
```

**Q1.2 Participants, grouped by role in the deal** (who advises whom, and lenders)
```typeql
match $deal isa acquisition, has code "DEAL-APEX";
      $m isa mandate (client: $client, adviser: $adviser, engagement: $deal);
      $adviser isa! $kind;
fetch {
  "client": $client.name, "adviser": $adviser.name, "adviser type": $kind,
  "mandate": $m.mandate-type,
  "deal team": [ match employment (employee: $p, employer: $adviser), has job-title $t;
                 raci-assignment (holder: $p);
                 select $p, $t; distinct;
                 fetch { "name": $p.name, "title": $t }; ]
};
```
"Deal team" = the firm's people who hold any RACI letter on this deal: one query on the parent type
covers all four letters. (Avoid `or` here: `distinct` doesn't de-duplicate after `or` in 3.14.1.)

**Q1.3 Milestones timeline** ✓ (pattern; still served by `/api/milestones`, no longer drawn on the Overview since Phase 6B)
```typeql
match $deal isa acquisition, has code "DEAL-APEX"; deal-scope (deal: $deal, item: $m);
      $m isa milestone, has due-date $due;
sort $due asc;
fetch { "milestone": { $m.* }, "accountable": [ match accountability (holder: $p, accountable-item: $m); fetch { "name": $p.name }; ] };
```

**Q1.9 Deal schedule (the Gantt chart, `/api/schedule`, Phase 6B).** No new TypeQL: it reuses `all_items`
(every deal-item's attributes, exact type and workstream), Q1.4, `all_dependencies`, `hard_dependency_kinds`
(`match $k sub hard-dependency;`, so "moves dates" comes from the schema) and `all_deadline_limits`, plus the
acquisition's `as-of-date`. The API only groups items by workstream and orders them by date; an item with a
`planned-start` is a bar, a deadline is a line, anything else is a milestone.

**Q1.10 Item detail (`/api/items/{code}`, `queries.item_detail_query`).** One `fetch` with ten subqueries:
the item's own attributes and exact type; its workstream; its RACI assignments, with the letter taken from
the relation's exact type and the adviser's mandate from `$r links (via: $m)`; dependencies in both
directions, with their exact kind and lag; deadline limits in both directions; who is bound and whose
consent is needed; its events; and the risks exposing it. About 12 ms on the full data.
```typeql
match $x isa deal-item, has code "CP-CMA"; $x isa! $t;
fetch { "item": { $x.* }, "type": $t,
  "raci": [ match $r isa raci-assignment (holder: $h, item: $x); $r isa! $l; ... ],
  "depends on": [ match $d isa dependency (prerequisite: $a, dependent: $x); $d isa! $k; ... ],
  "limited by": [ match deadline-limit (limited-item: $x, deadline: $dl); ... ],
  "events": [ match $e isa deal-event (subject: $x, actor: $who), has occurred-at $at; ... ],
  "risks": [ match risk-exposure (risk: $k, exposed: $x); $k isa risk; ... ] };
```
The full query is in `apex/queries.py`; the panel's "Show TypeQL" drawer shows it as it ran.

**Q1.4 Progress by workstream** ✓ (`count groupby` pattern)
```typeql
match $ws isa workstream; work-breakdown (whole: $ws, part: $i); $i has status $s; $ws has code $w;
reduce $n = count groupby $w, $s;
```
Headline progress (since Phase 6A.2, decision D5) is no longer a TypeQL `mean`. The query fetches every
item's `planned-start`, `due-date`, `status` and `progress` (`all_items`), and `apex/progress.py`
computes duration-weighted activity completion and milestone readiness, because TypeQL can't subtract
dates. The same calculation gives each workstream's figure on `/api/progress`.

Party detail (Relationship Explorer) excludes activity events with `not { $r isa deal-event; };`: the
event history is for the Parties page, not a list of relationships.

**Q1.5 Regulatory approvals**
```typeql
match $c isa regulatory-clearance;
      authority-review (reviewer: $auth, subject: $c, applicant: $app), has legal-basis $law, has review-phase $ph;
fetch { "clearance": { $c.* }, "authority": $auth.name, "applicant": $app.name, "law": $law, "phase": $ph };
```

**Q1.6 Recent activity** ✓ (`sort` + `limit` pattern)
```typeql
match $e isa deal-event (actor: $who, subject: $what), has occurred-at $t;
sort $t desc; limit 10;
fetch { "when": $t, "summary": $e.summary, "kind": $e.event-kind, "who": $who.name, "item": $what.code };
```

**Q1.7 Compact RACI matrix** (rows = items, columns = parties, cell = letter) ✓ (pattern)
```typeql
match $r isa raci-assignment (holder: $h, item: $i); $r isa! $letter;
      $h isa! $htype; work-breakdown (whole: $ws, part: $i); $ws has code "WS-REG";
fetch { "item": $i.code, "holder": $h.code, "holder type": $htype, "letter": $letter };
```
The letter comes from the relation's own type (`responsibility` → R, `accountability` → A, ...). The
matrix is filtered by workstream, so it stays compact (about 6 rows × 8 columns).

**Q1.8 "Attention needed": three data-quality checks** ✓ (each run on the real server and found
exactly the problem planted for it). Shown as a card with a count per check and the items behind it.
On the clean seed data all three are expected to return **nothing** (a test asserts this), so the card
reads "All checks passed". The demo can show a check firing in Studio on a disposable copy
(demo-script.md).

```typeql
# (a) Work items with no Accountable owner
match $x isa deal-item, has code $c; not { accountability (accountable-item: $x); };
fetch { "item": { $x.* } };

# (b) Overdue: due before the deal's "today" and not complete
match $d isa acquisition, has code "DEAL-APEX", has as-of-date $today;
      $x isa deal-item, has due-date $due; $due < $today;
      not { $x has status "complete"; };
fetch { "item": { $x.* } };

# (c) Regulatory clearances with no reviewing authority recorded
match $x isa regulatory-clearance; not { authority-review (subject: $x, reviewer: $r); };
fetch { "item": { $x.* } };
```

## 2. Relationship Explorer

**Q2.1 Whole network: every relation between parties, with role names** ✓ (pattern)
```typeql
match $r isa! $rtype; $r links ($role1: $a), links ($role2: $b);
      $a isa party; $b isa party; $a has code $ac; $b has code $bc; $ac < $bc;
      not { $r isa raci-assignment; };
fetch { "relation": $rtype, "from": $ac, "from role": $role1, "to": $bc, "to role": $role2 };
```
Generic: it draws any relation type (employment, mandate, acquisition, financing, authority-review),
including types added later. `$ac < $bc` stops each pair appearing twice. Relations that connect to a
*relation* (a mandate's `engagement`, RACI `via`) are drawn as hub nodes.

**Q2.2 Nodes with their exact type and parent type** ✓ (pattern)
```typeql
match $p isa party; $p isa! $t; $t sub! $parent;
fetch { "node": { $p.* }, "type": $t, "parent type": $parent };
```
Drives colours, the legend, and the type filter (e.g. tick "professional services" to see all four
firm types at once).

**Q2.3 Focus on one node: all neighbours, any relation** ✓ (role-less `links` pattern)
```typeql
match $x isa party, has code "ORG-BWM"; $r links ($x); $r links ($y); not { $y is $x; }; $r isa! $rt;
fetch { "via": $rt, "neighbour": { $y.* } };
```

**Q2.4 How are two parties connected?** (all 1- and 2-step paths, as in the cyber-intel project)
```typeql
match $a isa party, has code "PER-OKAFOR"; $b isa party, has code "ORG-CMA";
      $r1 links ($a), links ($mid); $r2 links ($mid), links ($b);
      not { $mid is $a; }; not { $mid is $b; }; not { $r1 is $r2; };
      $r1 isa! $t1; $r2 isa! $t2;
fetch { "first step": $t1, "via": { $mid.* }, "second step": $t2 };
```
Run alongside the 1-step version (`$r links ($a), links ($b);`) rather than combined with `or`, for the
same `distinct` reason. Example answer: Okafor → *employment* → Novacore → *authority-review* (applicant)
→ CMA. Paths through relations (a person → RACI → item → review → CMA) are 3 steps and use the item as
the middle node.

**Q2.5 A person's responsibilities, with the mandate they hold them through**
```typeql
match $p isa person, has code "PER-AINSWORTH"; $r isa raci-assignment (holder: $p, item: $i); $r isa! $l;
fetch { "item": { $i.* }, "letter": $l,
        "through": [ match $r links (via: $m); $m links (client: $c); fetch { "mandate": $m.mandate-type, "client": $c.name }; ] };
```

### Atlas group structure (a view mode in the Relationship Explorer)

**Q2.6 Effective ownership: what exactly is Novacore buying?** ✓
```typeql
match $p isa company, has code "ORG-ATL"; let $c, $e in group_members($p);
reduce $effective = sum($e), $routes = count groupby $c;
match $c has code $code, has name $name;
fetch { "company": $code, "name": $name, "effective stake": $effective, "routes": $routes };
```
`group_members` returns one row per route; `sum` adds the routes and `count` says how many there were,
so the screen can explain "90% = 70% via Atlas Biopharma (UK) + 20% via Atlas Therapeutics Inc".
Result on the seed data (verified): five subsidiaries at 100% (1 route each), Helix Atlas
Manufacturing at 60% (1 route), Atlas IP Holdings at **90% (2 routes)**.

**Q2.7 Guard: ownership cycles** ✓ and **Q2.8 Guard: companies owned more than 100%** ✓
```typeql
match let $c in ownership_cycles(); $c has code $code; select $code; distinct;

match ownership (owned: $c), has stake $s; reduce $total = sum($s) groupby $c;
match $total > 1.0dec; $c has code $code;
fetch { "company": $code, "total direct stakes": $total };
```
The `/api/ownership` endpoint runs Q2.7 and Q2.8 first, **in the same READ transaction**, and only
runs Q2.6 if both are empty. Otherwise it returns an error naming the companies and no figures. (Both
fired correctly when a cycle and a 120% case were injected.)

**Q2.9 Ownership edges for the group tree** (direct stakes, drawn as labelled arrows)
```typeql
match $p isa company, has code "ORG-ATL"; let $c, $e in group_members($p);
      $o isa ownership (owner: $owner, owned: $c), has stake $s;
select $o, $owner, $c, $s; distinct;
fetch { "owner": $owner.code, "owned": $c.code, "stake": $s };
```
`distinct` is needed because a company reached by two routes (Atlas IP Holdings) would otherwise list
its incoming edges twice (verified: without it, the 70% edge appeared twice).
Includes outside shareholders of group companies (Helix's 40% of the JV, Calder's 10% of the IP
company), so the tree shows who else has a say.

**Q2.10 Change-of-control consents anywhere in the Atlas group** ✓
```typeql
match $p isa company, has code "ORG-ATL"; let $c, $e in group_members($p);
      bound-by (obligor: $c, obligation: $o);
      consent-right (grantor: $g, obligation: $o);
reduce $effective = sum($e) groupby $o, $c, $g;
match $o has code $oc; $c has code $cc; $g has code $gc;
fetch { "obligation": $oc, "owed by": $cc, "consent from": $gc, "Atlas effective stake": $effective };
```
One query combining the recursive group walk with two ordinary relations. Answer on the seed data
(tested): the Calder licence consent (owed by Atlas IP Holdings at 90%, consent from Calder), plus the
Helix waiver and its completion deadline (owed by Atlas Biologics Ireland at 100%, which holds the
JV's 60%, consent from Helix). Implemented as `group_consents()` in `apex/queries.py`, guarded like Q2.6.

## 2b. Workstreams (Phase 6C, `/api/workstreams`, `/api/workstreams/{code}`)

All in `apex/queries.py`; the list reuses `all_items` and Q1.4, and adds:
- **Events** (`workstream_events_query`): every `deal-event` on the workstream's items (polymorphic: requests,
  responses, meetings, deliveries, decisions, notices, status changes) with `$e links (recipient: $r)`,
  `$e links (attendee: $r)` and `reply (original: $e, answer: $a)`, a relation between two events.
- **Deadlines in reach** (`deadlines_in_reach_query`): for each open item, `{ $x is $i; } or { let $x in downstream($i); }`
  then `deadline-limit (limited-item: $x, deadline: $dl)`. Rows are de-duplicated in the API.
- **Risks** through `risk-exposure` and `risk-ownership`; **organisations** through RACI and `employment`
  (written with the RACI pattern inside each `or` branch: the `is` form hits a TypeDB 3.14.1 planner bug, QPL1).
- **Open prerequisites at any depth** (`open_prerequisites_query`): `let $u in upstream($i); not { $u has status "complete"; };`.
- **Obligations** through the abstract parent `obligation`, with `bound-by`, `consent-right` and `deadline-limit`.

Each section of the detail page shows only its own queries in "Show TypeQL" (the API reports capabilities
query by query), so a section is never labelled with a capability another section's query uses.

## 2c. Parties (Phase 6D, `/api/register`, `/api/parties/{code}`)

- `PEOPLE` and `ORGANISATION_PARTIES` (with `$o isa authority` to choose the statutory profile), `ALL_RACI`
  (letter from the relation's exact type, mandate from `$r links (via: $m)`), every event (as on Workstreams),
  `AUTHORITY_REVIEWS`, and `match $t sub engagement;` / `match $t sub outreach;`: what counts as engagement is
  read from the schema's hierarchy, not written in code.
- `CONTACTS` is the only query that reads `email` and `phone`; the values are masked in the API before any
  response is built, and "Show TypeQL" shows the query, never the values.
- Schedule float uses the dependency and deadline-limit queries above and the Impact Explorer's own projection
  (`impact.breach_from_days`); the engagement rules themselves are TypeScript over these records (`api/src/engagement.ts`).

## 2d. Connections (Phase 6E, `/api/connections`)

Met in the middle, in three readable queries (`apex/queries.py`):
```typeql
# Everything one relation away from an end, entities only, with the relation's exact type
match $a has code "PER-AINSWORTH"; $r links ($a, $m); $m isa $mt, has code $mc; entity $mt; $r isa! $t;
      not { $m is $a; }; not { $r isa work-breakdown; };
select $r, $t, $mc; distinct;
# For three steps: the relations joining a neighbour of one end to a neighbour of the other
match $m has code $mc; $mc like "^(ORG-BWM|...)$"; $r links ($m, $n); $n has code $nc; $nc like "^(ORG-NOV|...)$";
      $r isa! $t; not { $r isa deal-event; }; not { $r isa work-breakdown; };
select $r, $t, $mc, $nc; distinct; limit 2000;
```
One- and two-step paths come from the two neighbour sets; the API checks simple paths (no thing or relation
twice), ranks them (config/connection-policy.yaml) and re-reads the relations on the best paths by iid
(`$r iid 0x...; $r links ($role: $p);`) to state each step in words. `isa entity` is a reserved word in
TypeQL; the kind statement `entity $t;` is used instead.

## 3. Impact Explorer

User picks an item (default: `CP-CMA`, the CMA clearance) and a delay in days.

**Q3.1 All downstream steps, with lag** ✓ (run on the real server)
```typeql
match $start isa deal-item, has code "CP-CMA";
      let $from, $dep, $to in impact_edges($start);
      $to isa! $kind; $dep isa! $dkind;
fetch { "from": $from.code, "to": $to.code, "to type": $kind,
        "lag": $dep.lag-days, "dependency": $dkind };          # gating or sequencing
```

**Q3.2 Dates and status of affected items** (one query for the set returned by Q3.1)
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start);
fetch { "item": { $x.* } };
```

**Q3.3 Deadlines that limit any affected item**
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start);
      deadline-limit (limited-item: $x, deadline: $dl);
      bound-by (obligor: $who, obligation: $dl);
fetch { "item": $x.code, "deadline": { $dl.* }, "binding on": $who.name };
```

**Q3.4 Soft (informing) links from affected items** (shown as "keep informed", not moved)
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start);
      informing (prerequisite: $x, dependent: $y);
fetch { "from": $x.code, "to": { $y.* } };
```

**Q3.5 Who needs to act or know: RACI of every affected item, with organisation** ✓ (pattern)
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start);
      $r isa raci-assignment (holder: $h, item: $x); $r isa! $letter;
fetch { "item": $x.code, "letter": $letter, "holder": { $h.* },
        "organisation": [ match employment (employee: $h, employer: $o); fetch { "name": $o.name }; ] };
```
(The `downstream` set plus the start item is used, via a second query for the start item itself.)

**Q3.6 Deadlines at risk that are owed inside the Atlas group** ✓ (the change-of-control link)
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start);
      deadline-limit (limited-item: $x, deadline: $dl);
      bound-by (obligor: $c, obligation: $dl);
      $atl isa company, has code "ORG-ATL"; let $c, $e in group_members($atl);
      consent-right (grantor: $g, obligation: $dl);
reduce $effective = sum($e) groupby $dl, $x, $c, $g;
match $dl has code $dc; $x has code $xc; $c has code $cc; $g has code $gc;
fetch { "deadline": $dc, "limits": $xc, "owed by": $cc, "consent from": $gc, "Atlas effective stake": $effective };
```
Run on `apex`, it returns DL-HELIX-WAIVER (limits MS-COMPLETION, owed by Atlas Biologics Ireland at
100%, consent from Helix). This is how a CMA delay surfaces a contractual risk two levels down the
group. Completion moves, and if it passes 31 Jan 2027 the Helix waiver lapses, so Helix may buy the
60% of the JV that makes the lead product. Whether it is breached comes from the date projection
below; the deadline's `consequence` says what happens. Like Q2.6, it runs only after the ownership
guards pass.

**Date propagation (in the API, not TypeQL).** The backend takes Q3.1's edges and Q3.2's dates and computes
each item's new date: `new(item) = max(planned(item), max over prerequisites of new(prereq) + lag)`.
This is a longest-path calculation over the dependency graph, which is simple and testable in TypeScript and
awkward in any query language. It is plain arithmetic over data TypeDB returned; the UI labels the result
"projected" and links each projected date to the chain of dependencies that caused it. A deadline is
"breached" when a limited item's projected date is after the deadline's date.

**Read-only.** The scenario is never written to the database in v1: the same query with a different
number of days gives a new picture, and the "real" plan is never touched.
