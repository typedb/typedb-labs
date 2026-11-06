// The Impact Explorer's "what if": delay one item by N days and project what moves.
//
// TypeDB supplies everything (the recursive dependency walk, every item's dates and status, and
// the deadlines). The only thing done here is date arithmetic, because TypeDB 3.14.1 can't add
// days to a `date`: for each affected item,
//
//     projected(item) = max(planned(item), max over its hard prerequisites of projected(prereq) + lag)
//
// walked in dependency order (a longest-path calculation). Completed items never move. A deadline
// is breached when an item it limits is projected after the deadline's date. Results are
// projections, never written to the database.

import { SCHEMA_FILES } from "./generated/assets.ts";
import * as queries from "./queries.ts";
import { dayNumber, isoDate, minBy, sorted, sortedObject, sortedUnique } from "./py.ts";
import type { Tx } from "./typedb.ts";

export const MAX_DELAY_DAYS = 365;

export interface HardEdge {
  from: string;
  to: string;
  lag: number | null;
}

/** Planned dates as day numbers (days since 1970-01-01), one per item that has a due date. */
export type Planned = Record<string, number>;

export type Projection = Record<string, [number, string[]]>;

/**
 * Pure calculation. Returns {code: [projected day, [codes of the prerequisites that set it]]}.
 *
 * start: the delayed item's code; edges: [{from, to, lag}] (hard dependencies only);
 * planned: {code: day}; completed: codes that are already done and so cannot move.
 */
export function propagate(start: string, delayDays: number, edges: HardEdge[], planned: Planned, completed: Set<string> = new Set()): Projection {
  if (!(delayDays >= 0 && delayDays <= MAX_DELAY_DAYS)) throw new Error(`delay must be 0-${MAX_DELAY_DAYS} days`);
  const incoming: Record<string, HardEdge[]> = {};
  const outgoing: Record<string, HardEdge[]> = {};
  for (const e of edges) {
    (incoming[e.to] ??= []).push(e);
    (outgoing[e.from] ??= []).push(e);
  }
  const affected = new Set([start, ...edges.map((e) => e.to)]);

  // Kahn's algorithm: process an item only after all its affected prerequisites.
  const waiting: Record<string, number> = {};
  for (const code of affected) waiting[code] = (incoming[code] ?? []).filter((e) => affected.has(e.from)).length;
  let ready = sorted(Object.entries(waiting).filter(([, n]) => n === 0).map(([code]) => code));
  const projected: Projection = {};
  while (ready.length) {
    const code = ready.shift()!;
    if (code === start && !completed.has(code)) {
      projected[code] = [planned[code]! + delayDays, []];
    } else if (completed.has(code) || code === start) {
      projected[code] = [planned[code]!, []];
    } else {
      let best = planned[code]!;
      let causes: string[] = [];
      for (const e of incoming[code] ?? []) {
        if (!(e.from in projected)) continue;
        const candidate = projected[e.from]![0] + (e.lag ?? 0);
        if (candidate > best) {
          best = candidate;
          causes = [e.from];
        } else if (candidate === best && candidate > planned[code]!) {
          causes.push(e.from);
        }
      }
      projected[code] = [best, sorted(causes)];
    }
    for (const e of outgoing[code] ?? []) {
      waiting[e.to]! -= 1;
      if (waiting[e.to] === 0) ready.push(e.to);
    }
    ready = sorted(ready);
  }
  if (Object.keys(projected).length !== affected.size) throw new Error("hard dependencies contain a cycle; dates can't be projected");
  return projected;
}

function plannedDays(items: queries.Items): Planned {
  const planned: Planned = {};
  for (const [code, it] of Object.entries(items)) if (it.due) planned[code] = dayNumber(it.due);
  return planned;
}

function completedCodes(items: queries.Items): Set<string> {
  return new Set(Object.entries(items).filter(([, it]) => it.status === "complete").map(([c]) => c));
}

export interface ProjectedItem {
  name: string | null;
  type: string;
  workstream: string | null;
  planned: string;
  projected: string;
  shift_days: number;
  caused_by: string[];
}

export interface ProjectedDeadline extends queries.DeadlineLimit {
  item_projected: string;
  breached: boolean;
  days_over: number;
  headroom_days: number;
}

/**
 * Run the impact queries in transaction `tx` and project a delay of startCode by delayDays.
 *
 * Returns {start, delay_days, items: {code: {...}}, deadlines: [...]}. Only items whose
 * projected date differs from the plan appear in "items" (plus the start item). Dates are ISO text.
 */
