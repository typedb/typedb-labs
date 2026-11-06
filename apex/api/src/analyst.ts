// AI Analyst: a concept preview (/api/analyst). No AI model, chatbot, free text or agent runtime.
//
// Each investigation is a fixed sequence of steps. "Executed" steps call Apex's existing query modules in one READ
// transaction and record exactly which queries they ran; "hypothetical" steps describe what an AI agent could do
// next with those results. They are written in advance, filled in from the executed results, and labelled as such.

import * as impact from "./impact.ts";
import * as parties from "./parties.ts";
import * as queries from "./queries.ts";
import { daysBetween, minBy, sorted, sortedUnique } from "./py.ts";
import type { Tx } from "./typedb.ts";

export const INVESTIGATIONS: Record<string, [string, string]> = {
  "closing-risks": ["What could stop this deal closing?",
    "Open conditions, the deadlines they put at risk, the risks recorded against them, and how their owners are engaging."],
  "who-acts": ["Who needs to act now?",
    "Overdue and imminent responses, near-term responsibilities and deal-risk flags, each with its supporting records."],
  "regulatory-delay": ["What if the CMA review runs long?",
    "The consequences of delaying the at-risk clearance, from the recursive dependency walk, and the work that could shorten it."],
};

interface Link {
  label: string;
  to: string;
}

interface Finding {
  text: string;
  links: Link[];
  code?: string;
}

interface Step {
  kind: "executed" | "hypothetical";
  title: string;
  how: string;
  findings: Finding[];
  queries: number[];
}

class Steps {
  readonly tx: Tx;
  readonly asOf: string;
  readonly out: Step[] = [];

  constructor(tx: Tx, asOf: string) {
    this.tx = tx;
    this.asOf = asOf;
  }

  async executed(title: string, how: string, work: () => Promise<Finding[]>): Promise<Finding[]> {
    const start = this.tx.queries.length;
    const findings = await work();
    const ran = [];
    for (let i = start; i < this.tx.queries.length; i++) ran.push(i);
    this.out.push({ kind: "executed", title, how, findings, queries: ran });
    return findings;
  }

  hypothetical(title: string, how: string, findings: Finding[]): void {
    this.out.push({ kind: "hypothetical", title, how, findings, queries: [] });
  }
}

/** Unknown investigation key (the API answers 404). */
export class UnknownInvestigation extends Error {}

function itemLink(code: string, items: queries.Items): Link {
  const ws = items[code]!.workstream;
  return { label: items[code]!.name ?? "", to: ws ? `/workstreams/${ws}?item=${code}` : `/workstreams/${code}` };
}

function person(code: string, names: Record<string, string>): Link {
  return { label: names[code] ?? code, to: `/parties/${code}` };
}

export async function run(tx: Tx, key: string) {
  if (!(key in INVESTIGATIONS)) throw new UnknownInvestigation(key);
  const [title, question] = INVESTIGATIONS[key]!;
  const deal = await queries.deal(tx);
  const steps = new Steps(tx, deal.as_of);
  await ({ "closing-risks": closingRisks, "who-acts": whoActs, "regulatory-delay": regulatoryDelay })[key]!(tx, steps);
  return { key, title, question, as_of: deal.as_of, steps: steps.out.map((s) => ({ ...s, findings: s.findings.map(({ code: _code, ...f }) => f) })),
    investigations: Object.entries(INVESTIGATIONS).map(([k, [t]]) => ({ key: k, title: t })) };
}

async function floatsOf(tx: Tx) {
  const items = await queries.allItems(tx);
  const floats = impact.scheduleFloat(items, await queries.allDependencies(tx), await queries.allDeadlineLimits(tx),
    new Set(await queries.hardDependencyKinds(tx)));
  return { items, floats, critical: impact.criticalPaths(floats) };
}

async function namesOf(tx: Tx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [c, t] of Object.entries(await queries.connectables(tx))) out[c] = t.name;
  return out;
}

