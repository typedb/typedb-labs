# Project Apex: demonstration script

The in-app **guided demonstration** (`/guide`, eight steps, about six minutes) is the current script for a live walkthrough
or a short recording; its figures are checked against the live data by the tests. Below: the original two parts, a **5–7 minute executive demonstration** in the app, and **optional technical steps** in
TypeDB Studio for technical audiences or follow-up questions. Every figure quoted here comes from the
live data and is checked by the automated tests (see [dataset.md](dataset.md) for the answer key).

> Everything shown is fictional: the companies, people, deal, contracts and events. Real public
> authorities appear only in an invented scenario. Say this once, at the start.

## Before you start (5 minutes, the day before and again on the day)

1. `docker compose up -d --build`, then open **http://127.0.0.1:8091** in a full-screen browser window at
   1440 px or wider (Chrome or Edge). Close other tabs: the screens refresh themselves if the database
   reconnects, but a background tab can delay drawing the graphs.
2. Click through all three screens once, so everything is loaded. Check the top bar shows **"Data as of
   26 Oct 2026"** and no red banner.
3. On the Impact Explorer, press **Reset** (0 days).
4. For the optional steps only: see "Optional technical steps" below. Never run them against `apex`.
5. Light theme, browser zoom 100% (or 110% for a large room).

## Executive demonstration (5–7 minutes)

| # | Time | Screen and clicks | Say | What TypeDB is doing |
|---|---|---|---|---|
| 1 | 0:00 | **Deal Overview**: the header | "This is a fictional £2.4 billion acquisition: Novacore buying Atlas Biopharma by scheme of arrangement. It's at risk: two of six conditions are outstanding, and the CMA clearance is the problem." | One query fetches the acquisition with both parties, typed by role (*acquirer*, *target*). |
| 2 | 0:45 | Scroll: key metrics, the **Deal schedule** (Gantt), **Regulatory approvals**, then **Deal participants** | "Every number is live from the database: 4 of 6 conditions, £1.8 billion of committed bridge funding, the next deadline in 97 days. These are the 22 organisations and 42 people working on the deal, grouped by the part they play (the Explorer also shows the Atlas group companies, Helix and Calder)." Point at **Attention needed**: "and the data checks itself: three rules, all passing." | The checks are TypeQL queries that look for what *isn't* there (an item with no accountable owner, a clearance nobody is reviewing). |
| 3 | 1:30 | **Relationship Explorer** → click the dashed line from **Novacore plc** to the **Competition and Markets Authority** | "This isn't a two-way link. A regulatory review is one fact with three parties: the CMA as *reviewer*, the UK merger clearance as *subject*, Novacore as *applicant*, with its legal basis." Then click **Blackwood Marsh LLP**: "Their mandate links three things too: the adviser, the client and the deal itself, and here are their two people and what they're responsible for." | Relations keep their role names and all their players (n-ary relations). The legend and filters come from the schema's type hierarchy. |
| 4 | 2:30 | Switch to **Atlas Biopharma plc group structure** (Atlas IP Holdings is already selected) | "What exactly is Novacore buying? Atlas owns 90% of its IP company, but not directly: 70% through its UK operating company, and 20% through the US company. Two routes, added up." Hover each route to trace it. "The joint venture that makes the lead product is 60% owned; Helix owns the rest." | A recursive function walks the ownership chain, multiplying stakes along each route. Guard queries run first and refuse to give figures if the data has a loop. |
| 5 | 3:30 | **Impact Explorer** → preset **61d** | "Now the question a deal team actually asks. The CMA takes 61 more days. Sixteen items move after it, and one contractual deadline breaks." | A recursive function follows every hard dependency from the CMA clearance, to any depth. |
| 6 | 4:15 | Point at the red **Helix waiver** card, then click its box in **Dependency chain** | "Helix's waiver of its change-of-control rights was conditional on completion by 31 January. At 61 days we miss it by one day. That's a *potential exposure*, not an automatic outcome: if Helix exercised its option, Novacore could lose control of manufacturing. That's a judgement for the lawyers. And here is exactly why it breaks, and who acts: Daniel Okafor is accountable, Charlotte Ainsworth at Blackwood Marsh is responsible." | The same recursion finds who holds responsibility on everything the delay reaches. The deadline's consequence is stored with it, and the database knows it is owed inside the target group. |
| 7 | 5:15 | Preset **168d** ("CMA Phase 2 reference") | "If it goes to a full Phase 2, all three deadlines break: the Helix waiver, the long-stop date, and the bridge funding expires before shareholders are paid. The red marks on the slider are where the data says each one breaks; nobody typed them in." | The thresholds (61, 120, 136 days) are found by searching the projection over stored dates and dependencies. |
| 8 | 6:00 | Scroll to **Dependency chain** → **Show TypeQL** | "And this is how it works: the recursive function, saved in the database, and every query that ran for this screen, in a read-only transaction. Nothing here is a slide." | `impact_edges` and `downstream` are saved in the schema; every answer carries the exact queries that produced it. |
| — | 6:30 | Close | "A good SQL team could build this. The difference is how much of the meaning lives in the database, enforced and inspectable, instead of in code, spreadsheets and people's heads." | |

Say once, at step 4: *"Effective ownership here assumes no cross-shareholdings. Real groups can have
them, and they need more sophisticated calculations. Our loader refuses them, on purpose."*

**If something goes wrong:** a red banner means the database isn't answering. Run
`docker compose up -d`; the screens refresh by themselves within a few seconds. Everything is local:
no internet connection is needed during the demo.

