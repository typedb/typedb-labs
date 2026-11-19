// The named, read-only questions the API can ask TypeDB. Nothing else is ever run.
//
// Every function takes an open recording transaction (READ) and validated identifiers, and returns plain data.
// The transaction records each query as it runs, so the API can show the exact TypeQL behind every answer.
// The TypeQL is the Python backend's, character for character; only the plumbing around it changed.

import { Double } from "./json.ts";
import { sortBy, sorted, without } from "./python.ts";
import { isDouble } from "./schema.ts";
import { string, type Tx } from "./typedb.ts";
import type {
  AssemblyDetails, AssemblyNode, ComponentAssembly, ComponentDetails, ComponentListing, ComponentRelationships,
  ComponentSystem, Impact, Named, Reached, Requirement, SchemaDefinition, SystemDetails, SystemSummary, TypeDetail, TypeNode,
} from "./models.ts";

// A fetch document: plain JSON from TypeDB. Typed loosely, as the Python dicts were.
export type Doc = Record<string, any>;

// The attributes every component has; everything else a component owns is an engineering property.
const IDENTITY = new Set(["component-id", "name", "description"]);

export class NotFound extends Error {}

function one<T>(results: T[], what: string): T {
  if (!results.length) throw new NotFound(what);
  return results[0];
}

/** A type's label, whether TypeDB wrote the type as an object or a plain label. */
export function label(t: unknown): string {
  return typeof t === "object" && t !== null ? (t as { label: string }).label : (t as string);
}

/** An attribute value as the Python backend serialised it: a double gets a decimal point. */
function typed(attribute: string, value: unknown): unknown {
  return isDouble(attribute) && typeof value === "number" ? new Double(value) : value;
}

// ---- Components -----------------------------------------------------------------------------------------

/** Every component with its type and the 3D object that draws it. */
export async function componentList(tx: Tx): Promise<ComponentListing[]> {
  const found = await tx.docs<Doc>(`
        match
          $c isa! $type, has component-id $id, has name $name;
          $type sub component;
          visual-representation (represented: $c, asset: $asset), has node-key $node;
          $asset has asset-name $asset-name;
        fetch { "id": $id, "name": $name, "type": $type, "asset": $asset-name, "node": $node };
    `, "every component with its most specific type and the 3D object that draws it", true);
  return sortBy(found.map((c) => ({ ...c, type: label(c.type) }) as ComponentListing), (c) => c.id);
}

/** Identity, type (with its supertypes, most specific first) and engineering properties. */
export async function component(tx: Tx, componentId: string): Promise<ComponentDetails> {
  const cid = string(componentId);
  const doc = one(await tx.docs<Doc>(`
        match $c isa! $type, has component-id ${cid};
        fetch { "type": $type, "attributes": { $c.* } };
    `, "the component's most specific type and every attribute it owns", true), `component ${componentId}`);
  const supertypes = await tx.docs<Doc>(`
        match
          $c isa! $type, has component-id ${cid};
          $type sub $super;
          $super sub! $parent;
        fetch { "type": $super, "parent": $parent };
    `, "each supertype of its type with that supertype's direct parent");
  tx.note("TypeScript orders the supertypes into a chain, most specific first, and separates the identity "
    + "attributes (id, name, description) from the engineering properties.");
  const parents = new Map(supertypes.map((s) => [label(s.type), label(s.parent)]));
  const chain = [label(doc.type)];
  while (parents.has(chain[chain.length - 1])) chain.push(parents.get(chain[chain.length - 1])!);
  const attributes: Doc = doc.attributes;
  const properties = sorted(Object.keys(attributes)).filter((name) => !IDENTITY.has(name))
    .map((name) => ({ attribute: name, value: typed(name, attributes[name]) as string | number | Double }));
  return {
    id: attributes["component-id"],
    name: attributes.name ?? null,
    description: attributes.description ?? null,
    type: chain[0],
    types: chain,
    properties,
  };
}

