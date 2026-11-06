# Project Apex: Phase 6 expansion plan (for approval)

Status: **approved 2026-10-27 (D1–D14), with three adjustments recorded in §12. Phase 6A.2 approved; Phase 6E approved; Phase 6F complete (§20), awaiting review before the open-source release phase.** Earlier revision: after the owner's provisional approval (architecture, sequence and 6A.2 accepted; five adjustments applied: sizes indicative, a separate regulator policy, calculated criticality, contact preview non-functional, bounded path ranking instead of hub exclusion). Baseline: commit `5de7970` (Phases 1–5 complete, 130 tests). §1–§11
describe the plan as approved; what was actually built in 6A.2, and where it differs, is in §13.

Evidence for every finding below came from the repository, the seed data and the running TypeDB 3.14.1
server at the baseline commit.

---

## 1. Gap analysis

### 1.1 What already exists and can be reused

| Capability | Where | Reuse for |
|---|---|---|
| Typed schema: party and deal-item hierarchies, n-ary relations, role specialisation, `@card`/`@range`/`@values`/`@key` | `schema/schema.tql` | Every new page; new types slot in as subtypes |
| Contextual RACI: one relation **per person per item**, 4 subtypes, `via` mandate | `raci-assignment` (179 today) | Workstreams "People and RACI", Parties register, engagement risk. Already contextual: no change needed |
| Recursive functions: `downstream`, `upstream`, `impact_edges`, `group_members`, `owners_above`, `ownership_cycles` | `schema/functions.tql` | Finding what each deadline depends on (input to the schedule-float calculation in §5.4); Gantt dependency indicators |
| Activity log as a relation: `deal-event (actor, subject)` with time, kind, summary | 20 events | The base type of the richer activity history (§3.3) |
| Work items with `planned-start`, `due-date`, `baseline-due-date`, `completed-date`, `progress`, `status`, `criticality` | `deal-item` | Gantt bars. **The attributes exist; the data mostly doesn't** (§1.2) |
| Read-only API with recorded TypeQL, health checks, reconnect, guards, typed models → TypeScript | `apex/api.py`, `db.py`, `models.py` | Every new endpoint, unchanged pattern |
| Seed loader: validate → one transaction → count and check → commit | `apex/seed.py` | Expanded dataset; validator gains new rules |
| Independent oracle tests | `tests/oracle.py` | New answer keys (engagement risk, Gantt dates, paths) |
| UI: page header, segmented switch, panels, status badges, TypeQL drawer, React Flow + ELK canvas, detail-panel pattern, before/after timeline | `web/src/components/*` | Gantt (grows out of the before/after timeline), shared detail panels |

### 1.2 What is missing (measured on the seed data)

| Brief needs | Today | Gap |
|---|---|---|
| Gantt bars (start → end) | Only **6 of 34** items have `planned-start`; the rest are single dates. No "activity" with a duration as distinct from a milestone | New duration-bearing activities, with start dates; milestones stay as points (§3.1) |
| Workstream descriptions | **0 of 7** workstreams have a description | Data only |
| Activity history that explains status | **20 events**; **15 of 24 people never appear**; 4 of 7 workstreams have ≤2 events | Expanded, structured history (§3.3) |
| Meaningful responses vs outbound or automated messages | Not modelled | Event subtypes plus a request → response link (§3.3) |
| Contact details | Not modelled | Person attributes, masked server-side (§6) |
| Engagement risk | Not modelled | Python policy over TypeDB records, with a config file (§5) |
| Risk register ("relevant risks") | Only implicit (at-risk status, deadline headroom) | Recommended: explicit risk records (§3.4) |
| Connection paths | Not built (deferred in Phase 3) | Fixed-depth TypeQL traversal (§7) |
| Five-area navigation, stable deep links | 3 areas; links exist for Impact (`?days=`) and Explorer (`?view=`) | New routes `/workstreams/:code`, `/parties/:code`; links between them all (§8) |
| Schema migrations | The Phase 1 rule says new numbered files in `schema/migrations/`, but **no mechanism exists** (`create_schema` loads two files) | Small loader change (essential, §3.6) |

---

## 2. Transaction and ownership realism review

Approached as a UK public-company M&A adviser would review a case study. This is not legal advice.
Items marked *(check)* should be confirmed by a practitioner before external use.

### 2.1 What is already coherent (keep)
- **Structure and approvals:** a recommended cash offer by scheme of arrangement; Court Meeting and
  General Meeting on 7 Sep; sanction then effective on delivery to the Registrar; settlement within 14 days.
  The scheme document went out 28 days after the firm offer (11 Aug), matching Takeover Code Appendix 7.
- **Regulatory set and order:** HSR (FTC and DOJ), NSI Act, EU Phase 1, CMA Phase 1, all gating the court
  sanction. The statutory periods match the dates in the data.
- **Financing:** £1.8bn bridge across two lenders plus £0.6bn cash. Cash confirmation by the lead
  financial adviser. A "certain funds" period ending 30 days after the long-stop. Refinancing 12 months
  after drawdown. All coherent.
- **Change of control:** Calder's licence consent (given) and Helix's JV call option waived on a condition.
  Both are typical. The Helix scenario remains credible with the approved conditional wording.

### 2.2 Recommended corrections and additions (each small, each with a purpose)

| # | Finding | Proposal | Class |
|---|---|---|---|
| R1 | **No court convening hearing.** In a scheme, the court orders the shareholder meetings at a convening hearing shortly after the firm offer announcement and before the scheme document goes out. | Add milestone "Court convening hearing" (Aug 2026), gating the scheme document | Essential |
| R2 | **CMA Phase 1 has no internal steps**, so its "at risk" status rests on one call. | Add: pre-notification (from Jul), formal start, issues letter, response to the issues letter, issues meeting, decision due. Dates illustrative *(check)*. A possible remedies stage (undertakings in lieu of a Phase 2 reference) appears only as a risk, not as fact. | Essential (explains the status) |
| R3 | **Pre-notification is invisible for the CMA and EC.** In practice it takes weeks before the formal clock starts. | Add pre-notification activities for both | Recommended |
| R4 | **No corporate brokers or registrar.** UK listed companies have brokers; a scheme needs a registrar or receiving agent. | Add 3 fictional organisations (a broker each side, a registrar), with a few people and RACI | Recommended |
| R5 | **Pensions are absent.** UK public-to-private deals often involve the target's defined-benefit pension trustees. | Optional: a trustee body and one engagement activity. Otherwise disclose as a simplification | Optional |
| R6 | **Deadlines carry status "in progress"**, which reads oddly. | Leave the stored status; the UI shows deadlines as markers ("open / met / breached") | Recommended (UI only) |
| R7 | **Stored workstream progress can disagree with its items** (Regulatory 80% while the CMA is at 60%). | Derive workstream progress in TypeQL (`reduce mean` over its items) and stop storing it, or keep it stored and add a consistency test | Decision D5 |

**Simplifications to disclose (in the app and in docs):** no competing bidder, no put-up-or-shut-up period,
no tax structuring workstream, no employee share plans, calendar-day lags, one CMA review path,
illustrative CMA step dates, and no named individuals at real authorities (see D7).

### 2.3 Corporate ownership

| Question | Finding |
|---|---|
| Why two paths to Atlas IP Holdings? | Coherent if explained: the UK operating company holds 70%; the US subsidiary holds 20%, issued when it contributed US-origin patents; Calder holds 10% as spin-out equity for licensing the founding patents. **Proposal:** record these reasons as descriptions on the holdings (data only). |
| Is the remaining 10% accounted for? | Yes: Calder holds it. Every subsidiary's direct holdings add up to exactly 100%, a rule the loader already checks (over-100% is refused). |
| Legal vs economic | The data holds **direct legal shareholdings**; the app calculates **effective economic interest**. **Proposal:** use those two labels everywhere ("Effective stake" becomes "Effective economic interest") and explain the difference in the group view. |
| Voting control vs economic interest | Not modelled today; all shares are treated alike. **Proposal (optional, spike first):** add an optional `voting-share` to ownership and a "control" view: a company counts as controlled when the parent and its controlled subsidiaries together hold more than 50% of the votes. Atlas IP Holdings would then be **controlled** (70% held directly) while its economic interest is 90%. Whether TypeDB can express this recursion is unverified; if it can't, the view is dropped rather than moved into Python. |
| Minority rights | Real but not recorded. **Proposal:** record Calder's reserved-matter consents at Atlas IP Holdings, and Helix's reserved matters and board seat at the JV, as **covenants with consent rights** using existing types (data only). This deepens the change-of-control story. |
| Guards and claims | Keep the cycle and over-100% guards and the route cross-check unchanged. Docs and UI already say the method assumes no cross-shareholdings and is **not** a general-purpose beneficial-ownership engine; that wording stays. |

---

## 3. Proposed schema and dataset expansion

All schema changes go in new files under `schema/migrations/`; the Phase 1 files are never edited.
Existing queries keep working because the changes only add subtypes and optional attributes.

### 3.1 Gantt dates (essential)
- **S1 `activity sub deal-item`:** work with a duration (for example "Prepare CMA briefing paper"), as
  distinct from `milestone` (a point in time). Both stay deal-items, so dependencies, RACI, events and the
  Impact Explorer apply to activities unchanged.
- **S2 attribute `actual-start-date`** (optional, on deal-item): bars start at the actual start if one is
  recorded, otherwise the planned start.
- **Bar rules (no invented durations):**
  - an item with a `planned-start` is drawn as a bar from its start to its `due-date`, or to its
    `completed-date` once complete;
  - an item without a start is drawn as a milestone (a diamond);
  - deadlines are vertical markers;
  - `baseline-due-date` is shown as a thin slippage line where it differs from the due date.