export async function project(tx: Tx, startCode: string, delayDays: number) {
  const items = await queries.allItems(tx);
  if (!(startCode in items)) throw new NotFound(`no work item with code ${startCode}`);
  const edges = await queries.impactEdges(tx, startCode);
  const planned = plannedDays(items);
  const completed = completedCodes(items);
  const projected = propagate(startCode, delayDays, edges, planned, completed);

  const moved: Record<string, ProjectedItem> = {};
  for (const [code, [nu, causes]] of Object.entries(projected)) {
    const old = planned[code]!;
    if (nu !== old || code === startCode) {
      const it = items[code]!;
      moved[code] = { name: it.name, type: it.type, workstream: it.workstream,
        planned: isoDate(old), projected: isoDate(nu), shift_days: nu - old, caused_by: causes };
    }
  }

  const deadlines: ProjectedDeadline[] = [];
  for (const limit of await queries.allDeadlineLimits(tx)) {
    if (!(limit.item in moved)) continue;
    const due = dayNumber(limit.due);
    const nu = projected[limit.item]![0];
    deadlines.push({ ...limit, item_projected: isoDate(nu),
      breached: nu > due, days_over: Math.max(0, nu - due), headroom_days: Math.max(0, due - nu) });
  }
  return { start: startCode, delay_days: delayDays, items: moved, deadlines: sorted(deadlines, (d) => [d.due, d.deadline, d.item]) };
}

/** An item code that no deal-item has (the API answers 404). */
export class NotFound extends Error {}

// ---- The Impact Explorer screen -----------------------------------------------------------------

// Scenario INPUTS, not results: named delays worth trying for a given item. Where deadlines break is
// never listed here; it is found from the data (breachFromDays below).
const REFERENCE_SCENARIOS: Record<string, [number, string, string][]> = {
  "CP-CMA": [[28, "CMA Phase 1 clock stopped", "The statutory clock stops for four weeks until an information request is answered in full"],
    [168, "CMA Phase 2 reference", "A full 24-week Phase 2 investigation"]],
};
const PROBLEM_STATUSES = ["at-risk", "delayed"];

/** The text of saved functions, as defined in schema/functions.tql (shown beside the queries). */
export function functionDefinitions(names: string[]): { name: string; definition: string }[] {
  const lines = SCHEMA_FILES.find((f) => f.path === "schema/functions.tql")!.text.split("\n");
  const out: { name: string; definition: string }[] = [];
  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`fun ${name}(`));
    if (start === -1) continue;
    let end = start;
    while (!lines[end]!.trim().startsWith("return")) end++;
    let first = start;
    while (first > 0 && lines[first - 1]!.startsWith("#")) first--; // the function's own comment
    out.push({ name, definition: lines.slice(first, end + 1).join("\n").trim() });
  }
  return out;
}

/**
 * The smallest delay (0..MAX) at which `item` is projected after `due`, or null. Projections only
 * ever move later as the delay grows, so a binary search over whole days finds it exactly.
 */