/** The assembly the component sits in, and every assembly above it (nearest first). */
export async function componentAssembly(tx: Tx, componentId: string): Promise<ComponentAssembly> {
  const cid = string(componentId);
  const direct = one(await tx.docs<Named>(`
        match
          $c isa component, has component-id ${cid};
          assembly-membership (assembly: $direct, member: $c);
        fetch { "id": $direct.assembly-id, "name": $direct.name };
    `, "the assembly the component is a direct member of (assembly-membership)", true), `component ${componentId}`);
  const edges = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          assembly-membership (assembly: $direct, member: $c);
          { $a is $direct; } or { let $a in assembly_ancestors($direct); };
          assembly-membership (assembly: $parent, member: $a);
        fetch { "child": $a.assembly-id, "parent": $parent.assembly-id, "parent-name": $parent.name };
    `, "every assembly above it with its parent, through the recursive function assembly_ancestors");
  tx.note("TypeScript follows the parent links from the direct assembly up to the vehicle.");
  const up = new Map<string, Named>(edges.map((e) => [e.child, { id: e.parent, name: e["parent-name"] }]));
  const path = [direct];
  while (up.has(path[path.length - 1].id)) path.push(up.get(path[path.length - 1].id)!);
  return { assembly: direct, path };
}

/** The systems the component takes part in, each with its parent systems (nearest first). */
export async function componentSystems(tx: Tx, componentId: string): Promise<ComponentSystem[]> {
  const cid = string(componentId);
  const direct = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          system-membership (system: $s, member: $c);
        fetch { "id": $s.system-id, "name": $s.name, "description": $s.description };
    `, "the systems the component is a direct member of (system-membership)", true);
  const edges = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          system-membership (system: $s, member: $c);
          { $x is $s; } or { let $x in system_ancestors($s); };
          system-membership (system: $parent, member: $x);
        fetch { "child": $x.system-id, "parent": $parent.system-id, "parent-name": $parent.name };
    `, "the systems above each of those, through the recursive function system_ancestors");
  tx.note("TypeScript follows the parent links from each system to the top.");
  const up = new Map<string, Named>(edges.map((e) => [e.child, { id: e.parent, name: e["parent-name"] }]));
  const result: ComponentSystem[] = [];
  for (const s of sortBy(direct, (s) => s.id)) {
    const parents: Named[] = [];
    while (up.has(parents.length ? parents[parents.length - 1].id : s.id)) {
      parents.push(up.get(parents.length ? parents[parents.length - 1].id : s.id)!);
    }
    result.push({ ...(s as Named & { description: string | null }), parents });
  }
  return result;
}

/** Direct connections, dependencies in both directions, and control loops the component is part of. */
export async function componentRelationships(tx: Tx, componentId: string): Promise<ComponentRelationships> {
  const cid = string(componentId);
  if (!(await tx.rows(`match $c isa component, has component-id ${cid};`, "check that the component exists")).length) {
    throw new NotFound(`component ${componentId}`);
  }
  const connections = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          $r isa! $kind, links (endpoint: $c, endpoint: $other);
          $other isa! $other-type;
        fetch { "kind": $kind, "other": $other.component-id, "other-name": $other.name, "other-type": $other-type,
                "details": { $r.* } };
    `, "every connection relation (any subtype) linking the component to another as endpoints", true);
  const dependencyFields = ` "family": $family, "kind": $kind, "function": $f.function-name, "needs": $g.function-name,
                "loss": $d.loss-effect, "degradation": $d.degradation-effect, "description": $d.description,
                "fallback": [ match fallback (protected: $d, backup: $b); fetch { "id": $b.component-id, "name": $b.name }; ] `;
  const needs = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          $d isa! $family, links (dependent: $c, affected-function: $f, provider: $p, required-function: $g), has dependency-kind $kind;
        fetch { "id": $p.component-id, "name": $p.name, ${dependencyFields} };
    `, "dependencies where the component is the dependent: what its functions need", true);
  const neededBy = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          $d isa! $family, links (provider: $c, required-function: $g, dependent: $p, affected-function: $f), has dependency-kind $kind;
        fetch { "id": $p.component-id, "name": $p.name, ${dependencyFields} };
    `, "dependencies where the component is the provider: what needs its functions", true);
  for (const dep of [...needs, ...neededBy]) dep.family = label(dep.family).replace("-dependency", "");
  const loops = await tx.docs<Doc>(`
        match
          $c isa component, has component-id ${cid};
          $loop isa control-loop, links ($role: $c), links (controlled-system: $s);
        fetch { "name": $loop.name, "description": $loop.description, "role": $role,
                "system": $s.system-id, "system-name": $s.name };
    `, "control loops the component plays a role in (controller, sensor or actuator)");
  tx.note("TypeScript sorts the lists and shortens type and role labels for display.");
  for (const c of connections) {
    c.kind = label(c.kind);
    c["other-type"] = label(c["other-type"]);
  }
  for (const loop of loops) loop.role = label(loop.role).split(":").pop();
  const byName = (items: Doc[]) => sortBy(items, (x) => [x.kind ?? "", x["other-name"] || x.name || "", x.function ?? ""]);
  return {
    connections: byName(connections) as ComponentRelationships["connections"],
    needs: byName(needs) as ComponentRelationships["needs"],
    "needed-by": byName(neededBy) as ComponentRelationships["needs"],
    "control-loops": sortBy(loops, (x) => x.name) as ComponentRelationships["control-loops"],
  };
}