- Every new activity gets a start date justified by the timetable (for example, pre-notification
  beginning after the firm offer); the loader rejects a start after the due date.

### 3.2 Workstreams (data only)
Descriptions for all 7 workstreams. Lead = the Accountable on the workstream (exists). Participating
organisations, outstanding items, next milestone and latest event are all derived by query. No new types.

### 3.3 Activity history and engagement (essential)
**S3. A type hierarchy under the existing `deal-event`.** All current queries on `deal-event` see every
subtype automatically:

```
deal-event (actor, subject; occurred-at, summary, event-kind)       existing: unchanged
├── engagement @abstract           counts as a meaningful response for engagement risk
│   ├── response          answers a request
│   ├── meeting           relates attendee (person or organisation)
│   ├── delivery          a deliverable submitted (report, filing, draft)
│   └── decision          an approval, sign-off or signature
├── outreach @abstract             does NOT count as engagement by the recipient
│   ├── request           relates recipient; owns response-due-date (optional); may be answered
│   └── notification      relates recipient; owns `automated` (boolean)
└── status-change         owns previous-status, new-status
reply (request: request, response: response)        a relation between two relations
```

- **Chronology rule (loader):** a response is never earlier than the request it answers.
- **Expected responses:** a request may carry a `response-due-date` (for example a CMA information
  request, or a question the deal team put to an authority). An unanswered request past that date is an
  **overdue obligation**, which the engagement policy treats as a risk in its own right (§5.3).
- The 20 existing events are reclassified (for example "filed" becomes `delivery` and "status-change"
  becomes `status-change`). Their text is unchanged.

**S4. Contact details:** `email` and `phone` attributes on person (§6).

### 3.4 Risk register (recommended)
**S5. `risk` entity** (code, name, description, likelihood, impact, status, mitigation), with:
- `risk-exposure (risk, exposed: deal-item)`;
- risk ownership through RACI (risk plays `raci-assignment:item`).

This gives Workstreams "Key risks" real records, and keeps delivery risk separate from engagement risk.
Example: "CMA may reject the remedy package; owner Okafor; mitigation: prepare a Phase 2 timetable".

### 3.5 Dataset expansion (indicative sizes, not targets)

Sizes below are **estimates of what the screens' requirements imply, not targets**. Realistic,
interconnected records take priority over volume: if a workstream's story is complete with fewer records,
it gets fewer.

| Record type | Now | Indicative | Purpose |
|---|---|---|---|
| Workstreams | 7 | 7 (8 with R5) | Descriptions added |
| Work items | 34 | ~110 | ~75 activities giving each workstream a believable plan (pre-notification, drafting, diligence follow-ups, Day-1 readiness tasks) |
| Organisations | 27 | ~31 | Brokers and registrar (R4); trustee body (R5) |
| People | 24 | ~50 | Fuller adviser and principal teams; **no named people at real authorities** (D7) |
| RACI assignments | 179 | ~500 | Every new item gets exactly one A, plus plausible R/C/I |
| Events | 20 | ~250 | A coherent story per workstream: requests, responses, meetings, deliveries, decisions, automated notices, status changes |
| Dependencies | 30 | ~100 | Activity-level, including cross-workstream; hard and soft |
| Risks | 0 | ~15 | Recommended (S5) |
| Total records | 471 | roughly 1,500–2,000 | Still small: expressiveness, not scale |

**Authoring:** hand-written YAML, split into one file per workstream for maintainability. Nothing is
randomly generated. The validator gains rules for:
- start ≤ due;
- responses after their requests;
- events only by people involved in that workstream;
- every activity on a workstream timeline;
- every person with a role.

**Impact answer key (D10):** the four validated outcomes stay exactly as they are (61, 120, 136 and 168
days, the same breaches and the same days over). New activities after completion will raise the count
of "items that move", and those counts will be re-baselined openly.

### 3.6 Migrations mechanism (essential, small)
`create_schema` loads `schema.tql`, then `functions.tql`, then `schema/migrations/*.tql` in number order.
Every database is rebuilt from source (`--replace`, `reset_demo`), so no upgrade-in-place is needed. A test
loads each migration on a fresh database.

---

## 4. Gantt implementation approach

- **One endpoint, one component:** `GET /api/schedule` returns workstreams, their items (start, end,
  status, progress, kind), dependencies, deadlines and the scenario as-of date. The Overview and the
  Workstreams page both draw it with the same `<Gantt>` component; there is no second timeline dataset.
- **Built without a new dependency:** HTML/SVG, grown from the existing before-and-after timeline. Gantt
  libraries add weight, licensing questions and styling conflicts.
  - Rows: a sticky left column per workstream, collapsible to activity rows.
  - Bars: coloured by status, with progress fill and names inside where they fit.
  - Shapes: diamonds for milestones; red vertical lines for contractual deadlines.
  - Time: a dark vertical line for the **scenario date (26 Oct 2026)**, labelled as the scenario date,
    distinct from today's real date, which appears only in a note. The axis is in months, with weeks when
    zoomed in.
  - Navigation: horizontal scrolling at narrow widths; dependency arrows for the selected item only, to
    avoid clutter.
- **Detail panel (shared):** selecting an item opens one panel, also reused by Workstreams, Parties and
  Impact. It shows:
  - the item's description, workstream, dates, status and progress;
  - its Accountable and Responsible people;
  - its dependencies in and out;
  - its obligations and deadline limits;
  - its latest event;
  - links to its workstream and to "Simulate a delay" in the Impact Explorer.
- **Scenario date everywhere:** every "days since", "due in" and "overdue" uses the acquisition's
  `as-of-date` from TypeDB, never the browser clock. A test enforces this.

---

## 5. Workstreams and Parties architecture

### 5.1 Workstreams
- **Endpoints:**
  - `GET /api/workstreams`: one row per workstream with status, progress, lead, organisations, counts, next
    milestone, upcoming deadlines, risks and latest event;
  - `GET /api/workstreams/{code}`: summary, items, people with RACI per item, and events (newest first,
    including status changes and linked obligations).
- **Queries reuse existing patterns:** `work-breakdown`; RACI on the parent type; `deal-event` (now
  polymorphic); and `upstream` for each item's prerequisites.
- **People and RACI:** a person × item matrix within the workstream, so one person can be R on one item, C
  on another and I on a third, never a single label per person. "Outstanding responsibilities" means A or
  R on items not yet complete. "Engagement status" comes from §5.3.
- **Filters and sorting** (status, progress, deadline, organisation, risk) work on the one answer in the
  browser, as the Explorer filters do.

### 5.2 Parties
- **Endpoints:**
  - `GET /api/people`: the register, with masked contacts and engagement risk;
  - `GET /api/people/{code}`: the profile, with assignments, outstanding items, deadlines, engagement
    history, risk explanation, mandates, organisational relations and links;
  - `GET /api/engagement-policy`: the thresholds in force, for transparency.
- The register uses search, filters and sorting in the browser over one response (about 50 people).

### 5.3 Engagement-risk algorithm (deterministic, Python over TypeDB records)

Policy file `config/engagement-policy.yaml` (D9) is configuration, not business data. It holds two
profiles, the thresholds and the windows below; changing it never touches a business record. Every
calculation uses the scenario's as-of date from TypeDB.

Each **person × assignment** on an **outstanding** item (not complete) is assessed under one profile,
chosen from the holder's type in the schema:

**A. Deal-participant profile** (everyone except authorities):
1. **Overdue obligations first:** if a request addressed to the person (or to their organisation) has
   passed its `response-due-date` unanswered, the assignment is **red**: "Response to '…' overdue by N
   days". If one is due within `response_warning_days` (default 2), it is at least **amber**.
2. **Recency:** days from the person's last **engagement** event (response, meeting attended, delivery or
   decision) on any item in the same workstream, to the scenario date. If there is none in that workstream
   but there is one elsewhere, that one is used, and the explanation says so. If there is none anywhere,
   the result is **Unknown** (grey), never red. Outbound requests and notifications *to* the person don't
   count; automated notifications never count.
3. **Base level** from the letter's thresholds: A/R green 0–3, amber 4–7, red 8+; C 0–7, 8–14, 15+;
   I 0–30, 31–45, 46+.
4. **Criticality escalation** (one step, green to amber or amber to red; red is the ceiling): the item is
   **schedule-critical** (§5.4), or is recorded with criticality "critical", **and** is due within
   `urgent_window_days` (default 14) or recorded as at risk or delayed. The explanation names which
   condition applied.

**B. Authority profile** (regulators and courts, and anyone employed by them). Authorities are assessed
**against their statutory timetable and their commitments, never against silence.** A regulator that
says nothing for 30 days inside a 40-working-day review is behaving normally.
1. **Statutory deadline:** for a review the authority is conducting, the clearance's due date is its
   statutory decision date. Green while more than `statutory_warning_days` (default 10) remain; amber
   within that window with no decision recorded; red once it passes with no decision recorded.
2. **Expected responses:** a request sent *to* the authority with a `response-due-date` (for example a
   question to the case team) follows step A1: red once overdue, amber when due soon.
3. Result labelled **"Statutory timetable"**, so it is never confused with a participant going quiet.
   Requests the authority sends *to* the parties count against the parties' Responsible and
   Accountable people under profile A, not against the authority.

**Combining and explaining (both profiles):**
- **Participant level:** the highest level across assignments. Ties go to the stronger letter, then the
  earlier due date.
- **Explanation:** a sentence built from the inputs, for example "Red: Responsible for 'Response to CMA
  issues letter' (schedule float 60 days to the Helix waiver deadline; due in 6 days); last meaningful
  response 9 days ago on Regulatory (threshold for R: 8+)".