export function breachFromDays(start: string, edges: HardEdge[], planned: Planned, completed: Set<string>, item: string, due: number): number | null {
  const late = (d: number) => propagate(start, d, edges, planned, completed)[item]![0] > due;
  if (!late(MAX_DELAY_DAYS)) return null;
  let lo = 0;
  let hi = MAX_DELAY_DAYS;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (late(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The condition to simulate when none is chosen: the first one TypeDB records as at risk or
 * delayed (by due date), else the first not yet complete.
 */
export async function defaultSubject(tx: Tx): Promise<string | null> {
  const open = (await queries.conditions(tx)).filter((c) => c.status !== "complete");
  const risky = open.filter((c) => PROBLEM_STATUSES.includes(c.status ?? ""));
  return open.length ? (risky.length ? risky : open)[0]!.code : null;
}

interface Cause {
  code: string;
  kind: string;
  lag: number | null;
}

interface ItemView {
  code: string;
  name: string | null;
  type: string;
  status: string | null;
  role: string;
  workstream: queries.Ref | null;
  planned: string | null;
  projected: string | null;
  shift_days: number;
  completed: boolean;
  caused_by: Cause[];
  path: string[];
  raci: queries.ImpactHolder[];
}

interface LimitView {
  code: string;
  name: string | null;
  planned: string;
  projected: string;
  breached: boolean;
  days_over: number;
  headroom_days: number;
  breach_from_days: number | null;
}

interface DeadlineView extends ItemView {
  due: string;
  consequence: string | null;
  legal_basis: string | null;
  bound: queries.Ref[];
  consent_from: queries.Ref[];
  group_obligation: { owed_by: string; consent_from: string; effective_stake: string } | null;
  limits: LimitView[];
  breached: boolean;
  days_over: number;
  headroom_days: number;
  breach_from_days: number | null;
}

/** Everything the Impact Explorer shows for "delay startCode by delayDays". Read-only. */
export async function scenario(tx: Tx, startCode: string, delayDays: number) {
  const items = await queries.allItems(tx);
  if (!(startCode in items)) throw new NotFound(startCode);
  const deal = await queries.deal(tx);
  const hardKinds = await queries.hardDependencyKinds(tx);
  const edges = await queries.impactEdges(tx, startCode); // recursive, in TypeDB
  const everyDep = await queries.allDependencies(tx);
  const limits = await queries.allDeadlineLimits(tx);
  const deadlineInfo: Record<string, queries.Deadline> = {};
  for (const d of await queries.deadlines(tx)) deadlineInfo[d.code] = d;
  const raci = await queries.impactRaci(tx, startCode); // recursive, in TypeDB
  let stakes: Record<string, queries.GroupConsent> = {};
  let ownershipNote: string | null = null;
  try {
    for (const c of await queries.groupConsents(tx, deal.target.code)) stakes[c.obligation] = c; // guarded
  } catch (error) {
    if (!(error instanceof queries.OwnershipDataError)) throw error;
    stakes = {};
    ownershipNote = error.message;
  }

  const planned = plannedDays(items);
  const completed = completedCodes(items);
  const projected = propagate(startCode, delayDays, edges, planned, completed);
  const reach = new Set(Object.keys(projected)); // start + everything downstream
  const edgeBy: Record<string, queries.Edge> = {};
  for (const e of edges) edgeBy[`${e.from}\u0000${e.to}`] = e;
  const wsName: Record<string, string | null> = {};
  for (const [c, it] of Object.entries(items)) if (it.type === "workstream") wsName[c] = it.name;

  const pathTo = (code: string): string[] => {
    const chain = [code];
    while (projected[chain[chain.length - 1]!]![1].length) chain.push(projected[chain[chain.length - 1]!]![1][0]!);
    return chain.reverse();
  };

  const itemView = (code: string, role: string): ItemView => {
    const it = items[code]!;
    const [nu, causes] = projected[code] ?? [planned[code] ?? null, []];
    const old = planned[code] ?? null;
    return { code, name: it.name, type: it.type, status: it.status, role,
      workstream: it.workstream ? { code: it.workstream, name: wsName[it.workstream] ?? null } : null,
      planned: old === null ? null : isoDate(old), projected: nu === null ? null : isoDate(nu),
      shift_days: nu !== null && old !== null ? nu - old : 0, completed: completed.has(code),
      caused_by: causes.map((c) => ({ code: c, kind: edgeBy[`${c}\u0000${code}`]!.kind, lag: edgeBy[`${c}\u0000${code}`]!.lag })),
      path: code in projected ? pathTo(code) : [code],
      raci: raci[code] ?? [] };
  };

  const nodes: Record<string, ItemView> = {};
  for (const c of sorted(reach)) nodes[c] = itemView(c, c === startCode ? "start" : "downstream");

  const deadlines: Record<string, DeadlineView> = {};
  for (const lim of limits) {
    if (!reach.has(lim.item)) continue;
    const dl = (deadlines[lim.deadline] ??= {
      ...itemView(lim.deadline, "deadline"), due: lim.due, consequence: lim.consequence,
      legal_basis: deadlineInfo[lim.deadline]?.legal_basis ?? null,
      bound: deadlineInfo[lim.deadline]?.bound ?? [],
      consent_from: deadlineInfo[lim.deadline]?.consent_from ?? [],
      group_obligation: null, limits: [], breached: false, days_over: 0, headroom_days: 0, breach_from_days: null });
    const due = dayNumber(lim.due);
    const nu = projected[lim.item]![0];
    dl.limits.push({ code: lim.item, name: items[lim.item]!.name,
      planned: isoDate(planned[lim.item]!), projected: isoDate(nu),
      breached: nu > due, days_over: Math.max(0, nu - due), headroom_days: Math.max(0, due - nu),
      breach_from_days: breachFromDays(startCode, edges, planned, completed, lim.item, due) });
    if (lim.deadline in stakes) {
      const c = stakes[lim.deadline]!;
      dl.group_obligation = { owed_by: c.owed_by, consent_from: c.consent_from, effective_stake: c.stake.toString() };
    }
  }
  for (const dl of Object.values(deadlines)) {
    dl.limits = sorted(dl.limits, (x) => x.code);
    dl.breached = dl.limits.some((x) => x.breached);
    dl.days_over = Math.max(...dl.limits.map((x) => x.days_over));
    dl.headroom_days = Math.min(...dl.limits.map((x) => x.headroom_days));
    const froms = dl.limits.map((x) => x.breach_from_days).filter((x): x is number => x !== null);
    dl.breach_from_days = froms.length ? Math.min(...froms) : null;
  }

  // Soft (informing) links touching the affected items: shown for context, never move dates.
  const context: Record<string, ItemView> = {};
  const soft = everyDep.filter((d) => !hardKinds.includes(d.kind) && (reach.has(d.from) || reach.has(d.to)));
  for (const d of soft) {
    for (const c of [d.from, d.to]) {
      if (!reach.has(c) && !(c in context)) context[c] = itemView(c, "context");
    }
  }

  const graphEdges = [
    ...sorted(edges, (e) => [e.from, e.to]).map((e) => ({ ...e, hard: true,
      moved: nodes[e.to]!.caused_by.some((x) => x.code === e.from) && nodes[e.to]!.shift_days > 0 })),
    ...soft.map((d) => ({ ...d, hard: false, moved: false })),
    ...Object.entries(deadlines).flatMap(([code, dl]) => dl.limits.map((x) =>
      ({ from: x.code, to: code, kind: "deadline-limit", lag: null as number | null, hard: false, moved: x.breached }))),
  ];

  const moved = Object.values(nodes).filter((n) => n.shift_days > 0);
  const breached = Object.values(deadlines).filter((dl) => dl.breached);
  interface PersonImpact {
    code: string;
    name: string | null;
    type: string;
    employer: queries.Ref | null;
    title: string | null;
    items: { code: string; name: string | null; letter: string; via: queries.Doc | null; kind: string; breached: boolean; shift_days: number }[];
  }
  const people: Record<string, PersonImpact> = {};
  // People to act: RACI on items this scenario actually moves, and on deadlines it breaches.
  for (const n of [...sorted(Object.keys(nodes)).map((c) => nodes[c]!), ...Object.values(deadlines)] as (ItemView & { breached?: boolean })[]) {
    if (!(n.shift_days > 0 || n.breached)) continue;
    for (const r of n.raci) {
      const p = (people[r.code] ??= { code: r.code, name: r.name, type: r.type, employer: r.employer, title: r.title, items: [] });
      p.items.push({ code: n.code, name: n.name, letter: r.letter, via: r.via,
        kind: n.role === "deadline" ? "deadline" : "item",
        breached: n.breached ?? false, shift_days: n.shift_days });
    }
  }
  const peopleList = sorted(Object.values(people), (p) => [Math.min(...p.items.map((i) => "ARCI".indexOf(i.letter))), -p.items.length, p.name ?? ""]);

  interface Scenario {
    days: number;
    label: string;
    detail: string;
    kind: string;
    deadline?: string;
  }
  let scenarios: Scenario[] = [{ days: 0, label: "Base plan", detail: "No delay: the plan as recorded in TypeDB", kind: "baseline" }];
  scenarios.push(...(REFERENCE_SCENARIOS[startCode] ?? []).map(([d, label, detail]) => ({ days: d, label, detail, kind: "reference" })));
  for (const [code, dl] of sorted(Object.entries(deadlines), ([, dl]) => dl.breach_from_days || 10 ** 6)) {
    if (dl.breach_from_days !== null) {
      scenarios.push({ days: dl.breach_from_days, label: `Deadline breached: ${dl.name}`,
        detail: "The shortest delay at which this deadline is projected to be missed", kind: "threshold", deadline: code });
    }
  }
  const seenDays = new Set<number>();
  const unique: Scenario[] = [];
  for (const s of sorted(scenarios, (s) => [s.days, s.kind !== "baseline"])) {
    if (!seenDays.has(s.days)) {
      seenDays.add(s.days);
      unique.push(s);
    }
  }

  const level = breached.length ? "breach" : moved.length ? "delayed" : "on-plan";
  const shownDeps = everyDep.filter((d) => d.from in nodes || d.to in nodes || d.from in deadlines
    || d.to in deadlines || d.from in context || d.to in context);
  const names: Record<string, string | null> = {};
  for (const d of shownDeps) for (const c of [d.from, d.to]) if (c in items) names[c] = items[c]!.name;
  const statuses: Record<string, string | null> = {};
  for (const c of Object.keys(names)) statuses[c] = items[c]!.status;
  return {
    start: nodes[startCode]!, delay_days: delayDays, as_of: deal.as_of, max_delay_days: MAX_DELAY_DAYS,
    level, hard_kinds: hardKinds,
    items: sorted(Object.keys(nodes), (c) => [nodes[c]!.planned ?? "", c]).map((c) => nodes[c]!),
    deadlines: sorted(Object.values(deadlines), (d) => [d.due, d.code]),
    context: sorted(Object.values(context), (n) => n.code),
    edges: graphEdges,
    dependencies: shownDeps, names: sortedObject(names), statuses: sortedObject(statuses),
    summary: { moved: moved.length, workstreams: sortedUnique(moved.filter((n) => n.workstream).map((n) => n.workstream!.name ?? "")),
      breached: breached.map((d) => d.code), people: peopleList.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, via: i.via })) })) },
    scenarios: unique.map((s) => ({ ...s, deadline: s.deadline ?? null })), ownership_note: ownershipNote,
    functions: functionDefinitions(["impact_edges", "downstream"]),
  };
}

