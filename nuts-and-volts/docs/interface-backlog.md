# Interface backlog: making TypeDB's capabilities obvious

Goal (owner, 30 October 2026): the finished experience should make TypeDB's semantic capabilities
obvious **without requiring users to discover them through individual components**. Today every question
starts from a selected part. These items give TypeDB's structure its own entry points. Each one is backed
by named, read-only TypeQL queries in the API, with "show the TypeQL", as now.

Not scheduled yet: to be planned into a phase after the exterior and mechanical work (the cinematic and
presentation work in Phase E is the natural home).

| Item | What the viewer gets | TypeDB capability it shows | API today |
|---|---|---|---|
| **System browser** | A list or tree of every functional system (propulsion, braking, automated driving...) with sub-systems; choosing one highlights its components and lists its control loops | Functional organisation independent of physical layout; one component in several systems; recursive sub-system membership | `/api/systems`, `/api/systems/{id}` exist; no UI |
| **Assembly browser** | The physical tree (vehicle > chassis > front-right wheel end > ...), navigable without clicking the model; choosing a node highlights it and can drive the explosion | Hierarchical relations with recursive functions | `/api/assemblies/{id}` exists; needs a tree endpoint |
| **Type hierarchy explorer** | The component type tree (component > sensor > camera...) with counts; choosing "every sensor" highlights all of them | Type inheritance and polymorphic queries: one query for all subtypes | New endpoint (schema query) |
| **Schema view** | The schema itself: entities, relations with their roles, attributes, and which types may play which roles (e.g. only control units can be controllers) | Schema-first modelling, roles and constraints (decision 0001 lists "schema definitions" as an API query) | New endpoint |
| **Aggregate questions** | Computed answers: pack energy (sum of module capacities, 100 kWh), component counts per system or type, total actuators per control loop | `reduce` aggregates (sum, count, group by) | New named queries |
| **Cross-cutting questions** | Ready-made questions such as "which components serve more than one system?", "which sensors feed more than one control loop?", "what connects the battery to the front wheels?" | Multi-hop joins, path finding through relations | New named queries |
| **Dependency semantics** | Impact answers that distinguish loss from degradation and name the lost function (see docs/dependency-semantics.md) | Functions reasoning over typed, attributed relations | Needs the proposed schema changes first |
| **Guided tour** | A short sequence (pick a system, follow a failure, compare types) for first-time and conference audiences | All of the above, in order | Presentation only |

Principles to keep: every highlighted set comes from a TypeDB answer; no hard-coded lists in the
front end; perspectives stay deterministic and reversible; "TypeDB unavailable" is explicit.