- **Engagement risk vs delivery risk:** shown as two separate columns. Delivery risk means the item is at
  risk, delayed or overdue against the scenario date.
- **Tests:**
  - table-driven checks at every threshold boundary (3/4, 7/8, 14/15, 30/31, 45/46), plus the
    statutory-window and response-due boundaries;
  - escalation (each trigger separately), the authority profile, Unknown, ties, multiple assignments and
    the fallback;
  - an oracle that recomputes everyone's level from the raw YAML.

### 5.4 Schedule criticality: calculated, not assumed

Lying upstream of a deadline doesn't make an item critical: an item with months of slack is upstream of
completion too. Criticality is therefore **calculated as schedule float** and stated as a number:

- **Schedule float of an item** = the largest delay it can absorb before *any* contractual deadline is
  breached. It is found with the same validated projection the Impact Explorer uses: the smallest delay
  that breaches each deadline, minus one, taking the minimum across deadlines. All inputs come from
  TypeDB (the dependency edges via the recursive `impact_edges`, the dates and the deadline limits).
  - An item whose delay reaches no deadline has no float limit: "not schedule-critical".
  - Today the CMA clearance's float is **60 days** (the 61-day Helix threshold, minus one).
- **Schedule-critical** = float at or below `critical_float_days` in the policy (proposed default 30).
  **Near-critical** = float at or below `near_critical_float_days` (proposed 60).
- **Lowest-float path to each deadline:** the chain of items sharing the smallest float into that
  deadline. Shown on the Gantt on request ("Show critical path"), with the binding deadline named.
- **Stored criticality** (the existing `criticality` attribute) is kept as what it is: the deal team's
  judgement of importance. Screens show both, labelled "Assessed criticality" and "Schedule float", and
  never merge them silently.
- **Cost:** a few hundred projections over about 100 dependencies, computed once per request in well
  under a second; tested against an oracle that brute-forces the float over the raw YAML.

## 6. Contact-data handling
- **Fictional values only:**
  - email addresses on reserved `.example` domains (RFC 2606), for example `e.hartley@novacore.example`;
  - UK telephone numbers from Ofcom's drama range (`07700 900000–900999`).

  Neither can ever reach a real person.
- **Masked on the server, always:** the API returns only masked forms (`e•••••y@novacore.example`,
  `07700 900•••`). No endpoint, parameter or error message returns a full value, and the frontend never
  receives one to hide. A test scans every API response and the built bundle for full addresses and numbers.
  "Show TypeQL" shows the query text, never the values.
- **The access-request interaction is a non-functional demonstration.** It opens a panel headed
  **"Demonstration only: no request is sent or stored"**. The panel:
  - explains the three conceptual permission levels: viewing participants, viewing full contact details,
    and administering access;
  - explains that a real implementation needs authenticated identities, server-side authorisation and an
    audit log;
  - has a "Request access" button that is visibly disabled.

  Nothing is written anywhere; the app stays read-only. No wording suggests that masking in a browser is a
  security control.
- **Honest limitation:** anyone with direct database access (Studio) can read the fictional values. The
  database is the trust boundary, and the docs say so.

## 7. Connection-path exploration design

| Aspect | Proposal |
|---|---|
| Entity types | Parties (people and organisations), deal items (activities, milestones, obligations), risks (if D3) and the acquisition itself |
| Representation | Paths alternate **entity → relation → entity**. Each relation step is shown whole, with its type and the two roles used, for example `Blackwood Marsh —adviser→ [mandate MAN-BWM] ←client— Novacore`. The relation's other players are listed as context, so n-ary relations stay intact. |
| Traversal | **Fixed-depth TypeQL**, one query per depth (1, 2, 3 relation hops) using `$r links ($role: $x)`. A recursive function can't return a path, and fixed depths keep each executed query readable in the drawer. |
| Bounds | At most 3 relation hops (4 entities). Each depth query is capped with `limit` (proposed 2,000 raw rows), and the request has a time budget (proposed 500 ms; depth 3 is skipped with a visible note if depths 1–2 already used it). The response says when a cap or budget was hit, so results are never silently partial. |
| Cycles | Simple paths only: distinct entities (`not { $a is $b; }`) and distinct relations in every pattern. |
| No blanket hub exclusion | Every relation type and every organisation can appear in a path, including the acquisition, the principals and busy relations such as `deal-scope` and `deal-event`. Hubs are **ranked down, not removed**, so a useful path through Novacore or the Takeover Panel survives. |
| Ranking | A deterministic cost, lowest first. The cost adds up three things: (1) a base cost per hop, so shorter paths win; (2) for each intermediate entity, a hub penalty that grows with its number of relations (log of degree, counted in TypeDB); (3) a relation-type weight, light for specific facts (mandate, review, ownership, consent, financing, RACI, dependency) and heavier for generic ones (work-breakdown, deal-scope, employment, deal-event). Weights live in the policy file. Ties break by path text, so results are stable. |
| Display | The top 20 paths as cards, each highlighting its route on the graph, plus grouped summaries of the rest ("14 more paths through Project Apex (the acquisition)", which expand on request). A note on every result: "A path shows records that connect these two. It does not imply a legal or commercial relationship beyond what each record states." |
| TypeQL | The exact depth queries that ran (and the degree query used for ranking), as everywhere else |
| Testing | A breadth-first-search oracle over the raw YAML finds every simple path up to 3 hops; the API's paths must be a subset in the oracle's cost order. Cap and budget behaviour, cycle-freedom and deterministic ordering are tested; time is measured on the expanded dataset. |
| Timing | Built in Phase 6E, after the operational pages, so that it covers the expanded data |

## 8. Endpoints, components and navigation

**New endpoints (all GET, READ only):**
- `/api/schedule`
- `/api/items/{code}` (shared item detail)
- `/api/workstreams`
- `/api/workstreams/{code}`
- `/api/people`
- `/api/people/{code}`
- `/api/engagement-policy`
- `/api/connections?from=&to=`

Existing endpoints keep their shapes. `/api/impact` gains links only.

**New shared components:**
- `<Gantt>`
- `<ItemDetail>`
- `<PersonDetail>`
- `<RaciChips>`
- `<RiskBadge>` (always with a text label)
- `<ActivityFeed>`
- `<EntityLink>` (one place that knows the route for each code prefix)

Existing: `StatusBadge`, `TypeQLDrawer`, `PageHeader`, `Segmented` and the detail-panel pattern.

**Routes:**
- `/` (Overview)
- `/workstreams`
- `/workstreams/:code`
- `/parties`
- `/parties/:code`
- `/explorer?focus=:code`
- `/explorer?view=group`
- `/impact?item=:code&days=`

The navigation chain:
1. Overview Gantt → workstream
2. Workstream → item panel
3. Item → person
4. Person → organisation (Explorer focus)
5. Organisation → relationship
6. Item → dependency
7. Dependency → Impact
8. Impact consequence → obligation
9. Obligation → people

**TypeQL explanations:** each drawer can open a short, optional note on what the query shows (for
example "n-ary relation", "recursive function", "polymorphic query on a parent type"). Notes describe the
real query, never a stand-in.

---

## 9. Phased plan with acceptance criteria

I recommend inserting **6A.2 (data foundation)** before the UI phases. It changes the schema and data
once, re-baselines tests once, and lets every later phase build on stable records. This is safer than
growing the data page by page.

| Phase | Builds | Acceptance criteria (each tested) |
|---|---|---|
| **6A.1 Review** (this document) | Assessment, decisions | Approved decisions in §10 |
| **6A.2 Data foundation** | Migrations loader; S1–S4 (S5 if approved); realism fixes R1–R4; expanded YAML; validator rules; seed.tql; answer-key re-baseline | Every migration loads on a fresh database. The expanded seed loads with exact counts, every check passing, and the new validator rules enforced. **The four Impact outcomes are unchanged** (61/120/136/168, same breaches and days over). The existing three screens still work. All tests pass, with each re-baselined number listed and justified. Clean start and `reset_demo` verified. |
| **6B Overview Gantt** | `/api/schedule`, `<Gantt>`, `<ItemDetail>`, `/api/items/{code}` | Every bar and diamond matches TypeDB dates (oracle). Workstreams collapse and expand. Deadlines and the scenario-date line sit on the right dates. The item panel shows everything in §4, with working links. Readable at 1440 px and 1280 px with horizontal scroll. No hardcoded data. |
| **6C Workstreams** | List and detail pages, `<RaciChips>`, `<ActivityFeed>` | Counts, next milestone, deadlines and risks match an oracle. RACI is contextual per item (tested on a person with three different letters). The feed is chronological with linked items and status changes. Filters and sorting work. Deep links are stable. |
| **6D Parties** | Register, profile, engagement risk (both profiles), schedule float, masked contacts, non-functional access preview | Every person's level matches the oracle. Every threshold, statutory-window and response-due boundary is tested. Authorities are assessed on their statutory timetable, missing data is Unknown, schedule float matches a brute-force oracle, and every level carries its explanation. **No full contact value appears in any API response or the bundle** (scanned). Engagement and delivery risk are shown apart. |
| **6E Connections** | `/api/connections`, path cards, graph highlight, contextual links from Workstreams and Parties into the Explorer | Paths match a breadth-first-search oracle over the YAML (up to 3 hops, no repeated nodes) in deterministic cost order, with hubs ranked down but still reachable. Caps and budget are reported when hit. Measured time is under 200 ms. TypeQL shown is exact. The disclaimer is visible. |
| **6F Integration and docs** | Cross-links everywhere, consistency pass, self-guided exploration guide, updated scripts, test documentation; **the Gantt's "Show critical path"** (the lowest-float path to each deadline, §5.4), carried from 6B/6D | Every link in the navigation chain works in the browser. There are no dead ends. All tests pass. No console or network errors. Clean start, outage recovery and reset all work. Docs are updated (README, architecture, schema, dataset, guide, scripts, tests, NOTICE). |

