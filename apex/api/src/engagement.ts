// Engagement risk (decision D9, docs/phase6-plan.md §5.3, §5.4 and §12): deterministic, explainable,
// and computed here over records read from TypeDB. Thresholds come from config/engagement-policy.yaml.
//
// Four things are kept apart, each with its own category:
// - Overdue response (a fact): a request addressed to the party, with a reply-by date that has passed and
//   no response recorded. Red, whatever else they have done ("response due soon" is amber).
// - Inactivity: days without engagement on an assigned, active item, against the letter's thresholds.
//   Only engagement on that item counts; activity elsewhere is shown as context and never improves a rating.
// - Deal risk: inactivity on an item that matters now (schedule-critical or recorded as critical, and due
//   soon or at risk): amber is escalated one step to red, and the reason says which condition applied.
// - Insufficient information: no engagement recorded for the party at all. Shown as Unknown, never red.
//
// Authorities (regulators, courts) are assessed against their statutory timetable and the requests sent to
// them, never against silence. Delivery risk (an item at risk, delayed or overdue) is reported separately.

import { ENGAGEMENT_POLICY } from "./generated/assets.ts";
import * as impact from "./impact.ts";
import type { Items, RaciRow, WorkstreamEvent } from "./queries.ts";
import { addDays, dayMonth, dayMonthYear, daysBetween, maxBy, plural, sorted } from "./py.ts";

export const LEVELS = ["red", "amber", "green"]; // assessed levels, strongest first
// Within a level, a fact outranks an inference: an overdue response first, then deal risk, then inactivity.
export const CATEGORY_ORDER = ["overdue-response", "statutory-timetable", "deal-risk", "response-due", "inactivity"];
export const LETTER_ORDER = "ARCI";
export const CONDITIONS = ["regulatory-clearance", "shareholder-approval", "court-sanction"];
export const PROBLEMS = ["at-risk", "delayed"];

export interface Policy {
  inactivity: Record<string, { amber_from: number; red_from: number }>;
  response_warning_days: number;
  milestone_active_window_days: number;
  urgent_window_days: number;
  critical_float_days: number;
  near_critical_float_days: number;
  statutory_warning_days: number;
}

let loaded: Policy | undefined;

export function policy(): Policy {
  return (loaded ??= ENGAGEMENT_POLICY as Policy);
}

/** The date part of a date or datetime text. */
function d(v: string): string {
  return v.slice(0, 10);
}

// Schedule float lives with the projection it uses (impact.ts), so every screen shares one calculation.
export const scheduleFloat = impact.scheduleFloat;

// ---- Assessments ------------------------------------------------------------------------------

export interface Evidence {
  kind: string;
  code: string;
  label: string | null;
  date: string | null;
}

export interface Assessment {
  kind: string; // "assignment", "request" or "review"
  item: string;
  level: string; // red, amber, green, unknown, not-yet-active, not-assessed
  category: string; // overdue-response, response-due, inactivity, deal-risk, insufficient-information, ...
  reason: string;
  letter: string | null;
  days: number | null;
  due: string | null;
  evidence: Evidence[];
  context: string | null;
}

function assessment(kind: string, item: string, level: string, category: string, reason: string,
  extra: Partial<Pick<Assessment, "letter" | "days" | "due" | "evidence" | "context">> = {}): Assessment {
  return { kind, item, level, category, reason, letter: extra.letter ?? null, days: extra.days ?? null,
    due: extra.due ?? null, evidence: extra.evidence ?? [], context: extra.context ?? null };
}

function rank(a: Assessment): [number, number, number, string] {
  const lv = LEVELS.includes(a.level) ? LEVELS.indexOf(a.level) : LEVELS.length;
  const cat = CATEGORY_ORDER.includes(a.category) ? CATEGORY_ORDER.indexOf(a.category) : CATEGORY_ORDER.length;
  const lt = a.letter ? LETTER_ORDER.indexOf(a.letter) : LETTER_ORDER.length;
  return [lv, cat, lt, a.due || "9999"];
}