async function closingRisks(tx: Tx, steps: Steps): Promise<void> {
  const open = await steps.executed(
    "Find the conditions to completion that are not yet satisfied",
    "The parent type `condition` returns every clearance, approval and court sanction in one query.",
    async () => (await queries.conditions(tx)).filter((c) => c.status !== "complete").map((c) =>
      ({ text: `${c.name}: ${c.status!.replace(/-/g, " ")}, due ${c.due}`, links: [], code: c.code })));
  let items: queries.Items = {};
  let critical: Record<string, impact.CriticalPath> = {};

  await steps.executed("Measure each contractual deadline's exposure and deadline-critical chain",
    "Schedule float from the Impact Explorer's projection over every hard dependency (one calculation for all screens).",
    async () => {
      const found = await floatsOf(tx);
      items = found.items;
      critical = found.critical;
      return sorted(Object.entries(critical), ([, cp]) => cp.float).map(([dl, cp]) =>
        ({ text: `${items[dl]!.name} (${items[dl]!.due}) can absorb ${cp.float} days of delay; its deadline-critical chain: `
          + cp.items.map((c) => items[c]!.name).join(" → "),
        links: [{ label: "Show on the Gantt", to: `/?cp=${dl}` }] }));
    });
  const onPath = new Set([...Object.values(critical).flatMap((cp) => cp.items), ...open.map((f) => f.code!)]);

  const foundRisks = await steps.executed("Find the open risks recorded against those items",
    "risk-exposure links each risk to the items it threatens; risk-ownership gives its one owner.", async () => {
      const found: Record<string, queries.Risk> = {};
      for (const wsRisks of Object.values(await queries.workstreamRisks(tx))) {
        for (const r of wsRisks) if (r.status !== "closed" && r.items.some((i) => onPath.has(i))) found[r.code] = r;
      }
      return Object.values(found).map((r) => ({ text: `${r.name} (${r.severity} severity, ${r.likelihood} likelihood), owned by ${r.owner!.name}`,
        links: r.items.filter((c) => onPath.has(c)).map((c) => itemLink(c, items)).slice(0, 2) }));
    });

  await steps.executed("Check how the people accountable and responsible for them are engaging",
    "The engagement policy (config/engagement-policy.yaml) over requests, meetings and other events, item by item.",
    async () => {
      const ctx = await parties.context(tx);
      const names: Record<string, string> = {};
      for (const p of ctx.people) names[p.code] = p.name;
      const holders = sortedUnique(ctx.raci.filter((r) => onPath.has(r.item) && "AR".includes(r.letter) && r.holder in names).map((r) => r.holder));
      const out: Finding[] = [];
      let quiet = 0;
      for (const h of holders) {
        const [party, staff] = parties.partyOf(ctx, h);
        const a = parties.assess(ctx, party!, staff);
        if (a.level === "red" || a.level === "amber") {
          out.push({ text: `${names[h]}: ${a.level} (${a.category.replace(/-/g, " ")}). ${a.headline}`, links: [person(h, names)] });
        } else {
          quiet++;
        }
      }
      out.push({ text: `${quiet} other Accountable or Responsible people on these items are green, not yet active, or have nothing to assess.`, links: [] });
      return out;
    });
  const tightest = minBy(Object.entries(critical), ([, cp]) => cp.float)!;
  steps.hypothetical(
    "Brief the deal team",
    "An AI agent could turn the findings above into a short briefing and suggested next steps, citing each record. "
      + "Here the sentence is a fixed template filled with the executed results.",
    [{ text: `The tightest exposure is ${items[tightest[0]]!.name}: ${tightest[1].float} days of float, driven by `
        + `${items[tightest[1].items[0]!]!.name}. ${foundRisks.length} open risks are recorded against the items that `
        + "decide closing. Suggested next step: confirm the remedy plan and the Accountable sign-off on the CMA response.",
    links: [{ label: "Open the Impact Explorer", to: `/impact?item=${tightest[1].items[0]}` }] }]);
}

async function whoActs(tx: Tx, steps: Steps): Promise<void> {
  let ctx: parties.Context | undefined;
  let names: Record<string, string> = {};
  let found: [string, import("./engagement.ts").Assessment][] = [];

  await steps.executed("Read every request, reply, event and responsibility, and apply the engagement policy",
    "One READ transaction: people and organisations, RACI on the parent type, every event with its replies, the "
      + "schema's engagement and outreach types, authority reviews, and the dependency data for schedule float.",
    async () => {
      ctx = await parties.context(tx);
      names = {};
      for (const p of ctx.people) names[p.code] = p.name;
      for (const o of ctx.organisations) names[o.code] = o.name;
      found = [];
      for (const code of Object.keys(names)) {
        const [party, staff] = parties.partyOf(ctx, code);
        for (const a of parties.assess(ctx, party!, staff).assessments) found.push([code, a]);
      }
      const flagged = found.filter(([, a]) => a.level === "red" || a.level === "amber");
      return [{ text: `${flagged.length} red or amber findings across ${new Set(flagged.map(([c]) => c)).size} people and organisations.`, links: [] }];
    });

  const of = (category: string): Finding[] => found.filter(([, a]) => a.category === category).map(([c, a]) =>
    ({ text: `${names[c]}: ${a.reason}`, links: [person(c, names)] }));
  for (const [title, category, how] of [
    ["Find responses that are overdue", "overdue-response",
      "Requests whose reply-by date has passed with no reply relation recorded: a fact, not an inference."],
    ["Find responses due in the next two days", "response-due", "The same requests, with reply-by dates inside the policy's warning window."],
    ["Find deal-risk flags", "deal-risk", "Inactivity on an item that is schedule-critical or recorded as critical, and due soon or at risk."],
  ] as [string, string, string][]) {
    steps.out.push({ kind: "executed", title, how: how + " Uses the records read in step 1.", findings: of(category), queries: [] });
  }

  await steps.executed("Find Accountable and Responsible people on items due within 14 days",
    "Each item's due date, joined to the RACI letters read in step 1.", async () => {
      const items = await queries.allItems(tx);
      const raci = ctx!.raci;
      const out: Finding[] = [];
      for (const [code, it] of sorted(Object.entries(items), ([, it]) => it.due || "")) {
        if (it.status === "complete" || it.type === "deadline" || it.type === "workstream" || !it.due) continue;
        const days = daysBetween(it.due, steps.asOf);
        if (days >= 0 && days <= 14) {
          const who = sorted(raci.filter((r) => r.item === code && "AR".includes(r.letter) && r.holder in names).map((r) => r.holder));
          out.push({ text: `${it.name}: due in ${days} days; ` + who.map((h) => names[h]).join(", "),
            links: [itemLink(code, items), ...who.map((h) => person(h, names)).slice(0, 2)] });
        }
      }
      return out;
    });
  const overdue = found.filter(([, a]) => a.category === "overdue-response");
  steps.hypothetical(
    "Draft reminders for a person to review",
    "An AI agent could draft one reminder per overdue response, citing the request. Apex sends nothing: it is read-only "
      + "and has no messaging. Shown: the subject line a draft would carry, filled from the request record.",
    overdue.map(([c, a]) => ({ text: `Draft subject for ${names[c]}: “Response overdue: ${a.evidence[0]!.label}”`, links: [person(c, names)] })));
}