Every phase ends at an approval gate with screenshots, a local commit and nothing pushed.

**Regression risks and mitigations:**
- **Answer-key tests that hard-code counts** (471 records, 14 items moved, 19 organisations / 24 people):
  re-baselined in 6A.2 only, each change listed, with the four Impact outcomes held exactly.
- **Explorer readability with more organisations and people:** people stay on demand; the new
  organisations go into existing groups.
- **One large insert for roughly 1,500–2,000 records:** measured in 6A.2; if it is slow, the loader chunks within the same
  single transaction.
- **Data-quality checks:** must stay clean on the seed. Delivery problems are shown as risks, not as data errors.
- **Engagement drifting stale against the real date:** prevented by the scenario-date rule and its test.
- **Contact leakage:** prevented by the response-scanning test.

---

## 10. Decisions requiring approval

Reversibility: **Easy** (a code or config change, under a day, nothing else depends on it),
**Moderate** (touches data, tests or several screens, but contained), **Hard** (later work is built on
it, or it becomes public once published).

| # | Decision | Recommendation | Rationale | Trade-offs | Reversibility |
|---|---|---|---|---|---|
| D1 | Add **Phase 6A.2, data foundation**, before the screens | **Yes** (approved in principle) | One schema change, one data rebuild and one test re-baseline, instead of three partial ones; every screen phase builds on stable records | Nothing visible for one phase; the data is designed before the screens that use it, so a few details may need small follow-up edits | Easy (a sequencing choice) |
| D2 | Schema extensions via a **migrations mechanism**: S1 `activity`, S2 `actual-start-date`, S3 the event hierarchy (`engagement`/`outreach` subtypes, `reply`, `response-due-date`), S4 `email`/`phone` | **Yes** | Each is required by a screen: Gantt bars need durations, Parties needs meaningful responses told apart from outreach, and overdue obligations need response dates. Everything is additive, so existing queries keep working. The event hierarchy and `reply` (a relation between two relations) also showcase TypeDB. | More types to explain. Names chosen now become the vocabulary of ~250 events and every engagement query. | **Hard** for type names and the event hierarchy (see §11); Easy for the loader mechanism |
| D3 | S5 **risk register** (`risk`, `risk-exposure`, RACI on risks) | **Yes** | "Key risks" on Workstreams then shows real, owned, mitigated records rather than inferred flags, and keeps delivery risk apart from engagement risk | About 15 more records to author well; one more concept on screen | Moderate (types, data and one panel) |
| D4 | Realism changes **R1–R4** (convening hearing, CMA Phase 1 steps, pre-notification, brokers and registrar); **R5** pensions | R1–R4 **yes**; R5 **disclose, don't model** | R1–R2 fix real gaps a practitioner would notice and explain why the CMA is at risk; R3–R4 add realistic parties at low cost. Pensions would add a whole stakeholder track for little demo value | CMA step dates are illustrative and need a practitioner check; R5 leaves a known simplification, disclosed | Moderate (data edits that ripple into dates and events) |
| D5 | **Workstream progress:** derive in TypeQL from its items, or keep it stored with a consistency test | **Derive** | One source of truth; avoids "Regulatory 80%" next to a CMA clearance at 60%; another live aggregation query | The derived figure (a simple mean) ignores relative effort, and it will change some Overview numbers (re-baselined under D10) | Easy (one query and one model field) |
| D6 | **Dataset:** hand-authored YAML split per workstream; sizes **indicative** (§3.5) | **Yes** | Purposeful, interconnected records tell the story; per-workstream files are reviewable; quality over volume, as you asked | The largest effort in Phase 6; hand authoring is slower than generating, but generated data would read as fake | **Hard** in effort (see §11); the structure is easy to change |
| D7 | **No named fictional individuals at real authorities**: their engagement is recorded at organisation level ("CMA case team") | **Yes** | Avoids inventing staff of real public bodies, which could mislead or embarrass once published; the authority profile (D9) works at organisation level | Regulatory threads read slightly less personal | **Hard** to undo once published, so default to the cautious option |
| D8 | **Contacts:** fictional (`.example`, Ofcom drama numbers), stored in TypeDB, **masked on the server**, never returned in full; the access request is a **non-functional demonstration** (§6) | **Yes** | Demonstrates the right pattern: disclosure decided on the server, with honest limits stated; no real person can be reached; read-only is preserved | Studio users can read the fictional values (documented); a demo button that does nothing must be labelled so it isn't mistaken for a broken feature | Easy technically; Hard once published (the fictional values are public, which is harmless by design) |
| D9 | **Engagement policy** in `config/engagement-policy.yaml`: participant and authority profiles, overdue obligations, workstream-level recency with fallback, Unknown when no data, escalation only for schedule-critical or "critical" items that are due soon or at risk (§5.3) | **Yes** | Your thresholds applied as configuration, not data. Regulators judged on statutory timetables, not silence. Overdue obligations caught regardless of recency. Every rating explained and testable. | More rules to explain, so the profile and the trigger are always shown with the rating; the fallback can soften a rating, which is stated in the explanation | Easy (configuration and one module); the tests pin the behaviour |
| D10 | **Re-baseline** count-based tests and the answer key in 6A.2, holding the **four Impact outcomes exactly** | **Yes** | Counts must change once activities exist (records, items that move, people); the outcomes the demo is built on must not. Every changed number is listed with its reason. | Some familiar figures change (for example "14 items move" becomes higher), and the demo script and docs are updated to match | Moderate (old values stay in git history, but the docs and script move with them) |
| D11 | **Ownership:** relabel to "Direct shareholding (legal)" and "Effective economic interest"; record the reason for each holding and the minority rights (Calder's reserved matters, Helix's board seat and reserved matters) as data; **voting control** as an optional spike | Relabel and data **yes**; voting control **spike, then decide** | Clearer for transaction professionals and accurate about what is calculated; minority rights deepen the change-of-control story with existing types | A control view would need a recursive majority test in TypeQL; if TypeDB can't express it cleanly, it is dropped rather than moved into Python | Easy (labels and data); Moderate if a `voting-share` attribute is added |
| D12 | **Connection paths** (§7): up to 3 hops, fixed-depth queries, hubs **ranked down, not excluded**, capped results, budget reported, top 20 plus grouped summaries | **Yes** | Answers "how are these connected?" with readable queries, stable ranking and honest limits; useful paths through Novacore or the Panel survive | Ranking weights are a judgement call (kept in the policy file); depth 3 can be slow on busy nodes, hence the caps and budget | Easy (one endpoint and one panel) |
| D13 | **Gantt built in-house** (no new library), one component and one endpoint shared by Overview and Workstreams | **Yes** | No new dependency or licence; full control of the status colours, the scenario-date line and deadline markers; grows from an existing component | More code to own than a library; features such as drag editing are deliberately absent (the app is read-only) | Moderate (swapping in a library later means rewriting one component) |
| D14 | **Data-quality checks stay clean** on the seed; delivery problems appear as risks and statuses, not as data errors | **Yes** | Keeps "the data checks itself" meaningful (it is about integrity, not progress); the T2 demo step still shows a check firing live | The realistic "something's wrong" signals live in the risk and engagement views rather than the Attention panel | Easy |

## 11. Decisions that are difficult to reverse

1. **D2: the type names and the event hierarchy.** Once roughly 250 events, 75 activities and every
   engagement query are written against `activity`, `engagement`/`outreach`, `request`, `response`,
   `reply` and `response-due-date`, renaming or restructuring them means rewriting data, queries, tests and
   docs. After public release, other people's queries would depend on them too.
   *Mitigation:* before authoring the full dataset, 6A.2 starts with a spike. The spike loads the migration
   plus a small sample of each new type on the real server, and runs the queries the screens need
   (engagement recency, reply chains, Gantt dates). The names are confirmed then, not after authoring.
2. **D6: the authored dataset.** The story it tells becomes the reference narrative, and its dates thread
   through events, RACI, dependencies, schedule float and the answer key. Changing the chronology later
   ripples widely.
   *Mitigation:* the timeline skeleton (workstreams, activities, dates, dependencies) is agreed and
   validated first. Events and RACI are written against it second. The validator enforces chronology at
   every step.
3. **D7 and D8: anything that will become public.** Once pushed to a public repository, the dataset and its
   fictional contact values can't be withdrawn. That is why the plan defaults to the cautious options: no
   invented staff at real authorities, reserved email and telephone ranges, and nothing pushed without
   your approval.
4. **D10 (moderate): the re-baselined answer key.** After 6A.2 the documentation, demo script and tests
   use the new counts. Reverting is possible from git history, but means re-editing several documents.
   *Mitigation:* the four Impact outcomes are held fixed by tests throughout.

Everything else (D1, D3, D4, D5, D9, D11 labels, D12, D13, D14) can be changed later within a phase,
because it lives in configuration, a single module or a single component.

## 12. Approval and adjustments (2026-10-27)

All of D1–D14 are approved, with three adjustments that supersede the text above where they differ.

**D5: progress is derived, but never as an unweighted average.** Two measures, shown separately:
- **Activity completion** = the duration-weighted mean of reported progress, over items with a
  duration (a planned start and a due date). Each item's weight is its planned length in days, so a
  six-week drafting task counts more than a two-day filing. Complete items count as 100%. Duration is a
  stated proxy for effort, because the data has no effort estimates; the label says so.
- **Milestone readiness** = point-in-time milestones and conditions achieved, out of those in the
  workstream ("3 of 5 achieved"). Contractual deadlines are excluded from both: they aren't work.
