# TypeDB issue: query planner fails (QPL1) on a disjunction with an `is` branch

For review with the TypeDB engineering team. Found 30 October 2026 in the Noodlelab Visual Explorer.

## Environment

- Server: **TypeDB CE 3.14.1** (`typedb/typedb:3.14.1`, image digest
  `sha256:d39d4f29eb571ee856cb221e8175b76dcb96dfa39939ebde5360cffa0e5bb680`; the log says "Running TypeDB CE 3.14.1").
- Platform: Docker Desktop on macOS, Apple M2 Pro (linux/arm64 image).
- Client: Python `typedb-driver` 3.14.0, Python 3.13, READ transaction. Same error whatever the client
  (it is raised while compiling the query).

## Minimal reproduction

Self-contained script: [`qpl1_repro.py`](qpl1_repro.py) (creates and deletes its own database).

```
define
  attribute code, value string;
  entity group, owns code @key, plays membership:parent, plays membership:member;
  relation membership, relates parent, relates member;

insert
  $a isa group, has code "a";
  $b isa group, has code "b";
  membership (parent: $a, member: $b);
```

```
match $s isa group, has code "a";
  { $x is $s; } or { membership (parent: $s, member: $x); };
fetch { "x": $x.code };
```

## Expected

Two answers: `$x` = group `a` (the first branch) and group `b` (the member, from the second branch).
The intent, "the group and its direct members", is common: the same shape appears whenever a
question covers "this node and its children".

## Actual

The query fails to compile:

```
[QPL1] Planning failed as no valid pattern ordering was found by the query planner (this is a bug!)
Caused: [MCP1] Error during planning of match stage.
Caused: [ECP5] Error compiling match stage into executable.
Caused: [QEX10] Error compiling query.
```

Variations tried:

| Variation | Result |
|---|---|
| As above | QPL1 |
| Restating the type in the branch: `{ membership (parent: $s, member: $x); $x isa group; }` | QPL1 |
| `$x` bound by a function in the second branch: `{ $x is $s; } or { let $x in some_function($s); }` | **Works** (we use this form for assembly ancestry) |
| The `is` branch removed (only the relation) | Works |

So the failure seems specific to an `is` branch combined with a branch that binds the same variable
through a relation pattern.

## Working alternative

Repeat the downstream pattern inside each branch instead of unifying the variable through `is`:

```
match $s isa group, has code "a";
  { $s has code $c; } or { membership (parent: $s, member: $x); $x has code $c; };
fetch { "x": $c };
```

Returns `a` and `b`. In the application (`api/explorer/queries.py`, `system()`), the control loops of a
system and of its sub-systems are fetched this way:

```
{ $loop isa control-loop, links (controlled-system: $s); }
or { system-membership (system: $s, member: $sub); $sub isa system;
     $loop isa control-loop, links (controlled-system: $sub); };
```

## Suggested fix

The planner should be able to order a disjunction where one branch binds `$x` by identity with an
already-bound variable (`$x is $s`) and the other binds it through a relation. Failing that, the error
could name the branch and suggest the rewrite above, rather than reporting an internal bug.

Also recorded in the shared TypeDB feedback log (`../typedb-cyber-intel/notes/typedb-feedback.md`, item 13).