interface Step extends Doc {
  from: string;
  needs: string;
  to: string;
  "to-name": string;
  function: string;
  kind: string;
}

const pair = (component: string, fn: string) => `${component}\u0000${fn}`;

/**
 * Steps from the start along (provider, function) -> (dependent, function) edges, breadth first.
 *
 * The failed component counts as having lost all its functions, so every edge leaving it is a first step.
 * Returns {(component, function): (steps, edge that first reached it)}.
 */
function stepsFrom(start: string, edges: Step[]): Map<string, { steps: number; edge: Step }> {
  // TypeDB returns answers in no particular order: sort, so that when two equally short paths reach a function the
  // same one is reported every time, on any database holding the same data.
  edges = sortBy(edges, (e) => [e.from, e.needs, e.to, e.function, e.kind ?? ""]);
  const out = new Map<string, Step[]>();
  for (const e of edges) {
    const k = pair(e.from, e.needs);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(e);
  }
  const reached = new Map<string, { steps: number; edge: Step }>();
  let frontier = edges.filter((e) => e.from === start);
  let steps = 1;
  while (frontier.length) {
    const next: Step[] = [];
    for (const e of frontier) {
      const key = pair(e.to, e.function);
      if (!reached.has(key) && e.to !== start) {
        reached.set(key, { steps, edge: e });
        next.push(...(out.get(key) ?? []));
      }
    }
    frontier = next;
    steps += 1;
  }
  return reached;
}

/**
 * Multi-step, function by function: what is lost, what is degraded and which fallbacks take over if this
 * component fails (docs/dependency-semantics.md, C1). Reasoning runs in TypeDB (lost_steps, degraded_steps).
 */