- A workstream with no duration-bearing items shows milestone readiness only, labelled as such. The
  deal-level figure on the Overview uses the same method across all workstreams. It is calculated in
  Python, from dates and progress values read from TypeDB, because TypeQL can't subtract dates.

**D9: engagement is measured against the specific responsibility, request or obligation.**
1. **Overdue responses take precedence.** An unanswered request to the person (or their organisation)
   about the assigned item, past its `response-due-date`, makes that assignment **red**, whatever else
   they have done recently.
2. **Item-specific recency.** The clock for an assignment starts when the item became active (its actual or
   planned start; for a point milestone, a policy window before its due date). It is reset only by the
   person's engagement **on that item**. Items not yet active are "Not yet active", not assessed.
3. **Workstream-level engagement is context, not evidence.** It appears in the explanation, labelled
   "Context: last engagement anywhere on Regulatory, 2 days ago". It never improves an assignment's
   rating, so it can't suggest that an activity received attention when it didn't.
4. **Unknown** applies when no engagement at all is recorded for the person: a data gap, never shown as red.
5. **Authorities and schedule criticality:** as revised in §5.3–§5.4.

**D11: ownership labels and explanatory data are approved; voting control is deferred.** It will be
revisited only if it can be modelled accurately and shows clear value. Python calculations are acceptable
where appropriate, so not every calculation has to be forced into TypeQL.


## 13. Phase 6A.2 results (2026-10-27)

**Order followed.** Schema trial on a throwaway database (every new type and every screen query ran;
every existing query still ran) → timeline skeleton validated (Impact outcomes identical at all 13
answer-key delays) → full dataset → tests → rebuild → browser check.

**Schema:** one additive migration, `schema/migrations/001-phase6-foundation.tql` (see
schema-design.md §6). Base schema files unchanged.

**Dataset:** 1,051 records (was 471), loading in about 0.55 s with every count, guard and check passing.
30 organisations, 45 people, 11 mandates, 78 work items (41 activities), 80 dependencies (67 hard,
18 crossing workstreams), 386 RACI assignments, 111 events, 16 replies, 10 risks.

**Impact outcomes held:** thresholds 61 / 120 / 136 days; at 168 days Helix +108, long-stop +49,
settlement +33; at 28 days 15 items move. New: from 60 days two new activities with slack also move
(AC-INT-SYSTEMS, AC-PPL-AWARDS), and AC-INT-100DAY at 168, so 16 items move after the clearance at 61 days
(was 14). No deadline outcome changed.

**Tests:** 153 pass (was 130). Nine existing tests were re-baselined, each for a stated reason: four
hard-coded counts (471 → 1,051 records; 41 → 85 accountable items, adding `activity`; 25 → 67 hard
edges; the planted person-count message), two progress tests moved from a plain mean to an
independent D5 oracle (`tests/oracle.py derived_progress`), one explorer test (events are no longer
listed as relationships), and two generated-file checks (seed.tql regenerated). No safety check was
weakened. 23 new tests: one per new validation rule, migrations present in a new database, event counts,
reply chains, unanswered requests found by negation, the risk register, fictional contacts, and no
contact value in any API response.

**Changes to the plan, for review:**
1. `engagement` and `outreach` are concrete, not abstract (TypeDB requires an abstract parent).
2. The event type is `notice`, not `notification` (that name is the RACI "Informed" relation).
3. A risk's owner is a dedicated `risk-ownership` relation (exactly one), not a RACI letter.
4. Helix's and Calder's minority rights are recorded as ownership descriptions, not covenants: they are
   standing rights with no due date, and covenants would have changed the Phase 1 answer key.
5. The dataset is about 1,050 records against the indicative 1,500–2,000: enough for the screens'
   stories without padding. More can be added in 6B if a screen needs it.
6. Four workstream windows were adjusted so every activity sits inside its workstream (Legal and Scheme
   from 22 Jun, Regulatory 15 Jul, People 20 Jul, Communications 22 Jun).
7. The Overview's progress tile now uses the D5 method: 62% duration-weighted over 47 items with planned
   durations, 11 of 28 milestones achieved (previously an unweighted mean).

**Not yet done (by design, 6B onwards):** the Gantt, Workstreams and Parties screens, the engagement
calculation, schedule float, masked contact display and the connection-path view.


## 14. Phase 6B results (2026-10-27)

**Owner's conditions on approving 6A.2, and what was done:**
1. Plan changes 1–3 and 5–7 approved as reported.
2. Change 4 (minority rights) approved, with a rule now recorded in dataset.md: a right that affects the
   outcome (dependency analysis, ownership control, impact simulation) is modelled structurally; a
   background right stays in the description. Today's outcome-affecting rights (Helix's call option and
   Calder's licence consent) were already structural; board seats, reserved-matter vetoes and Calder's
   sub-licensing consent are description-only, and would be modelled before any feature used them.
3. The Overview's progress tile is now **Work progress**: "62% activity progress" and, separately,
   "Milestones achieved 11 of 28", with the line "Neither figure is readiness to close: that is
   Conditions satisfied". Workstream rows show both measures too.
4. The optional technical demo was re-run on `apex-demo` (T1 five rejections with the documented
   error codes; T2 both steps; T3). T2's figure changed: a 30-day delay to the new Irish screening
   clearance now moves **17** items, not 15 (the court hearing slips 34 days, so two new activities with
   slack also move). The script is corrected. Note: T2 delays the new Irish clearance, not the CMA.

**Built:** `GET /api/schedule` (no new TypeQL: it reuses all_items, workstream progress, dependencies,
hard-dependency kinds, deadline limits and the scenario date), `GET /api/items/{code}` (one fetch with ten
subqueries), the full-width `<Gantt>` on the Overview, and the shared `<ItemDetail>` panel.

- Rows: seven workstreams (window bar with activity progress, plus their milestones when collapsed),
  expanding to one row per item in date order. The workstreams holding anything at risk open first.
- Bars from planned start to due date, filled to reported progress and coloured by status; diamonds for
  milestones; red dashed lines and labels for the three contractual deadlines; a dark line labelled
  "Scenario date · 26 Oct 2026".
- Zoom: Whole deal (fits the width), Months and Weeks (horizontal scroll, opening on the scenario date).
- Selecting an item draws its dependencies (solid: moves dates; dashed: information only), puts it in the
  URL (`/?item=CP-CMA`, so it can be linked) and opens the panel: type, criticality, status, description,
  dates (planned, actual, due, "in 21 days" from the scenario date), progress, every RACI holder with
  employer and mandate, dependencies both ways (clickable), deadlines and obligations with consequences,
  risks, the latest event (and the earlier ones), its TypeQL, and "Simulate a delay in the Impact
  Explorer" for open conditions.

**Data fix found on the way:** four texts had been cut short since Phase 1 or 6A.2 (an unquoted comma in a
YAML `{...}` entry starts a new, empty field): MS-SCHEME-DOC, CV-COC-CALDER, EV-0014 and the High Court's
description. They are corrected, and the loader now refuses any empty field, with a test.

**Tests:** 170 pass (was 154 after the data-fix test). New: 15 for the schedule and item detail against
the raw YAML (every bar and diamond's dates, shapes, workstreams and order; deadlines and what they limit;
every dependency and whether it is hard; RACI, dependencies, deadlines, consents, events newest-first and
risks for six items; the simulate link only on open conditions; 404 and 422; read-only TypeQL), and one
checking the chart and panel never read the browser's clock. The existing scan confirms no seed data in
the frontend source or bundle.

**Deviations from the plan, for review:**
1. The Gantt replaces the Overview's earlier milestone timeline (one timeline, as the plan intended);
   `/api/milestones` is kept unchanged for compatibility.
2. "Link to its workstream" opens and scrolls to that workstream in the chart, because the Workstreams
   page is 6C. People in the panel are not links yet (the Parties page is 6D).
3. The real date is not shown at all, rather than "only in a note": the note says the demonstration never
   uses it. Showing it would mean reading the browser clock, which the scenario-date rule forbids.
4. Actual start dates are shown in the tooltip and the panel, not drawn as a second bar, to keep rows
   readable.
5. The chart's header scrolls with the page rather than sticking under the app bar; with workstreams
   collapsed by default the chart is short enough that this reads better.

**Screenshots:** the 6B thumbnails (800 × 500) were replaced by full-resolution captures in the refinement pass (§15).


## 15. Overview refinement pass (2026-10-27, before 6C)

**Layout.** Below the Gantt the Overview now has two columns at 1440 px and 1280 px: Regulatory approvals
and Workstream progress (moved up and widened to two-thirds) on the left; Attention needed and Recent
activity on the right. Recent activity stretches to the left column's height and scrolls within it (30
events, with a soft fade at the bottom), so both columns end at the same line: measured at 3,221 px
(1440) and 3,270 px (1280). Deal participants follow, then the RACI matrix in its own full-width row at the
bottom; choosing a workstream scrolls to it. Narrower screens keep the single-column stacking.

**Show TypeQL, everywhere (14 drawers).** Line 1: "Show TypeQL · N queries · capabilities"; line 2: a
panel-specific sentence. The capabilities are detected by the API from the TypeQL that actually ran
(`apex/capabilities.py`), checked against the schema files: recursive functions (a call to a function that
calls itself, directly or via another, read from functions.tql), n-ary relationships (a relation pattern
with three or more role players), polymorphism (matching a type that has subtypes, or a `sub` query),
negation, aggregation, typed relationships and nested queries. "Schema constraints" is not offered: read
queries cannot demonstrate it, so it would be a false claim; the optional Studio demo (T1) shows it.
Each label has a hover explanation. Expanding the drawer works exactly as before.