## Optional technical steps (in TypeDB Studio, on `apex-demo`, 5–8 minutes)

**Set up (once, before the session).** Rebuild the demo copy, point the app at it, and restart the API:

```bash
uv run python -m scripts.reset_demo
```

```bash
printf "APEX_DATABASE=apex-demo\n" > .env
```

```bash
docker compose up -d api
```

http://127.0.0.1:8091/api/health now says `"database":"apex-demo"`. In TypeDB Studio, connect to
`http://localhost:8003` (username `admin`, TypeDB's default password unless you changed it) and select
`apex-demo`.

### T1. The schema refuses bad data (~3 minutes)
Run each in a **write** transaction and commit. Each is **rejected** and nothing is saved.

| Try | TypeQL | TypeDB answers | Point |
|---|---|---|---|
| A second Accountable on the CMA clearance | `match $x isa regulatory-clearance, has code "CP-CMA"; $p isa person, has code "PER-SHAW"; insert accountability (holder: $p, accountable-item: $x);` | `[CNT5] @card(0..1) violated` | "One owner per item" is a database rule |
| A 150% shareholding | `match $a isa company, has code "ORG-HELIX"; $b isa company, has code "ORG-ATL-JV"; insert ownership (owner: $a, owned: $b), has stake 1.5dec;` | `[CNT7] @range violated` | Stakes must be 0–100% |
| A status word that isn't allowed | `match $x isa milestone, has code "MS-DAY1", has status $s; delete has $s of $x; insert $x has status "nearly-done";` | `[CNT8] @values violated` | Only agreed status words |
| The CMA as an adviser | `match $cma isa regulator, has code "ORG-CMA"; $nov isa company, has code "ORG-NOV"; $d isa acquisition; insert mandate (client: $nov, adviser: $cma, engagement: $d), has code "MAN-CMA";` | `[INF11]` type error, before any data is touched | Roles say who may play them |
| The CMA clearance in a second workstream | `match $x isa regulatory-clearance, has code "CP-CMA"; $ws isa workstream, has code "WS-LEG"; insert work-breakdown (whole: $ws, part: $x);` | `[CNT5] @card(0..1) violated` | Each item has one home |

Be precise: ownership **cycles** are refused by the loader's guard queries, not by the schema itself.

### T2. Extend the model live (~3 minutes)
A new kind of approval: Irish foreign-investment screening (the Screening of Third Country Transactions
Act 2023, administered by the Department of Enterprise, Tourism and Employment). That it applies to this
deal is a fictional assumption: the joint venture and Atlas Biologics are in Ireland, and a UK acquirer is
a third-country investor for EU purposes.

1. **Schema** transaction:
   ```typeql
   define entity investment-screening-clearance sub regulatory-clearance;
   ```
2. **Write** transaction (a clearance with an owner and a dependency, but **no reviewing authority yet**):
   ```typeql
   match $ws isa workstream, has code "WS-REG"; $okafor isa person, has code "PER-OKAFOR";
         $shaw isa person, has code "PER-SHAW"; $court isa court-sanction, has code "CP-COURT";
   insert $c isa investment-screening-clearance, has code "CP-IE-SCREEN",
            has name "Irish investment screening clearance", has status "in-progress",
            has criticality "high", has due-date 2026-11-20, has progress 40,
            has legal-basis "Screening of Third Country Transactions Act 2023";
          work-breakdown (whole: $ws, part: $c);
          accountability (holder: $okafor, accountable-item: $c);
          responsibility (holder: $shaw, item: $c);
          gating (prerequisite: $c, dependent: $court), has lag-days 14;
   ```
3. Refresh the app. The new clearance appears in **Regulatory approvals** ("No reviewing authority
   recorded"), and **Attention needed** flags "Clearance with no reviewing authority". The Impact Explorer
   offers it as an approval to delay, and a 30-day delay to it moves 17 items (the clearance and 16 after it:
   the court hearing slips 34 days because of the 14-day lag). **No query was changed.**
4. **Write** transaction (add the reviewing authority):
   ```typeql
   match $c isa investment-screening-clearance, has code "CP-IE-SCREEN"; $nov isa company, has code "ORG-NOV";
   insert $dete isa regulator, has code "ORG-DETE", has name "Department of Enterprise, Tourism and Employment",
            has jurisdiction "IE", has sector "Investment screening";
          authority-review (reviewer: $dete, subject: $c, applicant: $nov),
            has legal-basis "Screening of Third Country Transactions Act 2023", has review-phase "Screening (90 days)";
   ```
   Refresh: the check clears and the review appears.

Point: new kinds of things slot into the hierarchy, and every query that asks about the parent type
picks them up.

### T3. A recursive query by hand (~1 minute, very technical audiences)
Read transaction:
```typeql
match $start isa deal-item, has code "CP-CMA"; let $x in downstream($start); $x has name $n;
fetch { "affected": $n };
```
The 17 items a CMA delay can reach, to any depth, from a function saved in the schema.

### Afterwards (always)
Reset the demo copy, remove the local setting, and point the app back at `apex`:

```bash
uv run python -m scripts.reset_demo
```

```bash
rm .env
```

```bash
docker compose up -d api
```

Every step above was rehearsed on 2026-10-27 with exactly these results, then reset; T1–T3 were rehearsed again
on the Phase 6A.2 data (T2's figure changed from 15 to 17 items: two new activities with slack also move).
