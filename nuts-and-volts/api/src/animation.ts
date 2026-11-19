// Generate the explosion's grouping file from TypeDB (an animation asset, not a source of facts).
//
//     docker compose run --rm --no-deps api npm run -s animation > web/src/vehicle/explosion-groups.json
//
// The exploded view moves each assembly relative to its parent and each part within its assembly, so the
// animation needs the assembly tree. Decision 0001 allows choreography to be precomputed; this file is that
// precomputation, written from TypeDB's assembly-membership relations. The web app uses it only to time and
// group movements, never to display anything. tests/architecture.test.ts fails if it no longer matches TypeDB.

import { sortBy } from "./python.ts";
import type { Doc } from "./queries.ts";
import type { Tx } from "./typedb.ts";

export interface ExplosionGroups {
  assemblies: Record<string, string | null>;
  components: Record<string, string>;
}

/** {"assemblies": {assembly: parent or null}, "components": {component: assembly}}, sorted by id. */
export async function explosionGroups(tx: Tx): Promise<ExplosionGroups> {
  const assemblies = await tx.docs<Doc>(`
        match $a isa assembly, has assembly-id $id;
        fetch { "id": $id, "parent": [ match assembly-membership (assembly: $p, member: $a); fetch { "id": $p.assembly-id }; ] };
    `);
  const components = await tx.docs<Doc>(`
        match
          $c isa component, has component-id $id;
          assembly-membership (assembly: $a, member: $c);
        fetch { "id": $id, "assembly": $a.assembly-id };
    `);
  return {
    assemblies: Object.fromEntries(sortBy(assemblies, (a) => a.id).map((a) => [a.id, a.parent.length ? a.parent[0].id : null])),
    components: Object.fromEntries(sortBy(components, (c) => c.id).map((c) => [c.id, c.assembly])),
  };
}

export function render(groups: ExplosionGroups): string {
  const note = "GENERATED from TypeDB by `npm run animation` (api/src/animation.ts). Animation asset: "
    + "used only to group and time the explosion, never displayed. Regenerate after changing assemblies.";
  return JSON.stringify({ _generated: note, ...groups }, null, 1) + "\n";
}