**Clickable rows.** Gantt activity, milestone and deadline rows are each one control: the whole row (label,
bar or diamond, empty space) opens the same panel. Hover gives a full-row background, a pointer and a
chevron; keyboard focus gives a visible ring that continues across the sticky label, and the chevron;
selection gives a pale teal row, a left accent bar, a persistent chevron and a ring around the bar or
diamond. Tab and the up/down arrows move between rows (workstream rows included); Enter or Space opens one.
Long names truncate with the full text available as a tooltip and to screen readers. The same convention
(`web/src/components/row.tsx`) is applied to Workstream progress, the Impact Explorer's before-and-after
rows and person chips, and the Relationship Explorer's people list.

**Also fixed:** the demo script's step 2 now quotes the participants panel's own figures (22 organisations
and 42 people working on the deal; the Explorer adds the Atlas group companies, Helix and Calder), and the
item panel's TypeQL note now describes both of its queries.

**Verified in a browser** (computed styles and real keyboard events in the app's browser pane; real mouse
and key events in headless Chrome for the screenshots): hover, focus and selection styles; Enter, Space and
arrow keys; bar click and row click open the same item; no horizontal page scroll at either width.

**Screenshots** (docs/screenshots/, genuine 1440 × 900 and 1280 × 800 captures, PNG): deal-overview.png
(README, 1440 × 1880), overview-{1440,1280}-top / -two-columns / -full, gantt-{1440,1280}-hover /
-keyboard-focus / -selected.

**Tests:** 187 pass (170 before, plus 17 for the capability labels: the recursive functions are read from the
schema, strings and comments are ignored, every response's labels match its queries, and "Recursive
functions" appears exactly when a recursive function is called).


## 16. Phase 6C results: Workstreams (2026-10-27)

**Carried forward from the refinement review:**
1. *Recursive functions* is decided from the function definitions: the schema's functions (functions.tql and any
   migration) are parsed into a call graph, and a function counts only if it lies on a cycle or calls one.
   Calling an ordinary function (`accountable_for`) is not labelled; tested with made-up definitions too.
2. Every independently scrolling region (Recent activity, the activity history, the item panels, the TypeQL
   query lists) uses one `ScrollArea`: it takes keyboard focus (arrow keys, Page Up/Down) with a visible ring,
   fades the edges that have more beyond them, and says "Scroll for more … · arrow keys work when focused" or
   "End of …". The Gantt says "Scroll sideways …" when it overflows and can be focused to scroll with ← →.

**Built:** `GET /api/workstreams` and `GET /api/workstreams/{code}` (12 READ queries for a detail page, about
70 ms), the Workstreams list (`/workstreams`) and a page per workstream (`/workstreams/WS-REG`), in the
main navigation.
- **List:** a card per workstream with status, lead, dates, the three measures apart (activity progress,
  milestones achieved, conditions to close, "None here" where a workstream holds no conditions), next
  milestone, contractual deadlines its open work can affect (recursive `downstream`), open risks with words
  as well as colour, organisations involved and latest activity. Filters (status, organisation, open risks)
  and sorting (plan order, progress, nearest deadline, next milestone, risks, recent activity) run in the
  browser over one answer and live in the URL.
- **Detail:** breadcrumb and buttons to the Deal Overview, Relationship Explorer and Impact Explorer (straight
  to "Simulate a delay" for an open condition); the summary; the reused Gantt filtered to the workstream (with
  every deadline on the axis); dependencies with other workstreams in and out; work waiting on open
  prerequisites at any depth (recursive `upstream`); obligations with consequences; risks with owner and
  mitigation; the activity history; and the contextual RACI matrix (one person can be A on one item, R on
  another and I on a third). Every item, dependency, obligation, risk item and feed item opens the shared item
  panel (`?item=CODE`, so the view can be linked).
- **Activity history:** newest or oldest first, filters by event type, request reply-by dates with the recorded
  responses (or "no response recorded, and the date has passed"), "replies to" for responses, attendees and
  recipients, before → after for status changes.
- **Show TypeQL:** two lines everywhere. Each section of the detail page lists only its own queries, and its
  labels come from those queries alone (the API now reports capabilities per query).

**Data:** the 1,051-record dataset unchanged; no new records were needed.

**Tests:** 202 pass (187 before; 2 more for the call-graph rule and per-query capabilities, and 13 for
Workstreams against the raw YAML: order, the three measures, counts, lead and next milestone, deadlines in reach
by graph search, risks, organisations, latest event and newest-first feeds, every event's type, recipients,
attendees, replies and status change, open prerequisites at any depth by graph search, dependencies crossing
workstreams, obligations, the open conditions offered for simulation, contextual RACI for one person with three
letters, 404/422 and read-only queries). A headless-Chrome run over all pages at 1440 and 1280 px reported no
console errors.

**Deviations from the plan, for review:**
1. **Engagement status is not shown** on the Workstreams pages: it is decision D9's calculation, planned for
   6D with the Parties page. The feed shows only the facts (a request's reply-by date and whether a response
   is recorded).
2. **Organisation filter, not an "organisation" sort,** and no separate "deadline" filter: the sort by nearest
   deadline covers it. "Outstanding responsibilities" per person is left to the Parties profile (6D).
3. **Item-panel workstream link** now opens the workstream page (6B deviation 2 resolved). People in the panel
   are still not links until the Parties page exists (6D).
4. A TypeDB 3.14.1 planner bug (QPL1) forced one query to be rewritten; described in docs/queries.md.

**Screenshots** (docs/screenshots/, genuine 1440 × 900 and 1280 × 800 PNG captures and full pages):
workstreams-list-*, workstream-regulatory-* (top, full, feed-focused, item-panel), workstream-legal-*,
overview-*-recent-activity-focused.


## 17. Phase 6D results: Parties (2026-10-27)