export async function componentImpact(tx: Tx, componentId: string): Promise<Impact> {
  const cid = string(componentId);
  if (!(await tx.rows(`match $c isa component, has component-id ${cid};`, "check that the component exists")).length) {
    throw new NotFound(`component ${componentId}`);
  }
  const stepFields = ` "from": $p.component-id, "needs": $g.function-name, "to": $c.component-id, "to-name": $c.name,
                "function": $f.function-name, "kind": $kind `;
  const lost = await tx.docs<Step>(`
        match
          $start isa component, has component-id ${cid};
          let $p, $g, $c, $f in lost_steps($start);
          dependency (provider: $p, required-function: $g, dependent: $c, affected-function: $f), has dependency-kind $kind;
        fetch { ${stepFields} };
    `, "every dependency step that loses a function, through the recursive function lost_steps", true);
  // Degraded steps also carry their dependency's loss effect and fallbacks: a fallback is "in use" when its
  // dependency's provider function is lost (worked out below from the lost steps, without a third recursive query).
  const degraded = await tx.docs<Step & { "provider-name": string; loss: string; fallback: Doc[] }>(`
        match
          $start isa component, has component-id ${cid};
          let $p, $g, $c, $f in degraded_steps($start);
          $d isa dependency (provider: $p, required-function: $g, dependent: $c, affected-function: $f), has dependency-kind $kind,
            has loss-effect $loss;
        fetch { ${stepFields}, "provider-name": $p.name, "loss": $loss,
                "fallback": [ match fallback (protected: $d, backup: $b), has description $why;
                              fetch { "id": $b.component-id, "name": $b.name, "description": $why }; ] };
    `, "every step that only degrades a function, through degraded_steps, with its fallbacks", true);
  const lostPairs = new Set(lost.map((e) => pair(e.to, e.function)));
  const fallbacks: Impact["fallbacks"] = [];
  for (const e of degraded) {
    if (e.loss === "lost" && (e.from === componentId || lostPairs.has(pair(e.from, e.needs)))) {
      for (const b of e.fallback) {
        if (b.id !== componentId) {
          fallbacks.push({ id: e.to, name: e["to-name"], function: e.function, provider: e.from, "provider-name": e["provider-name"],
            needs: e.needs, backup: b.id, "backup-name": b.name, description: b.description });
        }
      }
    }
  }
  // Every function each component has (as a provider or a dependent), to show what an affected part keeps.
  const functions = await tx.docs<{ id: string; name: string; function: string }>(`
        match
          $c isa component;
          { dependency (dependent: $c, affected-function: $f); } or { dependency (provider: $c, required-function: $f); };
        fetch { "id": $c.component-id, "name": $c.name, "function": $f.function-name };
    `, "every function each component has, to show what an affected part keeps");
  tx.note("TypeScript counts steps from the failed part (breadth first over the returned steps), groups "
    + "functions per part into lost, degraded and kept, and works out which fallbacks are in use.");
  const has = new Map<string, Set<string>>();
  for (const x of functions) {
    if (!has.has(x.id)) has.set(x.id, new Set());
    has.get(x.id)!.add(x.function);
  }
  const lostKeys = lostPairs;
  const reached = stepsFrom(componentId, [...lost, ...degraded]);

  const item = (key: string): Reached & { "via-function": string } => {
    const { steps, edge: e } = reached.get(key)!;
    const [id, fn] = key.split("\u0000");
    return { id, name: e["to-name"], function: fn, steps, via: e.from, "via-function": e.needs, kind: e.kind };
  };
  const order = (x: Reached) => [x.steps, x.name, x.function];
  const uniqueFallbacks = new Map<string, Impact["fallbacks"][number]>();
  for (const f of fallbacks) uniqueFallbacks.set(`${f.id}\u0000${f.function}\u0000${f.backup}`, f);
  const lostItems = sortBy([...reached.keys()].filter((k) => lostKeys.has(k)).map(item), order);
  const degradedItems = sortBy([...reached.keys()].filter((k) => !lostKeys.has(k)).map(item), order);
  // Per component: which of its functions are lost, degraded, or kept. A failure usually takes functions,
  // not whole components (the failed part itself is the exception: it loses everything).
  const components = new Map<string, Impact["components"][number]>();
  for (const x of [...lostItems, ...degradedItems]) {
    if (!components.has(x.id)) components.set(x.id, { id: x.id, name: x.name, steps: x.steps, lost: [], degraded: [], kept: [] });
    const c = components.get(x.id)!;
    c[lostKeys.has(pair(x.id, x.function)) ? "lost" : "degraded"].push(x.function);
    c.steps = Math.min(c.steps, x.steps);
  }
  for (const c of components.values()) c.kept = without(has.get(c.id) ?? [], c.lost, c.degraded);
  const failedName = functions.find((x) => x.id === componentId)?.name ?? null;
  const propulsion = await propulsionAfter(tx, lostKeys, new Set(degradedItems.map((x) => pair(x.id, x.function))), componentId);
  return {
    failed: { id: componentId, name: failedName, functions: sorted(has.get(componentId) ?? []) },
    components: sortBy(components.values(), (c) => [c.lost.length ? 0 : 1, c.steps, c.name]),
    lost: lostItems,
    degraded: degradedItems,
    fallbacks: sortBy(uniqueFallbacks.values(), (f) => [f.name, f.function]),
    propulsion,
  };
}

/**
 * Axle-level and vehicle-level propulsion after a failure (docs/dependency-semantics.md, C3b). Which tyres
 * each axle drives comes from TypeDB: the drive-torque chain from each axle-drive system's drive shafts
 * through hub and wheel to the tyre. An axle is lost when all its tyres lose drive torque, reduced when any
 * is degraded or only some are lost; the vehicle is lost only when every axle is.
 */
