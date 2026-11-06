// The concepts the TypeQL overlay says a query explores are read from the query text: check the reader on the
// shapes of query the API runs.

import { describe, expect, it } from "vitest";
import { concepts } from "./typeql";

describe("reading the concepts a query uses", () => {
  it("finds the relation, its roles and the recursive function in a system query", () => {
    const c = concepts(`match
  $s isa system, has system-id "propulsion";
  let $c in system_components($s);
fetch { "id": $c.component-id, "name": $c.name,
        "systems": [ match system-membership (system: $o, member: $c); fetch { "id": $o.system-id, "name": $o.name }; ] };`);
    expect(c.types).toEqual(["system"]);
    expect(c.relations).toEqual([{ name: "system-membership", roles: ["system", "member"] }]);
    expect(c.functions).toEqual(["system_components"]);
    expect(c.attributes).toEqual(["system-id", "component-id", "name"]);
  });

  it("takes a links pattern's relation type from the statement's isa, or names the variable when the type is one", () => {
    expect(concepts("match $loop isa control-loop, links ($role: $c), links (controlled-system: $s);").relations)
      .toEqual([{ name: "control-loop", roles: ["any role", "controlled-system"] }]);
    expect(concepts("match $r isa! $kind, links (endpoint: $c, endpoint: $other);").relations)
      .toEqual([{ name: "any $kind", roles: ["endpoint"] }]);
  });

  it("counts a relation matched with isa as a relation, not an entity type", () => {
    const c = concepts(`match $d isa dependency (provider: $p, required-function: $g, dependent: $c, affected-function: $f),
      has dependency-kind $kind; not { fallback (protected: $d); };`);
    expect(c.types).toEqual([]);
    expect(c.relations.map((r) => r.name)).toEqual(["dependency", "fallback"]);
    expect(c.attributes).toEqual(["dependency-kind"]);
  });

  it("reads schema queries: label and sub", () => {
    expect(concepts("match $t label brake-caliper; $t sub $s; $s sub component; fetch { \"s\": $s };").types)
      .toEqual(["brake-caliper", "component"]);
  });
});
