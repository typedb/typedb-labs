# Why TypeDB for deal intelligence

*A short explanation for executives and architects. The technical argument, claim by claim, is in
[schema-design.md §7](schema-design.md).*

## The problem
A large acquisition is a web of connected commitments: who advises whom on what, which approvals gate
which milestones, which contracts carry change-of-control consents, which group companies own which, and
who is accountable for each. The questions that matter cross those connections:

- *If the CMA takes 61 more days, which contractual deadline breaks, and who must act?*
- *What exactly are we buying, and through which chain of companies?*
- *Who is on this deal, and in what capacity?*

In most organisations the answers live in spreadsheets, trackers and people's heads, and are assembled
by hand each time something changes.

## What TypeDB changes

1. **The meaning is in the database, not in code.** A mandate isn't a row in a join table: it is a
   *mandate* relating a *client*, an *adviser* and the *deal*. A regulatory review relates a *reviewer*,
   the *clearance* and the *applicant*. These roles are part of the schema, so every screen, query and
   person sees the same vocabulary, and the data can't contradict it.
2. **Rules are enforced where the data lives.** "One accountable owner per item", "stakes between 0
   and 100%", "only advisers hold mandates": TypeDB rejects data that breaks them, whichever system
   writes it.
3. **Connected questions are one query.** Following an approval through every dependent milestone to
   any depth, or multiplying ownership stakes down a group structure, is a recursive function saved in
   the database. Other queries call it like a built-in, and the Impact Explorer's analysis is built on two of them.
4. **The model grows without rewrites.** A new kind of approval (for example foreign-investment
   screening in Ireland) is one line of schema; every existing query about approvals includes it
   immediately. The optional technical demo shows this live.
5. **Every answer is inspectable.** Each panel's "Show TypeQL" drawer shows the exact queries that
   produced it. Nothing on screen is a hand-maintained copy.

## Where to see each capability in Apex

The TypeDB Advantage panel (top right of every page) shows each of these with schema excerpts read from the
schema files and live figures from TypeDB; the guided demonstration (`/guide`) walks through them in order.

| Capability | Where | What to look at |
|---|---|---|
| Typed, n-ary relationships | Relationship Explorer → Connections (`/explorer?view=paths&from=PER-AINSWORTH&to=ORG-CMA`) | Each step is one relation with its roles; an authority review keeps reviewer, subject and applicant together |
| Recursive functions | Impact Explorer (`/impact?item=CP-CMA&days=61`); group structure (`/explorer?view=group`); Workstreams "Waiting on open work" | `impact_edges`, `downstream`, `upstream`, `group_members`, saved in `schema/functions.tql` |
| Schema constraints | TypeDB Studio steps T1 in docs/demo-script.md; the Overview's data checks | `@card`, `@range`, `@values`, `@key` in `schema/schema.tql`; negation queries as checks |
| Polymorphism | Workstreams activity history; Parties engagement; the Gantt | `$x isa deal-item`, `$e isa deal-event`, `match $t sub engagement;` |
| Relations between relations | Requests and their responses (Workstreams feed, Parties requests) | `reply (original: request, answer: response)` |
| One source of schedule truth | Gantt "Deadline-critical chain", item panel float, Parties, Impact | `impact.schedule_float` over the dependency relations |
| Exact, inspectable queries | Every "Show TypeQL" drawer (pale purple), with capability labels detected from the executed TypeQL | `apex/capabilities.py` |
| Structured context for AI | AI Analyst concept preview (`/analyst`) | Executed steps with their queries, separate from the hypothetical step |

## What this demo does and doesn't claim
- It shows **expressiveness and trust**: typed relationships, rules in the schema, recursive reasoning
  and transparent queries, on a realistic deal. It does **not** demonstrate scale or performance (the
  dataset has about a thousand records; queries take 2-40 ms).
- A skilled SQL team could build the same screens. The difference is how much of the meaning has to be
  rebuilt in application code and in people's heads, and how much stays in the database.
- Two calculations happen outside TypeQL, openly: date arithmetic for projections (TypeQL can't add days
  to a date), and listing ownership routes (which must match TypeDB's own recursive figures exactly).
- Effective ownership assumes no cross-shareholdings; the loader refuses them on purpose. Real groups can
  have them, and they need more sophisticated calculations.