async function propulsionAfter(tx: Tx, lost: Set<string>, degraded: Set<string>, failed: string): Promise<Impact["propulsion"]> {
  const rows = await tx.docs<{ system: string; name: string; tyre: string }>(`
        match
          $sys isa system, has system-id $sid, has name $sname;
          system-membership (system: $sys, member: $h); $h isa drive-shaft;
          $dt isa vehicle-function, has function-name "drive torque";
          dependency (provider: $h, required-function: $dt, dependent: $hub, affected-function: $dt);
          dependency (provider: $hub, required-function: $dt, dependent: $w, affected-function: $dt);
          dependency (provider: $w, required-function: $dt, dependent: $t, affected-function: $dt); $t isa tyre;
        fetch { "system": $sid, "name": $sname, "tyre": $t.component-id };
    `, "which tyres each axle-drive system drives, along the drive-torque dependency chain");
  tx.note("TypeScript decides per axle whether drive is lost, reduced or kept from the tyres' states.");
  const axles = new Map<string, { system: string; name: string; tyres: Set<string> }>();
  for (const r of rows) {
    if (!axles.has(r.system)) axles.set(r.system, { system: r.system, name: r.name, tyres: new Set() });
    axles.get(r.system)!.tyres.add(r.tyre);
  }
  const out: Impact["propulsion"]["axles"] = [];
  for (const a of sortBy(axles.values(), (a) => a.system)) {
    const tyres = sorted(a.tyres);
    const nLost = tyres.filter((t) => lost.has(pair(t, "drive torque")) || t === failed).length;
    const nDegraded = tyres.filter((t) => degraded.has(pair(t, "drive torque"))).length;
    const state = nLost === tyres.length ? "lost" : nLost || nDegraded ? "reduced" : "kept";
    out.push({ system: a.system, name: a.name, tyres, lost: nLost, degraded: nDegraded, state });
  }
  const states = out.map((a) => a.state);
  const vehicle = states.length && states.every((s) => s === "lost") ? "lost" : states.some((s) => s !== "kept") ? "reduced" : "kept";
  return { axles: out, vehicle };
}

/**
 * Multi-step: every (component, function) this component's functions rely on, directly or indirectly, and how
 * much each matters: essential (its loss loses the function), backed up (a fallback exists) or supporting
 * (its loss only degrades).
 */
export async function componentRequirements(tx: Tx, componentId: string): Promise<{ required: Requirement[] }> {
  const cid = string(componentId);
  if (!(await tx.rows(`match $c isa component, has component-id ${cid};`, "check that the component exists")).length) {
    throw new NotFound(`component ${componentId}`);
  }
  const edges = await tx.docs<Step & { loss: string; fallback: Doc[] }>(`
        match
          $end isa component, has component-id ${cid};
          let $c, $f, $p, $g in requirement_steps($end);
          $d isa dependency (dependent: $c, affected-function: $f, provider: $p, required-function: $g), has loss-effect $loss,
            has dependency-kind $kind;
        fetch { "from": $c.component-id, "needs": $f.function-name, "to": $p.component-id, "to-name": $p.name,
                "function": $g.function-name, "loss": $loss, "kind": $kind,
                "fallback": [ match fallback (protected: $d, backup: $b); fetch { "id": $b.component-id }; ] };
    `, "every dependency the component relies on, directly or not, through the recursive function requirement_steps",
  true);
  tx.note("TypeScript counts steps from the component and labels each requirement essential, backed up or supporting.");
  const reached = stepsFrom(componentId, edges);
  const required: Requirement[] = [];
  for (const [key, { steps, edge }] of reached) {
    const e = edge as Step & { loss: string; fallback: Doc[] };
    const [comp, fn] = key.split("\u0000");
    const role = e.fallback.length ? "backed up" : e.loss === "lost" ? "essential" : "supporting";
    required.push({ id: comp, name: e["to-name"], function: fn, steps, via: e.from, kind: e.kind, role });
  }
  return { required: sortBy(required, (x) => [x.steps, x.name, x.function]) };
}