export interface Party {
  code: string;
  name: string;
  kind: "person" | "organisation";
  employer: string | null;
  authority: boolean;
}

function requestAssessment(e: WorkstreamEvent, asOf: string, p: Policy): Assessment {
  const due = d(e.response_due!);
  const days = daysBetween(due, asOf);
  const sent = `sent by ${e.actor.name} on ${dayMonth(d(e.when))}`;
  const evidence: Evidence[] = [{ kind: "request", code: e.code, label: e.summary, date: e.when.slice(0, 10) },
    { kind: "item", code: e.item.code, label: e.item.name, date: null }];
  if (days < 0) {
    return assessment("request", e.item.code, "red", "overdue-response",
      `Response to “${e.summary}” (${sent}) was due ${dayMonthYear(due)}: overdue by ${plural(-days, "day")}, and no response is recorded.`,
      { days: -days, due, evidence });
  }
  if (days <= p.response_warning_days) {
    return assessment("request", e.item.code, "amber", "response-due",
      `Response to “${e.summary}” (${sent}) is due ${dayMonthYear(due)}, in ${plural(days, "day")}; none recorded yet.`,
      { days, due, evidence });
  }
  return assessment("request", e.item.code, "green", "response-awaited",
    `Response to “${e.summary}” is due ${dayMonthYear(due)}, in ${plural(days, "day")}.`, { days, due, evidence });
}

export interface Result {
  level: string;
  category: string;
  profile: string;
  headline: string;
  flags: Record<string, number>;
  no_engagement_recorded: boolean;
  assessments: Assessment[];
}

/**
 * Every assessment for one party, its overall level and a one-line explanation.
 *
 * party: {code, name, kind: "person"|"organisation", authority, employer}
 * items: {code: {name, type, status, due, planned_start, actual_start, criticality, workstream}}
 * raci: [{holder, item, letter}]; events: workstreamEvents() rows; reviews: [{authority, clearance}]
 * floats: scheduleFloat(); employees: codes of the organisation's people (for an organisation).
 */