async function regulatoryDelay(tx: Tx, steps: Steps): Promise<void> {
  let code = "";
  let items: queries.Items = {};
  let days = 0;
  let breaks: number[] = [];

  await steps.executed("Pick the condition recorded as at risk",
    "The first open condition whose status is at risk or delayed, by due date.", async () => {
      code = (await impact.defaultSubject(tx))!;
      items = await queries.allItems(tx);
      return [{ text: `${items[code]!.name}: ${items[code]!.status!.replace(/-/g, " ")}, due ${items[code]!.due}`, links: [itemLink(code, items)] }];
    });

  await steps.executed("Find where the delay breaks each contractual deadline",
    "The recursive impact_edges function walks every hard dependency to any depth; each breaking point is found by search.",
    async () => {
      const base = await impact.scenario(tx, code, 0);
      breaks = sorted(base.deadlines.map((d) => d.breach_from_days).filter((d): d is number => Boolean(d)));
      days = breaks[0]!;
      const result = await impact.scenario(tx, code, days);
      const broken = result.deadlines.filter((d) => d.breached).map((d) => d.name);
      const later: Record<string, number> = {};
      for (const d of base.deadlines) if (d.breach_from_days && !broken.includes(d.name)) later[d.name ?? ""] = d.breach_from_days;
      return [{ text: `The first deadline breaks at ${days} days of delay: ${broken.join(", ")}. `
          + `${result.summary.moved} items move, and ${result.summary.people.length} people hold a RACI letter on affected items.`,
      links: [{ label: `Open the ${days}-day scenario`, to: `/impact?item=${code}&days=${days}` }] },
      { text: "Later breaking points: " + sorted(Object.entries(later), ([, v]) => v).map(([n, v]) => `${n} at ${v} days`).join("; ") + ".",
        links: [{ label: `Open the ${breaks[breaks.length - 1]}-day scenario`, to: `/impact?item=${code}&days=${breaks[breaks.length - 1]}` }] }];
    });

  const found = await steps.executed("Find open work that feeds the clearance",
    "Dependencies into the clearance of the informing kind: work whose result shapes it without fixing its date.",
    async () => {
      const deps = await queries.allDependencies(tx);
      const raci = await queries.allRaci(tx);
      const names = await namesOf(tx);
      const out: Finding[] = [];
      for (const d of deps) {
        if (d.to === code && d.kind === "informing" && items[d.from]!.status !== "complete") {
          const src = d.from;
          const owners = sorted(raci.filter((r) => r.item === src && "AR".includes(r.letter)).map((r) => r.holder));
          out.push({ text: `${items[src]!.name} informs ${items[code]!.name}; led by ` + owners.map((o) => names[o] ?? o).join(", "),
            links: [itemLink(src, items), ...owners.map((o) => person(o, names)).slice(0, 2)] });
        }
      }
      return out;
    });
  steps.hypothetical(
    "Compare options",
    "An AI agent could weigh the options against the breaking points, for example whether an undertakings-in-lieu offer "
      + "could land inside the first threshold, and cite the records it relied on. Nothing here is generated.",
    [{ text: `Question it would test: can the work above settle the CMA's concern within ${days - 1} days of extra time?`,
      links: found.length ? found[0]!.links.slice(0, 1) : [] }]);
}