// ---- Assemblies and systems -------------------------------------------------------------------------------

/** An assembly: its parents, sub-assemblies, direct components and every component inside it. */
export async function assembly(tx: Tx, assemblyId: string): Promise<AssemblyDetails> {
  const aid = string(assemblyId);
  const doc = one(await tx.docs<Doc>(`
        match $a isa assembly, has assembly-id ${aid};
        fetch { "id": $a.assembly-id, "name": $a.name, "description": $a.description };
    `, "the assembly's own attributes"), `assembly ${assemblyId}`);
  const parents = await tx.docs<Named>(`
        match
          $a isa assembly, has assembly-id ${aid};
          let $p in assembly_ancestors($a);
        fetch { "id": $p.assembly-id, "name": $p.name };
    `, "the assemblies above it, through the recursive function assembly_ancestors");
  const subassemblies = await tx.docs<Named>(`
        match
          $a isa assembly, has assembly-id ${aid};
          assembly-membership (assembly: $a, member: $sub);
          $sub isa assembly;
        fetch { "id": $sub.assembly-id, "name": $sub.name };
    `, "its direct sub-assemblies (assembly-membership with an assembly as member)");
  const members = await tx.docs<Doc>(`
        match
          $a isa assembly, has assembly-id ${aid};
          assembly-membership (assembly: $a, member: $c);
          $c isa! $type;
          $type sub component;
        fetch { "id": $c.component-id, "name": $c.name, "type": $type };
    `, "the components that are direct members, with their most specific type");
  const everything = await tx.docs<{ id: string }>(`
        match
          $a isa assembly, has assembly-id ${aid};
          let $c in assembly_components($a);
        fetch { "id": $c.component-id };
    `, "every component inside it at any depth, through the recursive function assembly_components", true);
  for (const m of members) m.type = label(m.type);
  return {
    ...(doc as Named & { description: string | null }),
    parents,
    subassemblies: sortBy(subassemblies, (s) => s.name),
    components: sortBy(members, (m) => m.name) as AssemblyDetails["components"],
    "all-component-ids": sorted(new Set(everything.map((c) => c.id))),
  };
}

/** Every system with its parent (if any). */
export async function systemList(tx: Tx): Promise<SystemSummary[]> {
  const systems = await tx.docs<Doc>(`
        match $s isa system;
        fetch { "id": $s.system-id, "name": $s.name, "description": $s.description };
    `, "every system");
  const parents = await tx.docs<Doc>(`
        match system-membership (system: $parent, member: $s); $s isa system;
        fetch { "child": $s.system-id, "parent": $parent.system-id };
    `, "which system each sub-system belongs to");
  const total = await tx.docs<Doc>(`
        match $s isa system; let $c in system_components($s);
        reduce $n = count groupby $s;
        fetch { "id": $s.system-id, "n": $n };
    `, "how many components each system has in total, counted in TypeDB");
  const up = new Map<string, string>(parents.map((p) => [p.child, p.parent]));
  const t = new Map<string, number>(total.map((x) => [x.id, x.n]));
  return sortBy(systems.map((s) => ({ ...s, parent: up.get(s.id) ?? null, total: t.get(s.id) ?? 0 }) as SystemSummary), (s) => s.name);
}

/**
 * A system: its subsystems, every component taking part (directly or through subsystems) and the control loops
 * of the system and its subsystems. (Written as an `or` of two loop patterns: the shorter
 * `{ $x is $s; } or { system-membership (system: $s, member: $x); }` hits a TypeDB 3.14.1 planner bug, QPL1.)
 */