**Carried forward:** the Workstreams pages are unchanged apart from links (RACI column headers and the item
panel's people now open profiles). The QPL1 planner bug is fully documented in the private feedback notes
(version, minimal schema and data, the minimal failing query, the complete error, six variants, the original
Apex query and the workaround), with a script that reproduces it on a throwaway database; the workaround stays.

**Built:** `GET /api/register`, `GET /api/parties/{code}` and `GET /api/engagement-policy`; the Parties register
(`/parties`, people and organisations) and a profile per party (`/parties/PER-DONNELLY`), in the main navigation;
`/explorer?focus=CODE` opens the Relationship Explorer with a party selected.
- **Register:** five counters that are also filters (overdue responses, deal risk, inactive on an assigned
  item, insufficient information, and authorities on their statutory timetable); per row the level *in words*
  with its category ("Red · Overdue response"), the reason, open A/R work, open letters, delivery risk in its
  own column, last activity and masked contact. Search, organisation and workstream filters and sorting live
  in the URL. The policy in force is explained at the foot of the page.
- **Profile:** the assessment and its flags; "Why: every finding and its records", grouped by category, each
  with its reason, the threshold and clickable evidence (event, request, item, deadline); outstanding
  responsibilities with status, due date, schedule float and assessed criticality side by side; requests to and
  from them with reply-by dates and answers; engagement history (the shared feed); relationships; links to
  workstreams, the Relationship Explorer, and "Simulate a delay" for open conditions they lead. Masked contacts
  with a non-functional access-request panel headed "Demonstration only: no request is sent or stored".
- **Authorities:** a separate "Statutory timetable" profile (decision date windows and requests sent to them,
  never silence); no individuals at real authorities are recorded or invented (D7).

**How engagement is decided** (config/engagement-policy.yaml; facts before inferences):
1. Overdue response: a request to the person (or their organisation, about an item they are assigned to) past
   its reply-by date with no response recorded: red. Due within 2 days: amber.
2. Inactivity, item by item, for Accountable and Responsible letters: days since they last engaged on that item,
   or since it became active (actual or planned start; point milestones 21 days before due). A/R amber from 4
   days, red from 8. Activity elsewhere is shown as context and never improves the level.
3. Deal risk: an amber assignment escalated to red when the item is schedule-critical (float ≤ 30 days) or
   recorded as critical, and due within 14 days or at risk.
4. Insufficient information: no engagement recorded anywhere: Unknown, never red.
Engagement means the schema's `engagement` subtypes (response, meeting, delivery, decision) by the person or a
meeting they attended, plus requests and notices *they sent*; automated notices never count.

**Results on the dataset (scenario date 26 Oct 2026):** of 45 people, 13 red (2 overdue responses: Claire
Donnelly and Liam O'Sullivan; 1 deal risk: Daniel Okafor on the CMA response, critical and due in 4 days; 10
inactive on an assigned item), 2 amber, 6 green, 7 not yet active, 17 with nothing to assess, 3 with no
engagement recorded at all. Authorities: the CMA is amber (Novacore's request about the issues meeting is due
27 Oct); the High Court is green on its timetable. Schedule float of the CMA clearance: 60 days, as the Impact
Explorer shows.

**Tests:** 254 pass (202 before; 40 rule tests on made-up records: every threshold boundary, reply-by and
statutory boundaries, each escalation trigger alone, no escalation without both, Unknown, not-yet-active,
the milestone window, ties, deadlines, authorities, outreach counted for senders only, workstream letters,
evidence on every finding; and 12 against the raw YAML: schedule float by brute force for every item,
every party's level by an independent oracle, the deliberate scenarios, authorities, outstanding work and
delivery risk, assignments, requests and history, evidence codes, masked contacts in every response and in the
frontend source and bundle, the policy endpoint, 404/422 and read-only queries, and the Docker image including
the policy). Headless Chrome over every page at 1440 and 1280 px: no console errors.

**Deviations from the plan, for review:**
1. **Consulted and Informed letters are not assessed for inactivity**, only on the requests sent to them. With
   the plan's C and I thresholds, 20 of 45 people were red, mostly for silence on items they are merely
   consulted or informed about. It is one setting in the policy file (the plan's values are noted there).
2. **Escalation is amber to red only,** never green to amber: an engaged person is not flagged for the item's
   own difficulty, which is shown separately as delivery risk.
3. **Requests and notices count as engagement for their sender** (the schema's comment already said outreach
   does not count *for its recipients*). Without this, the deal lead looked inactive on an item he had chased
   four days earlier.
4. **Endpoint names:** `/api/register` and `/api/parties/{code}` instead of `/api/people` and
   `/api/people/{code}`: `/api/parties` is the Overview's existing endpoint, and profiles cover organisations too.
5. **Schedule float** is computed in Python from the dependency records with the Impact Explorer's own
   projection, not with one recursive `impact_edges` query per item (78 queries); results are identical and
   tested by brute force. The Gantt's "Show critical path" is not built yet.
6. **Contractual deadlines are not assessed for inactivity** (they are limits, not work).
7. **The top bar uses shorter labels below 1400 px** (Overview, Relationships, Impact): adding Parties made it
   wrap at 1280 px. "Fictional demonstration data" is never shortened.
8. Fixed on the way: the API's Docker image did not include `config/`; a test now checks it.

**Proposed dataset addition (not made, for your decision):** 5 of the 13 reds are workstream leads judged on
their workstream-level letter (Marcus Adebayo, Sophie Lindqvist, Aisha Karim, Charlotte Ainsworth, Mei Tanaka:
for example "no engagement on any Financing item for 146 days"). That is a true reading of the records, but it
mostly reflects that the dataset records no lead oversight. Proposal: 7 events, one weekly workstream steering
meeting per workstream between 19 and 23 October, led by the workstream's Accountable lead with its Responsible
people as attendees. This would make those assessments green or amber; nothing else would change.


## 18. Steering meetings and their effect on Parties (2026-10-27, owner-approved)

**Data (7 events, 1,051 → 1,058 records):** one steering meeting per workstream, recorded against the workstream
itself, led by its Accountable lead, with realistic attendees and an agenda naming only the items actually
discussed (migration 002: `meeting relates agenda-item`; table in dataset.md). The loader refuses an agenda on
anything but a meeting, an unknown agenda item, or one outside the meeting's workstream.

**Rule change, keeping oversight and activity apart:**
- *Workstream-level letters* (for example A on Financing) count a meeting on the workstream as oversight.
- *Activity-level letters* count only an event on that item, or a meeting that had it on its agenda, and only for
  people who attended or led it. Attending a workstream meeting that did not discuss an item is not engagement on it.
- Engagement risk and delivery risk stay separate; nothing in delivery risk changed.

**Register before and after (75 parties):** 7 changed, 68 unchanged. People: red 13 → 6, amber 2 → 9; green 6,
not yet active 7 and nothing to assess 17 are unchanged; the 2 overdue responses, the deal risk and the
authorities are unchanged.

| Person | Before | After | Why |
|---|---|---|---|
| Aisha Karim (R, Financing) | Red: no Financing engagement for 105 days | Amber: Financing steering 5 days ago | oversight |
| Charlotte Ainsworth (R, Legal and Scheme) | Red: 17 days | Amber: Legal and Scheme steering 6 days ago | oversight |
| Marcus Adebayo (A, Financing) | Red: 146 days | Amber: Financing steering 5 days ago | oversight |
| Sophie Lindqvist (A, Legal and Scheme) | Red: 125 days | Amber: Legal and Scheme steering 6 days ago | oversight |
| Mei Tanaka (R, Integration Planning) | Red: 17 days | Amber: IMO steering 5 days ago | oversight |
| Hannah Reyes (A, interim finance arrangements) | Red: no engagement since 1 Oct | Amber: discussed at the IMO steering 5 days ago | on the agenda |
| Tomás Ferreira (A, Irish consultation) | Red: 12 days | Amber: discussed at the People steering 4 days ago | on the agenda |

They are amber, not green: the meetings were 4–7 days before the scenario date, inside the A/R amber band.
**Oliver Grant stays red**: he attended the Communications steering, but Day-1 materials were not on its agenda,
so his item is still measured from 13 October. That is the distinction the rule exists for.

**Are the remaining reds artefacts?** None was removed; each was checked.
| Person | Finding | Assessment |
|---|---|---|
| Claire Donnelly | Overdue response (EV-INT-05, 7 days) | Genuine: a recorded fact, and it is holding up interim arrangements |
| Liam O'Sullivan | Overdue response (EV-PPL-04, 5 days) | Genuine: a recorded fact on the Irish consultation timetable |
| Daniel Okafor | Deal risk: A on the CMA response (critical, due in 4 days), last touched 4 days ago | Genuine but mild: the Responsible team is active (a second draft yesterday); the flag is a fair prompt for the Accountable sign-off |
| Dr Rajiv Menon | Inactive 10 days on the ordinary-course restrictions | Genuine: Atlas's October confirmation came a day late |
| Oliver Grant | Inactive 13 days on Day-1 materials | Genuine: his colleague is carrying the work, and he did not discuss it at steering |
| Benedict Shaw | Inactive 12 days on the CMA issues meeting | **Likely an artefact**: the milestone counts as active 21 days before 4 Nov (the policy window), but the meeting was only proposed on 20 Oct after the issues letter; Shaw's daily work on the response is in effect the preparation, recorded against a different item. Left as it is, and explained here |

## 19. Phase 6E results: Connections (2026-10-27)

**Built:** `GET /api/connections` and `GET /api/connectables`, and a third view in the Relationship Explorer
(`/explorer?view=paths&from=…&to=…`), linked from every party profile, every workstream page, the item panel and
the Explorer's party panel.
- **What a path is:** entity → relation → entity, up to three relations, through people, organisations, work items,
  workstreams and risks only. The acquisition, mandates and events are relations in the schema, so they can be a step
  but never a stepping stone: "both are on the deal" is structurally impossible as a connection, not filtered out.
- **Explained:** each step is one record stated in words ("Blackwood Marsh LLP advises Novacore plc (Legal and
  competition counsel)"), with the roles used and the record's other players kept for context (n-ary relations
  stay whole). Each path is labelled **Direct relationship** or **Indirect · N steps**, with cautions for hubs
  (stepping stones with 60+ links), activity records and shared workstreams.
- **Controls:** at most 1, 2 or 3 steps; 10, 20 or 50 paths (the rest summarised by what they go through);
  activity records on or off (only ever in paths of up to two steps); shared workstreams off by default.
- **Ranking** (config/connection-policy.yaml): cost = steps + relation weights (specific facts light, activity
  records heaviest) + a hub penalty per stepping stone, so a standing chain outranks an interaction. For Charlotte
  Ainsworth and the CMA the first path is employment → mandate → authority review, not a shared meeting.
- **Speed:** met in the middle (each end's neighbours, then the relations joining them): 20–180 ms on the full
  dataset, against 0.3–2.4 s for a single three-relation query. The middle query is capped (2,000 rows), the
  request has a 1,500 ms budget, and the answer reports any cap or skipped depth.

**Tests:** 278 pass (254 before; 5 for steering meetings and agendas: oversight versus activity level,
attendance without an agenda, attendees only, the validator, "discussed at" in the item panel; and 19 for
connections: totals equal to a breadth-first search over the raw YAML for eight pairs, with each option changing
the search exactly as stated, simple paths, never through the transaction, events at two steps at most, direct
versus indirect, the meaningful chain first, n-ary context, activity labels, bounds, grouping, stable order,
speed, 404/422 and read-only queries). Counts re-baselined: 1,051 → 1,058 records and 111 → 118 events.

**Deviations from the plan, for review:**
1. **Met in the middle instead of one query per depth:** the per-depth three-relation query took up to 2.4 s;
   the result is identical (tested) and every query stays readable in "Show TypeQL".
2. **No blanket hub exclusion, as planned, but the transaction is never a stepping stone**, because it is a relation;
   activity records are limited to two-step paths, and shared workstreams are off by default. This follows your
   instruction to avoid paths that come only from shared membership.
3. **The route is drawn as a chain in each path card**, not highlighted on the network graph: most paths run through
   work items, people and risks, which the organisation network does not draw.
4. **Steering meetings:** Due Diligence's is a June close-out, and Regulatory's is the previous week's call (one
   already existed on 26 Oct).
5. TypeDB findings logged privately: `isa entity` is reserved (use `entity $t;`), the driver's deprecated datetime
   call (contained around attribute reads), and the cost of distinctness checks in long path queries.


## 20. Phase 6F results: showcase and polish (2026-10-27)

No earlier written design for the Advantage panel, the AI Analyst or the purple styling was found in the repository
or this session's records, so the owner's 6F brief is the specification. Dataset unchanged: 1,058 records.

1. **TypeDB Advantage panel** (`apex/advantage.py`, `/api/advantage`; `components/advantage.tsx`): a top-right button
   with a three-pulse attention animation on the first visit only (skipped with reduced motion); a sidebar with a
   sticky header, section chips, a labelled Close button, Escape, focus moved to its title on opening and back to the
   button on closing, and an independently scrolling body. It opens on the section for the current page (marked
   "Relevant to this page"), or at `?advantage=<section>`. Six sections: typed relationships, recursive reasoning,
   schema constraints, polymorphism, application complexity, structured context for AI. Evidence: excerpts read from
   the schema files (file and line shown, verified verbatim by a test), live figures from TypeDB (its queries in the
   panel's Show TypeQL) and links to working views. A test refuses comparative or performance wording.
2. **AI Analyst concept preview** (`apex/analyst.py`, `/api/analyst/{key}`; `/analyst`): three predefined investigations
   (what could stop closing; who needs to act; a long CMA review). Executed steps run Apex's existing query modules in
   one READ transaction and record exactly which queries each ran (each with its own Show TypeQL); the final step is
   labelled "Hypothetical agent step · not run", written in advance and filled from the executed results. Findings link
   to profiles, items, the Gantt and Impact scenarios. No AI model, chat, free text or external API (a test checks the code
   and dependencies).
3. **Show TypeQL**: pale TypeDB purple (#F5F1FC background, #DDD1F2 border, #65459A accent; contrast about 6.6:1), the
   expanded code panel kept neutral; one shared component, so every drawer changed.
4. **Gantt critical path**: one calculation (`impact.schedule_float`, moved from engagement.py so Gantt, item panel,
   Parties, Workstreams and the Analyst share it) now also gives each deadline its **exposure** (the smallest float into
   it: 60, 119 and 135 days, the Impact thresholds minus one) and its **critical path** (the open items sharing that float:
   CMA clearance → court sanction → completion, plus settlement for certain funds). On the Gantt, "Critical path" opens
   the workstreams involved, marks those items Critical, fades the rest, draws their links, and explains the two ideas
   apart: being on the critical path versus how much delay the deadline can absorb. Tooltips and the item panel show each
   item's float.
5. **Guided demonstration** (`apex/guide.py`, `/guide`): eight steps, about six minutes, each opening an exact view
   (ownership, connections, a regulatory delay, responsibilities, engagement with evidence, AI context, under the
   hood); every figure it quotes is checked against the live answers by a test.
6. **Integration and polish**: AI Analyst in the navigation (badge "Concept"); guided demonstration linked from the footer
   and the Advantage panel; the top bar adapts by width (full labels from 1600 px, short labels below, icons from 1400 px)
   so it never wraps at 1280 or 1440 px, with "Fictional demonstration data" never shortened; the Overview has one h1.
   Browser audit of 16 views at 1440 and 1280 px: no console errors, no unnamed buttons or links, no duplicate ids, no
   horizontal page scroll; Advantage keyboard behaviour verified. The Benedict Shaw limitation is documented in
   dataset.md.

**Tests:** 288 pass (278 before): critical paths against a brute-force float for each deadline, the item panel's float
equal to the Gantt's, and 8 showcase tests (Advantage evidence verbatim and figures true, no comparative claims, each
investigation's executed and hypothetical steps, findings matching the records, no AI code, guide figures equal to the
live answers, the purple tokens).

**Deviations:** (1) the guide is served by the API rather than written in the page, because it quotes deal figures and
the frontend holds no business data; (2) the critical-path selector is per deadline (three critical paths, not one);
(3) the Advantage panel is non-modal (the page stays usable beside it); (4) the guided demonstration is an in-app page,
not a self-running tour.

**Outstanding before an open-source release (none are code defects):** the release checklist in README "Known
limitations" still applies (check invented company names against Companies House; confirm the authorities' names and
roles; an M&A practitioner's review of the deal mechanics; change the default TypeDB password for any shared deployment);
refresh the older 800 × 500 Explorer and Impact screenshots used in the README; confirm the private notes stay
git-ignored; decide the repository's name, licence notice wording and contribution policy.


## 21. Final refinements before 6H (2026-10-27)

1. **Header:** "Fictional demonstration data" now sits under "Project Apex" on the left in subtle styling (it replaces
   "Transaction workspace"); on the right, the scenario date and then the TypeDB advantage button. The yellow badge is gone.
   Single line at 1280 and 1440 px (measured: no overflow).
2. **Transaction status:** the deal badge reads "Transaction at risk", "On target" (only when no condition is at risk or
   delayed: the existing rule in apex/overview.py, unchanged) or "All conditions satisfied", and the text beside it names
   what is at risk ("UK merger clearance (CMA Phase 1) is at risk"). Elsewhere a status word always sits next to the item
   or workstream it describes.
3. **Critical-path terminology:** checked. The chain is **deadline-critical**, not a conventional critical path. A
   conventional (CPM) critical path is the zero-float chain that sets the project's finish date, which here would run to
   the last scheduled item (the bond refinancing, December 2027). Apex measures each open item's float against a
   contractual deadline and marks the items sharing the smallest float. The calculation is unchanged; the UI, guide,
   AI Analyst text, API descriptions and docs now say "deadline-critical chain", and the Impact Explorer's "critical path"
   wording became "every route to the items a contractual deadline limits". (Earlier sections of this plan keep their
   wording as a record.)


## 22. Phase 6H results: open-source release preparation (2026-10-27)

**Clean start, seeding and reset (tested from a fresh `git clone`, no `.env`, empty volume, separate Compose project
so the main data was untouched):** `docker compose up -d --build` created `apex` with all 1,058 records and the checks
passed; a second `up` left it unchanged ("already exists"); `create_database --replace` and `reset_demo` worked both
inside the backend image (`docker compose run --rm seed ...`, no uv needed) and on the host after `uv sync --frozen`;
the test suite passed in the clone (288, plus the bundle scan, which needs a frontend build); a `--no-cache` rebuild
of every image from the lockfiles succeeded and `scripts.e2e_check` passed on it. The clean project and its volume were
then removed.

**End-to-end check:** new `scripts/e2e_check.py` (standard library only; visits 127.0.0.1 only). Final run: data and
answer key correct; 18 views and guide steps × 1440 and 1280 px, all with no console errors, one h1, every control
named, no duplicate ids and no sideways scroll. It also captured the four README screenshots (1440 px, genuine PNGs).

**Security and dependencies (offline review):** no secrets in the tree or history (key, token and private-key patterns;
no `.env` tracked; commits use a GitHub noreply address); fictional contacts use `.example` domains and the Ofcom drama
range 07700 900xxx; ports 127.0.0.1 only and the API unpublished; non-root containers and exact image pins; installs
from lockfiles; GET only (405 otherwise) and parameters validated (422); CSP, nosniff and no-referrer headers confirmed
live. One change: removed the unused, loosely pinned direct dependency `cn` (shadcn's own package; nothing imported it).
Online vulnerability scans (`npm audit`, `pip-audit`) were not run: they contact external services and need approval.

**Names and regulation:** none of the 23 invented organisations' full names is on the Companies House register or found
by web search; some share a first word with real companies (Novacore Limited, Atlas Therapeutics Limited, Corvane Ltd,
Harrowgate Ltd, Halyard Limited, Northmere Limited; Halyard and Mercia are also names of real health-care and investment
businesses). Statutory periods and references checked: CMA Phase 1 40 working days (day 40 = 16 Nov from a 21 Sep start)
and Phase 2 24 weeks; NSI Act 30 working days (ISU, Cabinet Office); EU Phase 1 25 working days (Regulation 139/2004,
Form CO); HSR 30 calendar days; Rule 2.7, Rule 3, Appendix 7 and Part 26. Two wordings proposed for owner decision, not
changed: the "practice statement … 14 days" claim on the scheme claim form, and the Impact preset "Phase 1 clock
extended" (in law the clock stops until an information request is answered).

**Repository:** README (prerequisites, ports, reset commands, troubleshooting, the new screenshots, checked names),
architecture.md (all modules, migrations, running and resetting, e2e), the agents' code map, new CONTRIBUTING.md,
SECURITY.md and a CI workflow (`.github/workflows/ci.yml`, unverified until the first push). The 129 phase-review
screenshots referenced above (§§10-21) moved to the git-ignored `notes/review-screenshots/`: kept locally, not published.
They remain in the git history (about 58 MB of objects); publishing a fresh single-commit history would remove them.

**Owner decisions after the 6H report (2026-10-27):**
- Dependency scans run with approval: `pip-audit` 2.10.1 over all 27 locked Python packages (runtime, test and dev)
  and `npm audit` over all 488 locked web packages: **no known vulnerabilities at any severity**, so nothing to fix.
  Not covered by either scan: the four base images (python, node, nginx-unprivileged, typedb).
- Court timetable wording softened (AC-LEG-CLAIM description only; its dates and dependencies are unchanged).
- The Impact preset now reads "CMA Phase 1 clock stopped": the statutory clock stops for four weeks until an
  information request is answered in full (delay input unchanged at 28 days, so every figure is unchanged).
- Company names kept; an external M&A practitioner review is recommended, not a release blocker.
- Publication uses a separate repository with one initial commit, built from the tracked files of this one, which
  is kept intact with its full history. CLAUDE.md (instructions for AI coding agents, including notes about the
  owner) is left out of it; code comments no longer point readers at the private notes.

**Container image scan before publication (Trivy 0.64.1, owner-approved, 2026-10-27):** HIGH/CRITICAL only; no
CRITICAL anywhere. Fixed: in the backend image, four pip-bundled packages (urllib3 2.7.0, msgpack 1.1.2, setuptools
70.3.0's pkg_resources) by removing pip, which uv-installed Apex never uses; in the web image, brotli-libs (updated)
and curl/libcurl (removed: nothing depends on them). Rescan: 0 in the web image and the backend's Python packages.
Remaining, none with a fix in Apex's control: 44 reports of 8 Debian 13 CVEs in the backend base (util-linux,
ncurses, systemd, acl, perl; Debian has no fix yet; they need privileged mount operations, systemd-homed or unused
libraries, none available to the non-root API); 5 in the official typedb/typedb:3.14.1 image (Ubuntu 22.04 OpenSSL
and gpgv, fixes available upstream), not reachable because the TypeDB server binary links no OpenSSL; for TypeDB to
refresh its image. Tests (289) and the end-to-end check passed on the rebuilt images. CI actions pinned as in
NewsLens's passing workflow (checkout@v7; setup-uv by commit).
