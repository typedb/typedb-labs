// Progress, derived from the work items TypeDB holds (docs/phase6-plan.md §12, decision D5).
//
// Two measures, never one unweighted average:
//
// - Activity completion: the duration-weighted mean of reported progress over items that have a duration
//   (a planned start and a due date). An item's weight is its planned length in days, a stated proxy for
//   effort, so a six-week drafting task counts for more than a two-day filing. Complete items count as 100%.
// - Milestone readiness: point-in-time milestones and conditions achieved, out of all of them.
//
// Contractual deadlines are excluded from both: they are limits, not work. Calculated here because
// TypeQL can't subtract dates; every input is read from TypeDB.

import { daysBetween, pyRound } from "./py.ts";

export interface ProgressItem {
  type?: string | null;
  status?: string | null;
  due?: string | null;
  planned_start?: string | null;
  progress?: number | null;
}

export interface ActivityCompletion {
  percent: number;
  items: number;
  weighted_days: number;
}

/** {percent, items, weighted_days} over duration-bearing items, or null if there are none. */
export function activityCompletion(items: ProgressItem[]): ActivityCompletion | null {
  let total = 0;
  let weighted = 0;
  let n = 0;
  for (const it of items) {
    if (it.type === "deadline" || it.type === "workstream" || !it.planned_start || !it.due) continue;
    const days = daysBetween(it.due, it.planned_start) + 1;
    const done = it.status === "complete" ? 100 : it.progress || 0;
    total += days;
    weighted += days * done;
    n++;
  }
  if (!n) return null;
  return { percent: pyRound(weighted / total), items: n, weighted_days: total };
}

/** {achieved, total} over point-in-time items (no planned start), deadlines excluded. */
export function milestoneReadiness(items: ProgressItem[]): { achieved: number; total: number } {
  const points = items.filter((it) => it.type !== "deadline" && it.type !== "workstream" && !it.planned_start);
  return { achieved: points.filter((it) => it.status === "complete").length, total: points.length };
}

export interface ProgressSummary {
  percent: number;
  basis: string;
  activity_completion: ActivityCompletion | null;
  milestone_readiness: { achieved: number; total: number };
}

/** Both measures, plus the headline: activity completion where there is any, otherwise readiness. */
export function summary(items: ProgressItem[]): ProgressSummary {
  const completion = activityCompletion(items);
  const readiness = milestoneReadiness(items);
  let headline: number;
  let basis: string;
  if (completion) {
    headline = completion.percent;
    basis = `Duration-weighted completion of ${completion.items} items with planned durations`;
  } else if (readiness.total) {
    headline = pyRound((100 * readiness.achieved) / readiness.total);
    basis = `Milestones achieved (${readiness.achieved} of ${readiness.total}); no activities with durations`;
  } else {
    headline = 0;
    basis = "No work items yet";
  }
  return { percent: headline, basis, activity_completion: completion, milestone_readiness: readiness };
}