export async function system(tx: Tx, systemId: string): Promise<SystemDetails> {
  const sid = string(systemId);
  const doc = one(await tx.docs<Doc>(`
        match $s isa system, has system-id ${sid};
        fetch { "id": $s.system-id, "name": $s.name, "description": $s.description };
    `, "the system's own attributes"), `system ${systemId}`);
  const subsystems = await tx.docs<Named>(`
        match
          $s isa system, has system-id ${sid};
          system-membership (system: $s, member: $sub);
          $sub isa system;
        fetch { "id": $sub.system-id, "name": $sub.name };
    `, "its direct sub-systems");
  const components = await tx.docs<Named & { systems: Named[] }>(`
        match
          $s isa system, has system-id ${sid};
          let $c in system_components($s);
        fetch { "id": $c.component-id, "name": $c.name,
                "systems": [ match system-membership (system: $o, member: $c); fetch { "id": $o.system-id, "name": $o.name }; ] };
    `, "every component in the system or its sub-systems, through the recursive function system_components, "
    + "with every system each one belongs to", true);
  const loops = await tx.docs<Doc>(`
        match
          $s isa system, has system-id ${sid};
          { $loop isa control-loop, links (controlled-system: $s); }
          or { system-membership (system: $s, member: $sub); $sub isa system;
               $loop isa control-loop, links (controlled-system: $sub); };
          $loop links (controller: $ctrl);
        fetch { "name": $loop.name, "description": $loop.description, "controller": $ctrl.component-id,
                "sensors": [ match $loop links (sensor: $sensor); fetch { "id": $sensor.component-id }; ],
                "actuators": [ match $loop links (actuator: $act); fetch { "id": $act.component-id }; ] };
    `, "the control loops of the system and its sub-systems, with their controller, sensors and actuators");
  tx.note("TypeScript removes duplicate components (a part reached through two sub-systems is listed once) "
    + "and sorts the lists.");
  const unique = new Map<string, Named & { systems: Named[] }>();
  for (const c of components) unique.set(c.id, c);
  for (const loop of loops) {
    loop.sensors = sorted((loop.sensors as { id: string }[]).map((x) => x.id));
    loop.actuators = sorted((loop.actuators as { id: string }[]).map((x) => x.id));
  }
  return {
    ...(doc as Named & { description: string | null }),
    subsystems: sortBy(subsystems, (s) => s.name),
    components: sortBy(unique.values(), (c) => c.name),
    "control-loops": loops as SystemDetails["control-loops"],
  };
}

// ---- Browsing: trees and the type hierarchy ------------------------------------------------------------------

/**
 * Every assembly with its parent, how many components sit in it directly, and how many it contains in total
 * (through its sub-assemblies, counted by the recursive assembly_components function).
 */
export async function assemblyTree(tx: Tx): Promise<AssemblyNode[]> {
  const assemblies = await tx.docs<Doc>(`
        match $a isa assembly;
        fetch { "id": $a.assembly-id, "name": $a.name,
                "parent": [ match assembly-membership (assembly: $p, member: $a); fetch { "id": $p.assembly-id }; ] };
    `, "every assembly with its parent assembly");
  const direct = await tx.docs<Doc>(`
        match $a isa assembly; assembly-membership (assembly: $a, member: $c); $c isa component;
        reduce $n = count groupby $a;
        fetch { "id": $a.assembly-id, "n": $n };
    `, "how many components sit directly in each assembly");
  const total = await tx.docs<Doc>(`
        match $a isa assembly; let $c in assembly_components($a);
        reduce $n = count groupby $a;
        fetch { "id": $a.assembly-id, "n": $n };
    `, "how many components each assembly contains at any depth (recursive assembly_components)");
  const d = new Map<string, number>(direct.map((x) => [x.id, x.n]));
  const t = new Map<string, number>(total.map((x) => [x.id, x.n]));
  return sortBy(assemblies.map((a) => ({
    id: a.id as string, name: a.name as string, parent: a.parent.length ? (a.parent[0].id as string) : null,
    direct: d.get(a.id) ?? 0, total: t.get(a.id) ?? 0,
  })), (a) => a.name);
}

/**
 * The component type hierarchy, with instance counts: "total" counts every instance of the type and its
 * subtypes (one polymorphic query), "direct" only those whose most specific type it is.
 */