export function assess(party: Party, asOfValue: string, items: Items, raci: RaciRow[], events: WorkstreamEvent[],
  engagementTypes: Set<string>, reviews: { authority: string; clearance: string }[], floats: Record<string, impact.Float>,
  employees: readonly string[] = [], p: Policy | null = null, outreachTypes: Set<string> = new Set()): Result {
  p = p || policy();
  const asOf = d(asOfValue);
  const code = party.code;
  const members = new Set([code, ...employees]);
  const addressed = new Set([code, ...(party.employer ? [party.employer] : [])]);
  const mine = raci.filter((r) => r.holder === code);
  const assignedItems = new Set(mine.map((r) => r.item));

  const engagedBy = (e: WorkstreamEvent): boolean => {
    // The schema's engagement subtypes (response, meeting, delivery, decision) by the party, or a meeting
    // they attended; outreach (requests, notices) counts for its sender, never for its recipients, and an
    // automated notice never counts.
    if (e.automated) return false;
    if (engagementTypes.has(e.type)) return members.has(e.actor.code) || e.attendees.some((a) => members.has(a.code));
    return outreachTypes.has(e.type) && members.has(e.actor.code);
  };

  const engagements = events.filter(engagedBy);
  const out: Assessment[] = [];

  // 1. Requests awaiting this party's response (always assessed: they are facts, not inferences).
  for (const e of events) {
    if (e.type !== "request" || !e.response_due || e.answered_by.length) continue;
    const to = new Set(e.recipients.map((r) => r.code));
    const direct = to.has(code);
    const viaOrg = [...addressed].some((a) => a !== code && to.has(a)) && assignedItems.has(e.item.code);
    if (direct || viaOrg) out.push(requestAssessment(e, asOf, p));
  }

  if (party.authority) {
    // 2B. Authorities: their statutory timetable, never silence.
    for (const rv of reviews) {
      if (rv.authority !== code) continue;
      const c = items[rv.clearance]!;
      const ev: Evidence[] = [{ kind: "item", code: rv.clearance, label: c.name, date: c.due }];
      if (c.status === "complete") {
        out.push(assessment("review", rv.clearance, "not-assessed", "decision-recorded", `Decision recorded on ${c.name}.`, { due: c.due, evidence: ev }));
        continue;
      }
      const days = daysBetween(d(c.due!), asOf);
      let level: string;
      let why: string;
      if (days < 0) {
        level = "red";
        why = `the statutory decision date (${dayMonthYear(d(c.due!))}) passed ${plural(-days, "day")} ago with no decision recorded`;
      } else if (days <= p.statutory_warning_days) {
        level = "amber";
        why = `a decision is due within ${plural(days, "day")} (${dayMonthYear(d(c.due!))}) and none is recorded yet`;
      } else {
        level = "green";
        why = `its decision is due ${dayMonthYear(d(c.due!))}, in ${plural(days, "day")}: normal progress`;
      }
      out.push(assessment("review", rv.clearance, level, "statutory-timetable", `Statutory timetable for ${c.name}: ${why}.`, { days, due: c.due, evidence: ev }));
    }
    for (const r of mine) {
      const it = items[r.item]!;
      out.push(assessment("assignment", r.item, "not-assessed", "authority",
        `${r.letter} on ${it.name}: authorities are not assessed on inactivity.`,
        { letter: r.letter, due: it.due, evidence: [{ kind: "item", code: r.item, label: it.name, date: it.due }] }));
    }
    return combine(party, out, "Statutory timetable");
  }

  // 2A. Deal participants: inactivity on each open, active assignment.
  const noEngagementAtAll = !engagements.length;
  const lastAny = maxBy(engagements.map((e) => e.when), (w) => w);
  for (const r of mine) {
    const it = items[r.item]!;
    const letter = r.letter;
    if (it.status === "complete") continue;
    const evItem: Evidence = { kind: "item", code: r.item, label: it.name, date: it.due };
    if (!(letter in p.inactivity)) {
      out.push(assessment("assignment", r.item, "not-assessed", "requests-only",
        `${letter} on ${it.name}: ${letter === "C" ? "Consulted" : "Informed"} people act when asked, so they are assessed on the requests sent to them, not on silence.`,
        { letter, due: it.due, evidence: [evItem] }));
      continue;
    }
    if (it.type === "deadline") {
      out.push(assessment("assignment", r.item, "not-assessed", "deadline",
        `${letter} on ${it.name}: a contractual deadline is a limit, not work, so it is not assessed for inactivity.`,
        { letter, due: it.due, evidence: [evItem] }));
      continue;
    }
    const start = it.actual_start || it.planned_start;
    const active = start ? d(start) : addDays(d(it.due!), -p.milestone_active_window_days);
    if (active > asOf) {
      out.push(assessment("assignment", r.item, "not-yet-active", "not-yet-active",
        `${letter} on ${it.name}: not active until ${dayMonthYear(active)}, so not assessed yet.`,
        { letter, due: it.due, evidence: [evItem] }));
      continue;
    }
    if (noEngagementAtAll) {
      out.push(assessment("assignment", r.item, "unknown", "insufficient-information",
        `${letter} on ${it.name}: no engagement by ${party.name} is recorded anywhere on the deal, so there is not enough information to assess it.`,
        { letter, due: it.due, evidence: [evItem] }));
      continue;
    }
    let relevant: WorkstreamEvent[];
    let scope: string;
    if (it.type === "workstream") {
      // Oversight: a steering meeting on the workstream itself, or engagement on any of its items.
      relevant = engagements.filter((e) => e.item.code === r.item || items[e.item.code]?.workstream === r.item);
      scope = `${it.name} or any of its items`;
    } else {
      // Activity level: an event on this item, or a meeting that had it on its agenda. Attending a
      // workstream meeting that did not discuss it is not engagement on it.
      relevant = engagements.filter((e) => e.item.code === r.item || (e.agenda ?? []).some((a) => a.code === r.item));
      scope = "this item";
    }
    const last = maxBy(relevant, (e) => [e.when, e.code]);
    let days: number;
    let basis: string;
    let evidence: Evidence[];
    if (last && d(last.when) >= active) {
      days = daysBetween(asOf, d(last.when));
      const discussed = last.item.code !== r.item && (last.agenda ?? []).some((a) => a.code === r.item);
      const how = discussed ? `discussed at “${last.summary}”` : last.summary;
      basis = `last engaged on ${scope} ${plural(days, "day")} ago (${how}, ${dayMonth(d(last.when))})`;
      evidence = [evItem, { kind: "event", code: last.code, label: last.summary, date: last.when.slice(0, 10) }];
    } else {
      days = daysBetween(asOf, active);
      basis = `no engagement on ${scope} since it became active on ${dayMonthYear(active)} (${plural(days, "day")})`;
      evidence = [evItem];
    }
    const th = p.inactivity[letter]!;
    let level = days >= th.red_from ? "red" : days >= th.amber_from ? "amber" : "green";
    const threshold = `threshold for ${letter}: amber from ${th.amber_from} days, red from ${th.red_from}`;
    let category = level !== "green" ? "inactivity" : "engaged";
    let reason = `${letter} on ${it.name}: ${basis}; ${threshold}.`;
    // Escalation: inactivity on an item that matters now (amber to red only).
    const fl = floats[r.item];
    const critical: string[] = [];
    if (fl && fl.float !== null && fl.float <= p.critical_float_days) {
      critical.push(`schedule-critical (float ${plural(fl.float, "day")} to ${items[fl.deadline!]!.name})`);
    }
    if (it.criticality === "critical") critical.push("recorded as critical");
    const urgent: string[] = [];
    const dueIn = daysBetween(d(it.due!), asOf);
    if (dueIn >= 0 && dueIn <= p.urgent_window_days) urgent.push(`due in ${plural(dueIn, "day")}`);
    if (PROBLEMS.includes(it.status ?? "")) urgent.push(`recorded as ${it.status!.replace(/-/g, " ")}`);
    if (level === "amber" && critical.length && urgent.length) {
      level = "red";
      category = "deal-risk";
      reason += ` Escalated to red: the item is ${critical.join(" and ")}, and ${urgent.join(" and ")}.`;
    }
    if (fl?.deadline) {
      evidence.push({ kind: "deadline", code: fl.deadline, label: items[fl.deadline]!.name, date: items[fl.deadline]!.due });
    }
    let context: string | null = null;
    if (category !== "engaged" && lastAny && (!last || lastAny > last.when)) {
      context = `Context only, not counted: last engagement anywhere on the deal ${plural(daysBetween(asOf, d(lastAny)), "day")} ago.`;
    }
    out.push(assessment("assignment", r.item, level, category, reason, { letter, days, due: it.due, evidence, context }));
  }
  return combine(party, out, "Deal participant", noEngagementAtAll);
}

function combine(party: Party, out: Assessment[], profile: string, noEngagement = false): Result {
  const assessed = sorted(out.filter((a) => LEVELS.includes(a.level)), rank);
  let level: string;
  let category: string;
  let headline: string;
  if (assessed.length) {
    const top = assessed[0]!;
    [level, category, headline] = [top.level, top.category, top.reason];
  } else if (out.some((a) => a.level === "unknown")) {
    [level, category, headline] = ["unknown", "insufficient-information",
      `No engagement by ${party.name} is recorded anywhere on the deal: insufficient information, not a finding.`];
  } else if (out.some((a) => a.level === "not-yet-active")) {
    [level, category, headline] = ["not-yet-active", "not-yet-active", "Their open assignments have not started yet."];
  } else {
    [level, category, headline] = ["none", "none", "No open Accountable or Responsible work, and no requests awaiting them."];
  }
  const counts: Record<string, number> = {};
  for (const c of ["overdue-response", "response-due", "inactivity", "deal-risk", "insufficient-information", "not-yet-active"]) {
    counts[c] = out.filter((a) => a.category === c).length;
  }
  return { level, category, profile, headline, flags: counts, no_engagement_recorded: noEngagement,
    assessments: sorted(out, rank) };
}
