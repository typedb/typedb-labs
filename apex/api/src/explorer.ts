// The Relationship Explorer's answers, composed from the TypeQL in queries.ts.
//
// The graph shows organisations and the relations between them, read generically from TypeDB with their
// role names; people, obligations and events appear on demand in the detail panel. The only things
// worked out here are grouping nodes for the layout (from the relations TypeDB returns) and, for the
// group structure, listing each ownership route, checked against TypeDB's own recursive figures.

import { Dec } from "./decimal.ts";
import * as queries from "./queries.ts";
import { cmp, sorted, sortedObject, sortedUnique } from "./py.ts";
import type { Tx } from "./typedb.ts";

/** Exact decimal as short text: 0.70 -> "0.7", 1.0 -> "1". */
function dec(v: Dec): string {
  return v.toString();
}

/** The routes listed from direct holdings don't add up to TypeDB's recursive figures. */
export class OwnershipRoutesMismatch extends Error {
  typeql: string[] = [];
}

/** ["law-firm", "professional-services-firm", "organisation", "party"] from the schema hierarchy. */
export function typePath(typeLabel: string, parents: Record<string, string>): string[] {
  const path = [typeLabel];
  while (path[path.length - 1]! in parents) path.push(parents[path[path.length - 1]!]!);
  return path;
}

interface Cluster {
  key: string;
  label: string;
  order: number;
}

export async function graph(tx: Tx) {
  const deal = await queries.deal(tx);
  const hierarchy = await queries.typeHierarchy(tx);
  const orgs: Record<string, queries.Organisation & { type: string; people: number; type_path: string[]; cluster?: string }> = {};
  for (const o of await queries.organisations(tx)) orgs[o.code] = { ...o, type_path: typePath(o.type, hierarchy.parties) };
  const relations = (await queries.organisationRelations(tx)).filter((r) => queries.countIn(r.players.map((p) => p.code), orgs) >= 2);
  const acquirer = deal.acquirer.code;
  const target = deal.target.code;
  const members = new Set(await queries.groupMembers(tx, target));

  const clusters: Record<string, Cluster> = {};
  const put = (code: string, cluster: string, label: string, order: number) => {
    if (!("cluster" in orgs[code]!)) {
      orgs[code]!.cluster = cluster;
      clusters[cluster] ??= { key: cluster, label, order };
    }
  };

  put(acquirer, "acquirer", "Acquirer", 2);
  put(target, "target", "Target", 4);
  for (const code of sorted(members)) put(code, "target-group", `${deal.target.name} group`, 5);
  for (const r of relations) {
    const roles = Object.fromEntries(r.players.map((p) => [p.role, p]));
    if (r.type === "ownership" && members.has(roles.owned!.code!) && roles.owner!.code! in orgs) {
      put(roles.owner!.code!, "outside-shareholders", "Outside shareholders in the group", 6);
    }
  }
  for (const r of relations) {
    const roles = Object.fromEntries(r.players.map((p) => [p.role, p]));
    if ("adviser" in roles && "client" in roles) {
      const client = roles.client!;
      const side = client.code === acquirer ? 1 : 3;
      put(roles.adviser!.code!, `advisers:${client.code}`, `Advisers to ${client.name}`, side);
    }
    if ("lender" in roles) put(roles.lender!.code!, "lenders", "Lenders", 0);
  }
  for (const [code, o] of Object.entries(orgs)) {
    if (o.type_path.includes("authority")) put(code, "authorities", "Authorities", 7);
    put(code, "other", "Other organisations", 8);
  }

  const usedTypes = sortedUnique(relations.map((r) => r.type));
  const relationTypes: Record<string, { parent: string | null; roles: string[] }> = {};
  for (const t of usedTypes) relationTypes[t] = hierarchy.relations[t] ?? { parent: null, roles: [] };
  return { deal: { code: deal.code, name: deal.name, value: deal.value, currency: deal.currency },
    nodes: sorted(Object.values(orgs), (o) => [clusters[o.cluster!]!.order, o.code]),
    relations,
    clusters: sorted(Object.values(clusters), (c) => c.order),
    types: { parties: hierarchy.parties, relations: relationTypes } };
}

export function node(tx: Tx, code: string) {
  return queries.party(tx, code);
}

interface Step {
  owner: string;
  owned: string;
  stake: Dec;
}

/**
 * The group structure below parentCode (default: the deal's target), guarded.
 *
 * Effective stakes and route counts come from TypeDB's recursive group_members function. Each route
 * is then listed from the direct holdings TypeDB returns, and the listing must reproduce TypeDB's
 * figures exactly; if it doesn't, no figures are returned at all.
 */
export async function ownership(tx: Tx, parentCode?: string | null) {
  const parent = parentCode ?? (await queries.deal(tx)).target.code;
  const stakes = await queries.effectiveOwnership(tx, parent); // runs both guards first
  const consents = await queries.groupConsents(tx, parent);
  const edges = await queries.ownershipEdges(tx, parent);

  const names: Record<string, string | null> = {};
  for (const e of edges) names[e.owner.code] = e.owner.name;
  for (const e of edges) names[e.owned.code] = e.owned.name;
  const below: Record<string, queries.OwnershipEdge[]> = {};
  for (const e of edges) (below[e.owner.code] ??= []).push(e);
  const routes: Record<string, { steps: Step[]; product: Dec }[]> = {};

  const walk = (company: string, steps: Step[], product: Dec) => {
    for (const e of below[company] ?? []) {
      const child = e.owned.code;
      if (steps.some((s) => s.owner === child) || child === parent) throw new OwnershipRoutesMismatch(`route revisits ${child}`);
      const step: Step = { owner: company, owned: child, stake: e.stake };
      (routes[child] ??= []).push({ steps: [...steps, step], product: product.mul(e.stake) });
      walk(child, [...steps, step], product.mul(e.stake));
    }
  };

  walk(parent, [], Dec.ONE);
  const companies = [];
  for (const [code, v] of Object.entries(stakes)) {
    const listed = routes[code] ?? [];
    const total = listed.reduce((acc, r) => acc.add(r.product), Dec.ZERO);
    if (!total.eq(v.stake) || listed.length !== v.routes) {
      throw new OwnershipRoutesMismatch(`${code}: routes add up to ${total.toPlainString()} over ${listed.length}, TypeDB says ${v.stake.toPlainString()} over ${v.routes}`);
    }
    companies.push({ code, name: v.name, stake: dec(v.stake), routes: v.routes,
      paths: listed.map((r) => ({ stake: dec(r.product),
        steps: r.steps.map((s) => ({ owner: s.owner, owned: s.owned, stake: dec(s.stake) })) })) });
  }
  // Largest stake first, then code; exact decimal comparison, as the original did.
  const ordered = [...companies].sort((a, b) => Dec.of(b.stake).cmp(a.stake) || cmp(a.code, b.code));
  const outside = sorted([...new Set(edges.map((e) => e.owner.code))].filter((c) => !(c in stakes) && c !== parent));
  const obligationNames = await queries.names(tx, consents.map((c) => c.obligation));
  return { parent, parent_name: names[parent] ?? null,
    companies: ordered,
    direct: edges.map((e) => ({ owner: e.owner.code, owned: e.owned.code, stake: dec(e.stake),
      inside_group: !outside.includes(e.owner.code), description: e.description })),
    outside_shareholders: outside.map((c) => ({ code: c, name: names[c]! })),
    names: sortedObject(names),
    consents: consents.map((c) => ({ ...c, obligation_name: obligationNames[c.obligation] ?? null, stake: dec(c.stake) })) };
}
