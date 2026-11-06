// The Workstreams pages: /api/workstreams (one row per workstream) and /api/workstreams/{code}.
//
// Three measures are kept apart, as on the Overview: activity progress (duration-weighted, progress.ts),
// milestone completion (point items achieved), and readiness to close (conditions satisfied, only for the
// workstreams that hold conditions). Everything comes from TypeDB; this module groups, orders and counts
// days from the stored scenario date.

import * as impact from "./impact.ts";
import * as queries from "./queries.ts";
import { scheduleItem, shape } from "./schedule.ts";
import { count, daysBetween, sorted } from "./py.ts";
import type { Tx } from "./typedb.ts";

export const CONDITIONS = ["regulatory-clearance", "shareholder-approval", "court-sanction"];

async function summaries_(tx: Tx, code?: string | null) {
  const asOf = (await queries.deal(tx)).as_of;
  const items = await queries.allItems(tx);
  const progress: Record<string, queries.Workstream> = {};
  for (const w of await queries.workstreams(tx, items)) progress[w.code] = w;
  const events = await queries.workstreamEvents(tx, code);
  const risks = await queries.workstreamRisks(tx);
  const reach = await queries.deadlinesInReach(tx, code);
  const organisations = await queries.workstreamOrganisations(tx);
  const rows = [];
  for (const ws of sorted(Object.values(progress), (w) => [w.planned_start, w.due, w.code])) {
    if (code && ws.code !== code) continue;
    const own: Record<string, queries.ItemRecord & { code: string }> = {};
    for (const [c, it] of Object.entries(items)) if (it.workstream === ws.code) own[c] = { ...it, code: c };
    const points = sorted(Object.values(own).filter((i) => shape(i) === "milestone" && i.status !== "complete"), (i) => [i.due, i.code]);
    const conditions = Object.values(own).filter((i) => CONDITIONS.includes(i.type));
    const deadlines: Record<string, { via: string[]; from: string[] }> = {};
    for (const [dl, i] of Object.entries(own)) if (i.type === "deadline") deadlines[dl] = { via: [], from: [] };
    Object.assign(deadlines, reach[ws.code] ?? {});
    const latest = events.find((e) => e.workstream === ws.code) ?? null;
    const first = points[0];
    rows.push({
      code: ws.code, name: ws.name, description: ws.description, status: ws.status, planned_start: ws.planned_start, due: ws.due,
      progress: ws.progress, progress_basis: ws.progress_basis, milestones_achieved: ws.milestones_achieved,
      milestones_total: ws.milestones_total, item_statuses: ws.item_statuses,
      lead: ws.accountable,
      items: Object.keys(own).length,
      activities: count(Object.values(own), (i) => shape(i) === "bar" && i.type === "activity"),
      conditions_satisfied: count(conditions, (i) => i.status === "complete"),
      conditions_total: conditions.length,
      organisations: organisations[ws.code] ?? [],
      next_milestone: first ? { code: first.code, name: first.name, due: first.due, status: first.status,
        days_remaining: daysBetween(first.due!, asOf) } : null,
      deadlines: sorted(Object.entries(deadlines).map(([dl, e]) => ({ code: dl, name: items[dl]!.name, due: items[dl]!.due,
        days_remaining: daysBetween(items[dl]!.due!, asOf), owned: dl in own, via: e.via, from: e.from })), (d) => [d.due, d.code]),
      risks: risks[ws.code] ?? [],
      latest_event: latest,
      events: count(events, (e) => e.workstream === ws.code),
    });
  }
  const names: Record<string, string | null> = {};
  for (const [c, w] of Object.entries(progress)) names[c] = w.name;
  return { asOf, items, events, rows, names };
}

export async function summaries(tx: Tx) {
  const { asOf, rows } = await summaries_(tx);
  return { as_of: asOf, workstreams: rows };
}

/**
 * One workstream: its summary, items (with open prerequisites at any depth), dependencies (crossing
 * workstreams flagged), obligations, risks and every event, newest first. Null if no such workstream.
 */
export async function detail(tx: Tx, code: string) {
  const { asOf, items, events, rows, names } = await summaries_(tx, code);
  if (!rows.length) return null;
  const summary = rows[0]!;
  const blocked = await queries.openPrerequisites(tx, code);
  const hard = new Set(await queries.hardDependencyKinds(tx));
  const allDeps = await queries.allDependencies(tx);
  const floats = impact.scheduleFloat(items, allDeps, await queries.allDeadlineLimits(tx), hard);
  const critical = impact.criticalPaths(floats);
  const own = sorted(Object.entries(items).filter(([, it]) => it.workstream === code).map(([c, it]) => ({
    ...scheduleItem(c, it, floats, critical),
    open_prerequisites: (blocked[c] ?? []).map((u) => ({ code: u, name: items[u]!.name, workstream: items[u]!.workstream })),
  })), (i) => [i.planned_start || i.due, i.due, i.code]);
  const dependencies = [];
  for (const d of allDeps) {
    const a = items[d.from];
    const b = items[d.to];
    if (!a || !b || (code !== a.workstream && code !== b.workstream)) continue;
    dependencies.push({ ...d, hard: hard.has(d.kind),
      from_name: a.name, to_name: b.name,
      from_workstream: { code: a.workstream, name: a.workstream ? names[a.workstream] ?? null : null },
      to_workstream: { code: b.workstream, name: b.workstream ? names[b.workstream] ?? null : null },
      crosses: a.workstream !== b.workstream });
  }
  const openConditions = own.filter((i) => CONDITIONS.includes(i.type) && i.status !== "complete").map((i) => ({ code: i.code, name: i.name }));
  return { as_of: asOf, summary, items: own, dependencies, open_conditions: openConditions,
    obligations: await queries.workstreamObligations(tx, code), events };
}