export async function typeHierarchy(tx: Tx): Promise<TypeNode[]> {
  const tree = await tx.docs<Doc>(`
        match $t sub! $parent; $parent sub component;
        fetch { "type": $t, "parent": $parent };
    `, "each component type with its direct supertype (sub!)");
  const total = await tx.docs<Doc>(`
        match $t sub component; $x isa $t;
        reduce $n = count groupby $t;
        fetch { "type": $t, "n": $n };
    `, "instances of each type including its subtypes (isa is polymorphic)");
  const direct = await tx.docs<Doc>(`
        match $t sub component; $x isa! $t;
        reduce $n = count groupby $t;
        fetch { "type": $t, "n": $n };
    `, "instances whose most specific type it is (isa!)");
  const t = new Map<string, number>(total.map((x) => [label(x.type), x.n]));
  const d = new Map<string, number>(direct.map((x) => [label(x.type), x.n]));
  const types: { type: string; parent: string | null }[] = [{ type: "component", parent: null },
    ...tree.map((x) => ({ type: label(x.type), parent: label(x.parent) }))];
  return sortBy(types.map((x) => ({ ...x, total: t.get(x.type) ?? 0, direct: d.get(x.type) ?? 0 })), (x) => x.type);
}

/**
 * One type: its supertypes, the attributes it owns and roles it plays (inherited included), and every
 * instance of it or any subtype (polymorphism).
 */
export async function typeDetail(tx: Tx, typeLabel: string): Promise<TypeDetail> {
  const known = new Set((await tx.docs<Doc>('match $t sub component; fetch { "t": $t };', "check that it is a component type")).map((x) => label(x.t)));
  if (!known.has(typeLabel)) throw new NotFound(`component type ${typeLabel}`);
  const supertypes = await tx.docs<Doc>(`match $t label ${typeLabel}; $t sub $s; $s sub component; fetch { "s": $s };`,
    "its supertypes, up to component");
  const owns = await tx.docs<Doc>(`match $t label ${typeLabel}; $t owns $a; fetch { "a": $a };`, "the attributes it owns, inherited included");
  const plays = await tx.docs<Doc>(`match $t label ${typeLabel}; $t plays $r; fetch { "r": $r };`, "the roles it plays, inherited included");
  const instances = await tx.docs<Doc>(`
        match $x isa ${typeLabel}; $x isa! $type;
        fetch { "id": $x.component-id, "name": $x.name, "type": $type };
    `, "every instance of the type or any subtype, with its most specific type", true);
  return {
    type: typeLabel,
    supertypes: without(supertypes.map((s) => label(s.s)), [typeLabel]),
    owns: sorted(owns.map((a) => label(a.a))),
    plays: sorted(plays.map((r) => label(r.r))),
    instances: sortBy(instances.map((i) => ({ ...i, type: label(i.type) }) as TypeDetail["instances"][number]), (i) => [i.type, i.name]),
  };
}

// ---- Schema definitions ----------------------------------------------------------------------------------------

/**
 * The definition of one type or function, cut from the schema text TypeDB itself returns (the driver's
 * database.schema(): a single `define` in TypeDB's own layout, every definition starting at the line's
 * beginning). For a type, its supertypes' definitions follow, nearest first, since a type inherits what they
 * own and play. Throws NotFound for a name the schema does not define.
 */
export function schemaDefinitions(schema: string, name: string): SchemaDefinition[] {
  const blocks = new Map<string, { name: string; kind: string; lines: string[] }>();
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    if (line.trim() === "" || line.trim() === "define") continue;
    if (!/^\s/.test(line)) {
      const words = line.replace(/\(/g, " ").replace(/,/g, " ").split(/\s+/).filter(Boolean);
      current = words[1];
      blocks.set(current, { name: current, kind: words[0] === "fun" ? "function" : words[0], lines: [] });
    }
    blocks.get(current!)!.lines.push(line);
  }
  if (!blocks.has(name)) throw new NotFound(`schema definition ${name}`);
  const chain: SchemaDefinition[] = [];
  const seen = new Set<string>();
  while (blocks.has(name) && !seen.has(name)) {
    seen.add(name);
    const block = blocks.get(name)!;
    chain.push({ name, kind: block.kind as SchemaDefinition["kind"], definition: block.lines.join("\n") });
    const parentLine = block.lines.slice(1).find((ln) => ln.trim().startsWith("sub "));
    const parent = parentLine === undefined ? null : parentLine.trim().replace(/^sub /, "").replace(/[,;]+$/, "");
    if (block.kind === "function" || parent === null) break;
    name = parent;
  }
  return chain;
}

