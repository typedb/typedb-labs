// The Deal Overview's answers, composed from the TypeQL in queries.ts.
//
// The only things worked out here, rather than in TypeQL, are counting, the headline status rule
// and date arithmetic (TypeQL can't subtract dates). Every input comes from TypeDB in the same
// READ transaction; nothing is hard-coded about the deal itself.

import * as progress from "./progress.ts";
import * as queries from "./queries.ts";
import { daysBetween, maxBy } from "./py.ts";
import type { Tx } from "./typedb.ts";

const OPEN_PROBLEM = ["at-risk", "delayed"];

export interface PositionedDeadline extends queries.Deadline {
  days_remaining: number;
  headroom_days: number | null;
}

/**
 * Add days_remaining (from the as-of date) and headroom_days (the deadline's date minus the
 * planned date of the latest item it limits) to a deadline from queries.deadlines().
 */
export function deadlinePosition(deadline: queries.Deadline, asOf: string): PositionedDeadline {
  const planned = deadline.limits.map((i) => i.due).filter((d): d is string => Boolean(d));
  const latest = maxBy(planned, (d) => d);
  return { ...deadline, days_remaining: daysBetween(deadline.due!, asOf),
    headroom_days: latest !== undefined ? daysBetween(deadline.due!, latest) : null };
}

/**
 * Headline status from the conditions' recorded statuses:
 * all complete -> "conditions-satisfied"; any at risk or delayed -> "at-risk"; else "on-track".
 */
export function dealStatus(conditions: queries.Item[]) {
  const satisfied = conditions.filter((c) => c.status === "complete");
  const problems = conditions.filter((c) => OPEN_PROBLEM.includes(c.status ?? ""));
  let state: string;
  if (conditions.length && satisfied.length === conditions.length) state = "conditions-satisfied";
  else if (problems.length) state = "at-risk";
  else state = "on-track";
  const outstanding = conditions.length - satisfied.length;
  return { state, conditions_total: conditions.length, conditions_satisfied: satisfied.length,
    headline: outstanding ? `${outstanding} of ${conditions.length} conditions outstanding` : "All conditions satisfied",
    at_risk: problems.map((c) => ({ code: c.code, name: c.name, status: c.status, due: c.due })) };
}

export async function summary(tx: Tx) {
  const deal = await queries.deal(tx);
  const conditions = await queries.conditions(tx);
  const derived = progress.summary(Object.values(await queries.allItems(tx)));
  const financing = await queries.committedFinancing(tx);
  const upcoming = (await queries.deadlines(tx)).filter((d) => d.due! >= deal.as_of).map((d) => deadlinePosition(d, deal.as_of));
  const nxt = upcoming.length ? upcoming[0]! : null;
  return { ...deal, status: dealStatus(conditions),
    metrics: { progress_percent: derived.percent, progress_basis: derived.basis,
      progress_items: derived.activity_completion?.items ?? 0,
      milestones_achieved: derived.milestone_readiness.achieved,
      milestones_total: derived.milestone_readiness.total,
      committed_financing: financing,
      next_deadline: nxt ? { code: nxt.code, name: nxt.name, due: nxt.due, days_remaining: nxt.days_remaining, headroom_days: nxt.headroom_days } : null } };
}

export async function milestones(tx: Tx, criticalities?: string[] | null) {
  const asOf = (await queries.deal(tx)).as_of;
  return { as_of: asOf, items: await queries.timeline(tx, criticalities),
    deadlines: (await queries.deadlines(tx)).map((d) => deadlinePosition(d, asOf)) };
}

export async function checks(tx: Tx) {
  const details = await queries.dataQualityDetails(tx);
  const out = Object.entries(queries.CHECK_DESCRIPTIONS).map(([name, [title, explanation]]) =>
    ({ check: name, title, description: explanation, items: details[name]! }));
  return { passed: out.every((c) => !c.items.length), checks: out };
}
