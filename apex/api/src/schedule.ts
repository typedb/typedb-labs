// The Gantt chart's answer (/api/schedule) and the shared item detail (/api/items/{code}).
//
// Everything comes from queries that already exist (allItems, workstreams, allDependencies,
// allDeadlineLimits, deal): there is no second timeline dataset. This module only groups and orders.

import * as impact from "./impact.ts";
import * as queries from "./queries.ts";
import { sorted } from "./py.ts";
import type { Tx } from "./typedb.ts";

/**
 * How the chart draws an item: deadlines are lines, items with a planned start are bars, the rest
 * are point milestones (the same split as progress.ts).
 */
export function shape(item: { type: string; planned_start?: string | null }): "deadline" | "bar" | "milestone" {
  if (item.type === "deadline") return "deadline";
  return item.planned_start ? "bar" : "milestone";
}

export interface ScheduleItem extends queries.ItemRecord {
  code: string;
  completed: string | null;
  shape: "deadline" | "bar" | "milestone";
  float: number | null;
  float_deadline: string | null;
  critical_for: string[];
}

/** An item row as the chart and the workstream pages show it (every field the response model lists). */
export function scheduleItem(code: string, it: queries.ItemRecord, floats: Record<string, impact.Float>, critical: Record<string, impact.CriticalPath>): ScheduleItem {
  return { code, name: it.name, type: it.type, status: it.status, criticality: it.criticality, due: it.due, completed: null,
    progress: it.progress, shape: shape(it), float: floats[code]?.float ?? null, float_deadline: floats[code]?.deadline ?? null,
    critical_for: sorted(Object.entries(critical).filter(([, cp]) => cp.items.includes(code)).map(([dl]) => dl)),
    planned_start: it.planned_start, actual_start: it.actual_start, workstream: it.workstream };
}

export async function schedule(tx: Tx) {
  const asOf = (await queries.deal(tx)).as_of;
  const items = await queries.allItems(tx);
  const hard = new Set(await queries.hardDependencyKinds(tx));
  const dependencies = await queries.allDependencies(tx);
  const limits = await queries.allDeadlineLimits(tx);
  const floats = impact.scheduleFloat(items, dependencies, limits, hard);
  const critical = impact.criticalPaths(floats);
  const rows = [];
  for (const ws of sorted(await queries.workstreams(tx, items), (w) => [w.planned_start, w.due, w.code])) {
    const own = Object.entries(items).filter(([, it]) => it.workstream === ws.code).map(([c, it]) => scheduleItem(c, it, floats, critical));
    rows.push({ ...ws, items: sorted(own, (i) => [i.planned_start || i.due, i.due, i.code]) });
  }
  const byDeadline: Record<string, { code: string; name: string | null; due: string; consequence: string | null; limits: string[]; workstream: string | null }> = {};
  for (const limit of limits) {
    const dl = (byDeadline[limit.deadline] ??= { code: limit.deadline, name: limit.name, due: limit.due,
      consequence: limit.consequence, limits: [], workstream: items[limit.deadline]!.workstream });
    dl.limits.push(limit.item);
  }
  const deadlines = sorted(Object.values(byDeadline).map((d) => ({ ...d, limits: sorted(d.limits), critical_path: critical[d.code] ?? null })),
    (d) => [d.due, d.code]);
  return { as_of: asOf, workstreams: rows, deadlines, dependencies: dependencies.map((d) => ({ ...d, hard: hard.has(d.kind) })) };
}

/** One item's detail, plus whether the Impact Explorer can simulate delaying it (open conditions). */
export async function item(tx: Tx, code: string) {
  const found = await queries.itemDetail(tx, code);
  if (found === null) return null;
  found.simulate = (await queries.conditions(tx)).some((c) => c.code === code && c.status !== "complete");
  const items = await queries.allItems(tx);
  const floats = impact.scheduleFloat(items, await queries.allDependencies(tx), await queries.allDeadlineLimits(tx),
    new Set(await queries.hardDependencyKinds(tx)));
  const f = floats[code];
  found.float = f?.float ?? null;
  found.float_deadline = f?.deadline ?? null;
  found.critical_for = sorted(Object.entries(impact.criticalPaths(floats)).filter(([, cp]) => cp.items.includes(code)).map(([dl]) => dl));
  return found;
}