// ---- Schedule float (docs/phase6-plan.md §5.4): one calculation for every screen ---------------

export interface Float {
  float: number | null;
  deadline: string | null;
  by_deadline: Record<string, number>;
}

/**
 * {item code: {float, deadline, by_deadline: {deadline: float}}} for every item not yet complete.
 *
 * The float to a deadline is the largest delay the item can absorb before that deadline breaks: the
 * smallest breaching delay found by breachFromDays (the Impact Explorer's search), minus one. An item's
 * float is the smallest over the deadlines it can reach; null when no deadline breaks within range.
 */
export function scheduleFloat(items: queries.Items, dependencies: queries.Dependency[], limits: queries.DeadlineLimit[], hardKinds: Set<string>): Record<string, Float> {
  const edges: HardEdge[] = dependencies.filter((e) => hardKinds.has(e.kind)).map((e) => ({ from: e.from, to: e.to, lag: e.lag || 0 }));
  const nxt: Record<string, HardEdge[]> = {};
  for (const e of edges) (nxt[e.from] ??= []).push(e);
  const planned = plannedDays(items);
  const completed = completedCodes(items);
  const out: Record<string, Float> = {};
  for (const [code, item] of Object.entries(items)) {
    if (completed.has(code) || !item.due) continue;
    const reach = new Set([code]);
    const todo = [code];
    const own: HardEdge[] = []; // this item's downstream edges, as impact_edges returns them
    while (todo.length) {
      for (const e of nxt[todo.pop()!] ?? []) {
        own.push(e);
        if (!reach.has(e.to)) {
          reach.add(e.to);
          todo.push(e.to);
        }
      }
    }
    const byDeadline: Record<string, number> = {};
    for (const limit of limits) {
      if (!reach.has(limit.item)) continue;
      const b = breachFromDays(code, own, planned, completed, limit.item, dayNumber(limit.due));
      if (b !== null) byDeadline[limit.deadline] = Math.min(b - 1, byDeadline[limit.deadline] ?? b - 1);
    }
    const best = minBy(Object.entries(byDeadline), ([k, v]) => [v, k]);
    out[code] = { float: best ? best[1] : null, deadline: best ? best[0] : null, by_deadline: byDeadline };
  }
  return out;
}

export interface CriticalPath {
  float: number;
  items: string[];
}

/**
 * {deadline: {float, items}}: for each deadline, its exposure (the smallest float into it) and its
 * deadline-critical chain, the open items sharing that smallest float. Not a conventional (CPM) critical path,
 * which runs to the end of the project: this is measured against each contractual deadline.
 */
export function criticalPaths(floats: Record<string, Float>): Record<string, CriticalPath> {
  const out: Record<string, CriticalPath> = {};
  for (const [code, f] of Object.entries(floats)) {
    for (const [deadline, v] of Object.entries(f.by_deadline)) {
      const cur = out[deadline];
      if (cur === undefined || v < cur.float) out[deadline] = { float: v, items: [code] };
      else if (v === cur.float) cur.items.push(code);
    }
  }
  const result: Record<string, CriticalPath> = {};
  for (const [k, v] of Object.entries(out)) result[k] = { ...v, items: sorted(v.items) };
  return result;
}
