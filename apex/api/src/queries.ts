// Every TypeQL query Apex runs to answer questions (the loader's inserts are in seed.ts).
//
// Each function takes an open transaction, so callers decide its kind: the app only ever opens
// READ transactions; the loader runs the same checks inside its WRITE transaction before
// committing. Queries are explained in docs/queries.md (Q-numbers below). The query texts are
// exactly those of the original backend, so "Show TypeQL" shows what it always showed.

import { Dec } from "./decimal.ts";
import { count, sorted, sortedUnique } from "./py.ts";
import { decimalText, iid, label as rowLabel, string, value, type ConceptRow, type Tx } from "./typedb.ts";

/** A fetch document: JSON as TypeDB returns it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;

export interface Ref {
  code: string;
  name: string | null;
}

export class OwnershipDataError extends Error {
  readonly problems: OwnershipProblems;
  typeql: string[] = [];

  constructor(problems: OwnershipProblems) {
    const parts: string[] = [];
    if (problems.cycles.length) parts.push("ownership cycle through " + problems.cycles.join(", "));
    const over = Object.entries(problems.over_owned);
    if (over.length) {
      parts.push("more than 100% owned: " + over.map(([code, total]) => `${code} (${total.mul(100).toPlainString()}%)`).join(", "));
    }
    super("Ownership data inconsistent: " + parts.join("; "));
    this.problems = problems;
  }
}

export interface OwnershipProblems {
  cycles: string[];
  over_owned: Record<string, Dec>;
}

// ---- Ownership guards (Q2.7, Q2.8) ----------------------------------------------------------

export const OWNERSHIP_CYCLES = `
match let $c in ownership_cycles(); $c has code $code;
select $code; distinct;
`;

export const OVER_OWNED = `
match ownership (owned: $c), has stake $s; reduce $total = sum($s) groupby $c;
match $total > 1.0dec; $c has code $code;
fetch { "company": $code, "total": $total };
`;

/** Companies in an ownership cycle, and companies whose direct stakes add up to over 100%. */
export async function ownershipProblems(tx: Tx): Promise<OwnershipProblems> {
  const cycles = sortedUnique((await tx.rows(OWNERSHIP_CYCLES)).map((r) => value<string>(r, "code")));
  const over: Record<string, Dec> = {};
  for (const d of await tx.docs(OVER_OWNED)) over[d.company] = Dec.of(d.total);
  return { cycles, over_owned: over };
}

// ---- Effective ownership (Q2.6) --------------------------------------------------------------

export function effectiveOwnershipQuery(parentCode: string): string {
  return `
match $p isa company, has code ${string(parentCode)}; let $c, $e in group_members($p);
reduce $effective = sum($e), $routes = count groupby $c;
match $c has code $code, has name $name;
fetch { "company": $code, "name": $name, "effective stake": $effective, "routes": $routes };
`;
}

export interface EffectiveStake {
  name: string | null;
  stake: Dec;
  routes: number;
}

/**
 * {company code: {name, stake, routes}} for every company parentCode holds.
 *
 * Runs the guards first, in the same transaction, and throws OwnershipDataError instead of
 * returning figures if either finds anything: group_members is only correct without cycles.
 */
export async function effectiveOwnership(tx: Tx, parentCode: string): Promise<Record<string, EffectiveStake>> {
  const problems = await ownershipProblems(tx);
  if (problems.cycles.length || Object.keys(problems.over_owned).length) throw new OwnershipDataError(problems);
  const out: Record<string, EffectiveStake> = {};
  for (const d of await tx.docs(effectiveOwnershipQuery(parentCode))) {
    out[d.company] = { name: d.name ?? null, stake: Dec.of(d["effective stake"]), routes: d.routes };
  }
  return out;
}

export function groupConsentsQuery(parentCode: string): string {
  return `
match $p isa company, has code ${string(parentCode)}; let $c, $e in group_members($p);
      bound-by (obligor: $c, obligation: $o);
      consent-right (grantor: $g, obligation: $o);
reduce $effective = sum($e) groupby $o, $c, $g;
match $o has code $oc; $c has code $cc; $g has code $gc;
fetch { "obligation": $oc, "owed by": $cc, "consent from": $gc, "effective stake": $effective };
`;
}

export interface GroupConsent {
  obligation: string;
  owed_by: string;
  consent_from: string;
  stake: Dec;
}

/** Change-of-control consents owed anywhere in parentCode's group (Q2.10), guarded like effectiveOwnership. */
export async function groupConsents(tx: Tx, parentCode: string): Promise<GroupConsent[]> {
  const problems = await ownershipProblems(tx);
  if (problems.cycles.length || Object.keys(problems.over_owned).length) throw new OwnershipDataError(problems);
  const docs = await tx.docs(groupConsentsQuery(parentCode));
  return sorted(docs.map((d) => ({ obligation: d.obligation as string, owed_by: d["owed by"] as string,
    consent_from: d["consent from"] as string, stake: Dec.of(d["effective stake"]) })), (r) => r.obligation);
}

// ---- Data-quality checks (Q1.8) --------------------------------------------------------------

export const DATA_QUALITY_CHECKS: Record<string, string> = {
  no_accountable: `
match $x isa deal-item, has code $c; not { accountability (accountable-item: $x); };
fetch { "code": $c, "name": $x.name };
`,
  overdue: `
match $d isa acquisition, has as-of-date $today;
      $x isa deal-item, has code $c, has due-date $due; $due < $today;
      not { $x has status "complete"; };
fetch { "code": $c, "name": $x.name };
`,
  clearance_without_authority: `
match $x isa regulatory-clearance, has code $c; not { authority-review (subject: $x, reviewer: $r); };
fetch { "code": $c, "name": $x.name };
`,
};

// What each check means, in words for the "Attention needed" card: [title, explanation].
export const CHECK_DESCRIPTIONS: Record<string, [string, string]> = {
  no_accountable: ["No accountable owner", "Work items with nobody Accountable (the A in RACI)."],
  overdue: ["Overdue", "Items due before the deal's as-of date that are not complete."],
  clearance_without_authority: ["Clearance with no reviewing authority",
    "Regulatory clearances with no authority recorded as reviewing them."],
};

/** {check name: [{code, name}] sorted by code}. On the seed data every list is empty. */
export async function dataQualityDetails(tx: Tx): Promise<Record<string, Ref[]>> {
  const out: Record<string, Ref[]> = {};
  for (const [name, q] of Object.entries(DATA_QUALITY_CHECKS)) {
    const found: Record<string, string | null> = {};
    for (const d of await tx.docs(q)) found[d.code] = d.name ?? null;
    out[name] = sorted(Object.keys(found)).map((c) => ({ code: c, name: found[c]! }));
  }
  return out;
}

/** {check name: sorted item codes}. On the seed data every list is empty. */
export async function dataQualityChecks(tx: Tx): Promise<Record<string, string[]>> {
  const details = await dataQualityDetails(tx);
  const out: Record<string, string[]> = {};
  for (const [name, items] of Object.entries(details)) out[name] = items.map((i) => i.code);
  return out;
}

// ---- Impact inputs (Q3.1, Q3.2, Q3.3) --------------------------------------------------------

export function impactEdgesQuery(startCode: string): string {
  return `
match $start isa deal-item, has code ${string(startCode)};
      let $from, $dep, $to in impact_edges($start);
      $dep isa! $kind; $from has code $fc; $to has code $tc;
fetch { "from": $fc, "to": $tc, "lag": $dep.lag-days, "kind": $kind };
`;
}

export const ALL_ITEMS = `
match $x isa deal-item; $x isa! $t;
fetch { "item": { $x.* }, "type": $t,
        "workstream": [ match work-breakdown (whole: $w, part: $x); fetch { "code": $w.code }; ] };
`;

export const ALL_DEADLINE_LIMITS = `
match deadline-limit (limited-item: $x, deadline: $dl);
fetch { "item": $x.code, "deadline": { $dl.* },
        "bound": [ match bound-by (obligor: $o, obligation: $dl); fetch { "code": $o.code }; ] };
`;

export interface Edge {
  from: string;
  to: string;
  lag: number | null;
  kind: string;
}

/** Every hard-dependency step downstream of startCode: [{from, to, lag, kind}]. */
export async function impactEdges(tx: Tx, startCode: string): Promise<Edge[]> {
  const edges = new Map<string, Doc>();
  for (const d of await tx.docs(impactEdgesQuery(startCode))) edges.set(`${d.from}\u0000${d.to}`, d);
  return [...edges.values()].map((d) => ({ from: d.from, to: d.to, lag: d.lag ?? null, kind: d.kind.label }));
}

export interface ItemRecord {
  name: string | null;
  type: string;
  status: string | null;
  criticality: string | null;
  due: string | null;
  planned_start: string | null;
  actual_start: string | null;
  progress: number | null;
  workstream: string | null;
}

export type Items = Record<string, ItemRecord>;

/** {code: {name, type, status, criticality, due, planned_start, actual_start, progress, workstream}} for every deal-item. */
export async function allItems(tx: Tx): Promise<Items> {
  const out: Items = {};
  for (const d of await tx.docs(ALL_ITEMS)) {
    const item = d.item;
    out[item.code] = {
      name: item.name ?? null, type: d.type.label, status: item.status ?? null,
      criticality: item.criticality ?? null, due: item["due-date"] ?? null,
      planned_start: item["planned-start"] ?? null, actual_start: item["actual-start-date"] ?? null,
      progress: item.progress ?? null, workstream: d.workstream.length ? d.workstream[0].code : null,
    };
  }
  return out;
}

export interface DeadlineLimit {
  item: string;
  deadline: string;
  name: string | null;
  due: string;
  consequence: string | null;
  bound: string[];
}

/** [{item, deadline, name, due, consequence, bound: [codes]}]. */
export async function allDeadlineLimits(tx: Tx): Promise<DeadlineLimit[]> {
  const out: DeadlineLimit[] = [];
  for (const d of await tx.docs(ALL_DEADLINE_LIMITS)) {
    const dl = d.deadline;
    out.push({ item: d.item, deadline: dl.code, name: dl.name ?? null, due: dl["due-date"],
      consequence: dl.consequence ?? null, bound: sortedUnique((d.bound as Doc[]).map((b) => b.code)) });
  }
  return out;
}

// ---- Counting, used by the loader to prove everything arrived --------------------------------

/** How many instances have exactly this type (not counting subtypes). */
export async function countExact(tx: Tx, typeLabel: string): Promise<number> {
  const result = await tx.rows(`match $x isa! ${typeLabel}; reduce $n = count;`);
  return result.length ? value<number>(result[0]!, "n") : 0;
}

export async function countsByType(tx: Tx, typeLabels: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const l of typeLabels) out[l] = await countExact(tx, l);
  return out;
}

// ---- Deal Overview (Q1.1-Q1.7) ---------------------------------------------------------------
// The database holds one deal, so these queries find "the" acquisition rather than naming it.

/** The database doesn't hold exactly one acquisition, so the Overview can't be answered. */
export class NoDealError extends Error {}

export const CODE_TEXT = /^[A-Z]{2,5}-[A-Z0-9]+(-[A-Z0-9]+)*$/;
export const CRITICALITIES = ["low", "medium", "high", "critical"]; // the schema's @values for criticality
export const RACI_LETTERS: Record<string, string> = { responsibility: "R", accountability: "A", consultation: "C", notification: "I" };

function typeLabel(typeDoc: Doc): string {
  return typeDoc.label;
}

/** A fetched datetime ("2026-09-02T23:59:00.000000000") without the nanoseconds. */
export function when(v: string | null | undefined): string | null {
  return v ? v.split(".")[0]! : (v ?? null);
}

/** An exact decimal amount as plain text: "2400000000.0" -> "2400000000". */
export function money(v: unknown): string {
  const text = decimalText(v);
  const amount = Dec.of(text);
  return amount.eq(Dec.of(amount.unscaled / 10n ** BigInt(amount.scale))) ? amount.toString() : text;
}

export interface Item {
  code: string;
  name: string | null;
  status: string | null;
  criticality: string | null;
  due: string | null;
  progress: number | null;
  completed: string | null;
  type?: string;
}

/** The common fields of a deal-item fetched with { $x.* }. */
export function item(doc: Doc, type?: string): Item {
  const out: Item = { code: doc.code, name: doc.name ?? null, status: doc.status ?? null,
    criticality: doc.criticality ?? null, due: doc["due-date"] ?? null,
    progress: doc.progress ?? null, completed: doc["completed-date"] ?? null };
  if (type) out.type = type;
  return out;
}

export interface Organisation {
  code: string;
  name: string | null;
  description: string | null;
  jurisdiction: string | null;
  sector: string | null;
}

export function org(doc: Doc): Organisation {
  return { code: doc.code, name: doc.name ?? null, description: doc.description ?? null,
    jurisdiction: doc.jurisdiction ?? null, sector: doc.sector ?? null };
}

export const DEAL = `
match $d isa acquisition (acquirer: $buyer, target: $target);
fetch { "deal": { $d.* }, "acquirer": { $buyer.* }, "target": { $target.* } };
`;

export interface Deal {
  code: string;
  name: string | null;
  description: string | null;
  value: string;
  currency: string | null;
  structure: string | null;
  as_of: string;
  acquirer: Organisation;
  target: Organisation;
}

/** Q1.1: the deal's own attributes, with the acquirer and target. */
export async function deal(tx: Tx): Promise<Deal> {
  const found = await tx.docs(DEAL);
  if (found.length !== 1) throw new NoDealError(`expected exactly one acquisition in the database, found ${found.length}`);
  const d = found[0]!.deal;
  return { code: d.code, name: d.name ?? null, description: d.description ?? null,
    value: money(d["deal-value"]), currency: d.currency ?? null,
    structure: d["deal-structure"] ?? null, as_of: d["as-of-date"],
    acquirer: org(found[0]!.acquirer), target: org(found[0]!.target) };
}

export const CONDITIONS = `
match $c isa condition, has due-date $due; $c isa! $t;
sort $due asc;
fetch { "condition": { $c.* }, "type": $t };
`;

/** Every condition to completion (clearances, shareholder approval, court sanction). */
export async function conditions(tx: Tx): Promise<Item[]> {
  return (await tx.docs(CONDITIONS)).map((d) => item(d.condition, typeLabel(d.type)));
}

export const COMMITTED_FINANCING = `
match $d isa acquisition; financing (purpose: $d), has deal-value $v, has currency $cur;
reduce $total = sum($v) groupby $cur;
fetch { "currency": $cur, "total": $total };
`;

/** Total committed debt financing per currency: [{currency, total}]. */
export async function committedFinancing(tx: Tx): Promise<{ currency: string; total: string }[]> {
  const docs = await tx.docs(COMMITTED_FINANCING);
  return sorted(docs.map((d) => ({ currency: d.currency as string, total: money(d.total) })), (r) => r.currency);
}

export function timelineQuery(criticalities?: string[] | null): string {
  let filter = "";
  if (criticalities && criticalities.length) {
    const unknown = criticalities.filter((c) => !CRITICALITIES.includes(c));
    if (unknown.length) throw new Error(`unknown criticality: ${JSON.stringify(sortedUnique(unknown))}`);
    // Only the schema's own criticality words reach the query, so the pattern is safe.
    filter = ` $crit like ${string("^(" + sortedUnique(criticalities).join("|") + ")$")};`;
  }
  return `
match { $x isa milestone; } or { $x isa condition; };
      $x isa! $t, has due-date $due, has criticality $crit;${filter}
sort $due asc;
fetch { "item": { $x.* }, "type": $t,
        "workstream": [ match work-breakdown (whole: $w, part: $x); fetch { "code": $w.code, "name": $w.name }; ],
        "accountable": [ match accountability (holder: $p, accountable-item: $x); fetch { "code": $p.code, "name": $p.name }; ] };
`;
}

export interface TimelineItem extends Item {
  workstream: Ref | null;
  accountable: Ref | null;
}

/** Q1.3: milestones and conditions by due date, optionally only some criticalities. */
export async function timeline(tx: Tx, criticalities?: string[] | null): Promise<TimelineItem[]> {
  const out: TimelineItem[] = [];
  for (const d of await tx.docs(timelineQuery(criticalities))) {
    out.push({ ...item(d.item, typeLabel(d.type)),
      workstream: d.workstream.length ? ref(d.workstream[0]) : null,
      accountable: d.accountable.length ? ref(d.accountable[0]) : null });
  }
  return out;
}

function ref(doc: Doc): Ref {
  return { code: doc.code, name: doc.name ?? null };
}

export const DEADLINES = `
match $x isa deadline, has due-date $due;
sort $due asc;
fetch { "deadline": { $x.* },
        "limits": [ match deadline-limit (deadline: $x, limited-item: $i);
                    fetch { "code": $i.code, "name": $i.name, "due": $i.due-date, "status": $i.status }; ],
        "bound": [ match bound-by (obligation: $x, obligor: $o); fetch { "code": $o.code, "name": $o.name }; ],
        "consent from": [ match consent-right (obligation: $x, grantor: $g); fetch { "code": $g.code, "name": $g.name }; ] };
`;

export interface LimitedItem extends Ref {
  due: string | null;
  status: string | null;
}

export interface Deadline extends Item {
  consequence: string | null;
  legal_basis: string | null;
  limits: LimitedItem[];
  bound: Ref[];
  consent_from: Ref[];
}

/** Contractual deadlines, what each one limits, who is bound and whose consent it concerns. */
export async function deadlines(tx: Tx): Promise<Deadline[]> {
  const out: Deadline[] = [];
  for (const d of await tx.docs(DEADLINES)) {
    const dl = d.deadline;
    out.push({ ...item(dl, "deadline"), consequence: dl.consequence ?? null, legal_basis: dl["legal-basis"] ?? null,
      limits: sorted((d.limits as Doc[]).map((i) => ({ code: i.code, name: i.name ?? null, due: i.due ?? null, status: i.status ?? null })), (i) => i.code),
      bound: sorted((d.bound as Doc[]).map(ref), (o) => o.code),
      consent_from: sorted((d["consent from"] as Doc[]).map(ref), (o) => o.code) });
  }
  return out;
}

export const APPROVALS = `
match $x isa regulatory-clearance, has due-date $due;
sort $due asc;
fetch { "clearance": { $x.* },
        "reviews": [ match $r isa authority-review (reviewer: $a, subject: $x);
                     fetch { "code": $a.code, "name": $a.name, "jurisdiction": $a.jurisdiction,
                             "legal basis": $r.legal-basis, "phase": $r.review-phase,
                             "applicant": [ match $r links (applicant: $app); fetch { "name": $app.name }; ] }; ],
        "accountable": [ match accountability (holder: $p, accountable-item: $x); fetch { "code": $p.code, "name": $p.name }; ],
        "latest": [ match $e isa deal-event (subject: $x), has occurred-at $t; sort $t desc; limit 1;
                    fetch { "when": $t, "summary": $e.summary }; ] };
`;

/**
 * Q1.5: every regulatory clearance with its reviewing authorities (an n-ary relation) and
 * its latest recorded event. A clearance with no authority still appears, with no reviews.
 */
export async function approvals(tx: Tx): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const d of await tx.docs(APPROVALS)) {
    const c = d.clearance;
    out.push({ ...item(c, "regulatory-clearance"),
      description: c.description ?? null, legal_basis: c["legal-basis"] ?? null,
      reviews: sorted((d.reviews as Doc[]).map((r) => ({ code: r.code, name: r.name, jurisdiction: r.jurisdiction ?? null,
        legal_basis: r["legal basis"] ?? null, phase: r.phase ?? null,
        applicant: r.applicant.length ? r.applicant[0].name : null })), (r) => r.code),
      accountable: d.accountable.length ? ref(d.accountable[0]) : null,
      latest: d.latest.length ? { when: when(d.latest[0].when), summary: d.latest[0].summary } : null });
  }
  return out;
}

export function activityQuery(limit: number): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be a whole number from 1 to 50");
  return `
match $e isa deal-event (actor: $who, subject: $what), has occurred-at $t; $who isa! $wt;
sort $t desc; limit ${limit};
fetch { "when": $t, "summary": $e.summary, "kind": $e.event-kind, "actor type": $wt,
        "actor": { "code": $who.code, "name": $who.name },
        "employer": [ match employment (employee: $who, employer: $org); fetch { "name": $org.name }; ],
        "item": { "code": $what.code, "name": $what.name } };
`;
}

/** Q1.6: the most recent deal events, newest first. */
export async function activity(tx: Tx, limit = 10): Promise<Doc[]> {
  return (await tx.docs(activityQuery(limit))).map((d) => ({ when: when(d.when), summary: d.summary, kind: d.kind ?? null,
    actor: { ...d.actor, type: typeLabel(d["actor type"]), employer: d.employer.length ? d.employer[0].name : null },
    item: d.item }));
}

/** Sub-query: the organisation's people who hold any RACI letter on this deal (one query on the parent relation type covers all four letters). */
function team(orgVar: string): string {
  return `[ match employment (employee: $p, employer: ${orgVar}), has job-title $title; raci-assignment (holder: $p);
             select $p, $title; distinct; fetch { "code": $p.code, "name": $p.name, "title": $title }; ]`;
}

export const PRINCIPALS = `
match $d isa acquisition (acquirer: $buyer, target: $target);
fetch { "acquirer": { $buyer.* }, "acquirer team": ${team("$buyer")},
        "target": { $target.* }, "target team": ${team("$target")} };
`;

export const ADVISERS = `
match $d isa acquisition; $m isa mandate (client: $client, adviser: $adviser, engagement: $d); $adviser isa! $kind;
fetch { "mandate": $m.code, "mandate type": $m.mandate-type,
        "client": { "code": $client.code, "name": $client.name },
        "adviser": { $adviser.* }, "adviser type": $kind, "team": ${team("$adviser")} };
`;

export const LENDERS = `
match $d isa acquisition; $f isa financing (purpose: $d, lender: $l, borrower: $b); $l isa! $kind;
fetch { "facility": { $f.* }, "borrower": { "code": $b.code, "name": $b.name },
        "lender": { $l.* }, "lender type": $kind, "team": ${team("$l")} };
`;

export const AUTHORITIES = `
match $a isa authority; $a isa! $kind;
fetch { "authority": { $a.* }, "type": $kind,
        "reviews": [ match authority-review (reviewer: $a, subject: $x);
                     fetch { "code": $x.code, "name": $x.name, "status": $x.status }; ],
        "raci": [ match $ra isa raci-assignment (holder: $a, item: $i); $ra isa! $letter;
                  fetch { "letter": $letter, "code": $i.code, "name": $i.name }; ] };
`;

function people_(team: Doc[]): Doc[] {
  return sorted(team, (p) => p.code);
}

/**
 * Q1.2: everyone on the deal, by the part they play: principals, advisers (by mandate),
 * lenders (by facility) and authorities (what they review, or the RACI letters they hold).
 */
export async function parties(tx: Tx): Promise<Doc> {
  const p = (await tx.docs(PRINCIPALS))[0]!;
  const principals = [{ role: "Acquirer", organisation: org(p.acquirer), team: people_(p["acquirer team"]) },
    { role: "Target", organisation: org(p.target), team: people_(p["target team"]) }];
  const advisers = sorted((await tx.docs(ADVISERS)).map((d) => ({ mandate: d.mandate, mandate_type: d["mandate type"] ?? null, client: d.client,
    organisation: org(d.adviser), type: typeLabel(d["adviser type"]), team: people_(d.team) })),
  (a) => [a.client.code !== principals[0]!.organisation.code, a.mandate]);
  const lenders = sorted((await tx.docs(LENDERS)).map((d) => ({ facility: { code: d.facility.code, name: d.facility.name ?? null,
    value: money(d.facility["deal-value"]), currency: d.facility.currency ?? null },
  borrower: d.borrower, organisation: org(d.lender), type: typeLabel(d["lender type"]), team: people_(d.team) })),
  (l) => l.facility.code);
  const authorities = sorted((await tx.docs(AUTHORITIES)).map((d) => ({ organisation: org(d.authority), type: typeLabel(d.type),
    reviews: sorted(d.reviews as Doc[], (r) => r.code),
    raci: sorted((d.raci as Doc[]).map((r) => ({ letter: RACI_LETTERS[r.letter.label], code: r.code, name: r.name })), (r) => r.code) })),
  (a) => [!a.reviews.length, a.organisation.code]);
  return { principals, advisers, lenders, authorities };
}

export const WORKSTREAMS = `
match $ws isa workstream, has planned-start $start;
sort $start asc;
fetch { "workstream": { $ws.* },
        "accountable": [ match accountability (holder: $p, accountable-item: $ws); fetch { "code": $p.code, "name": $p.name }; ] };
`;

export const ITEM_STATUS_COUNTS = `
match $ws isa workstream, has code $w; work-breakdown (whole: $ws, part: $i); $i has status $s;
reduce $n = count groupby $w, $s;
fetch { "workstream": $w, "status": $s, "items": $n };
`;

export interface Workstream extends Item {
  type: string;
  planned_start: string | null;
  description: string | null;
  accountable: Ref | null;
  item_statuses: Record<string, number>;
  progress: number | null;
  progress_basis: string;
  milestones_achieved: number;
  milestones_total: number;
}

/**
 * Q1.4: each workstream's status, its items' status counts, and progress DERIVED from its items
 * (progress.ts: duration-weighted activity completion, and milestone readiness). Pass `items`
 * (from allItems) when the caller already has them, so the query isn't run twice.
 */
export async function workstreams(tx: Tx, items?: Items): Promise<Workstream[]> {
  const { summary } = await import("./progress.ts");
  const counts: Record<string, Record<string, number>> = {};
  for (const d of await tx.docs(ITEM_STATUS_COUNTS)) (counts[d.workstream] ??= {})[d.status] = d.items;
  const all = items ?? (await allItems(tx));
  const out: Workstream[] = [];
  for (const d of await tx.docs(WORKSTREAMS)) {
    const ws = item(d.workstream, "workstream");
    const derived = summary(Object.entries(all).filter(([, it]) => it.workstream === ws.code).map(([c, it]) => ({ ...it, code: c })));
    out.push({ ...ws, type: "workstream", planned_start: d.workstream["planned-start"] ?? null, description: d.workstream.description ?? null,
      accountable: d.accountable.length ? ref(d.accountable[0]) : null,
      item_statuses: counts[ws.code] ?? {}, progress: derived.percent,
      progress_basis: derived.basis, milestones_achieved: derived.milestone_readiness.achieved,
      milestones_total: derived.milestone_readiness.total });
  }
  return out;
}

export function raciItemsQuery(workstreamCode: string): string {
  return `
match $ws isa workstream, has code ${string(workstreamCode)}; work-breakdown (whole: $ws, part: $i);
      $i has due-date $due; $i isa! $t;
sort $due asc;
fetch { "workstream": $ws.name, "item": { $i.* }, "type": $t };
`;
}

export function raciQuery(workstreamCode: string): string {
  return `
match $ws isa workstream, has code ${string(workstreamCode)}; work-breakdown (whole: $ws, part: $i);
      $r isa raci-assignment (holder: $h, item: $i); $r isa! $kind; $h isa! $htype;
fetch { "item": $i.code, "letter": $kind, "holder": { "code": $h.code, "name": $h.name }, "holder type": $htype,
        "employer": [ match employment (employee: $h, employer: $o); fetch { "code": $o.code, "name": $o.name }; ],
        "via": [ match $r links (via: $m); $m isa mandate; fetch { "mandate": $m.code, "type": $m.mandate-type }; ] };
`;
}

/**
 * Q1.7: compact RACI matrix for one workstream. The letter is the relation's own type.
 *
 * Returns {workstream, items, holders, cells: [{item, holder, letter, via}]}, or null if there is no
 * such workstream. Holders are ordered strongest letter first (A, R, C, I).
 */
export async function raci(tx: Tx, workstreamCode: string): Promise<Doc | null> {
  const items = await tx.docs(raciItemsQuery(workstreamCode));
  if (!items.length) {
    const exists = await tx.rows(`match $ws isa workstream, has code ${string(workstreamCode)};`);
    if (!exists.length) return null;
  }
  const cells: Doc[] = [];
  const holders: Record<string, Doc & { letters: Set<string> }> = {};
  for (const d of await tx.docs(raciQuery(workstreamCode))) {
    const letter = RACI_LETTERS[typeLabel(d.letter)]!;
    const h = d.holder.code as string;
    holders[h] ??= { code: h, name: d.holder.name, type: typeLabel(d["holder type"]),
      employer: d.employer.length ? d.employer[0].name : null, letters: new Set<string>() };
    holders[h].letters.add(letter);
    cells.push({ item: d.item, holder: h, letter, via: d.via.length ? d.via[0].mandate : null });
  }
  const ordered = sorted(Object.values(holders), (h) => [Math.min(...[...h.letters].map((x) => "ARCI".indexOf(x))), h.name]);
  return { workstream: { code: workstreamCode, name: items.length ? items[0]!.workstream : null },
    items: items.map((d) => item(d.item, typeLabel(d.type))),
    holders: ordered.map(({ letters: _letters, ...h }) => h),
    cells: sorted(cells, (c) => [c.item, c.holder]) };
}

// ---- Relationship Explorer (Q2.1-Q2.3, Q2.9) -------------------------------------------------
// Generic on purpose: relations are read with `$r links ($role: $p)`, so any relation type (including
// one added later) is drawn with its own role names, and n-ary relations keep all their players.

export const PARTY_TYPES = `
match $t sub party; $t sub! $parent;
fetch { "type": $t, "parent": $parent };
`;

export const RELATION_TYPES = `
match relation $r; $r relates $role; not { $r sub! $p; $p relates $role; };
fetch { "relation": $r, "role": $role,
        "parent": [ match $r sub! $parent; fetch { "label": $parent }; ] };
`;

export const ORGANISATIONS = `
match $o isa organisation; $o isa! $t;
fetch { "organisation": { $o.* }, "type": $t,
        "people": ( match employment (employee: $p, employer: $o); return count($p); ) };
`;

export const ORGANISATION_RELATIONS = `
match $o isa organisation; $r links ($o); $r isa! $rt;
      not { $r isa employment; }; not { $r isa raci-assignment; }; not { $r isa deal-event; };
fetch { "type": $rt, "attributes": { $r.* },
        "players": [ match $r links ($role: $p); $p isa! $pt;
                     fetch { "role": $role, "type": $pt, "player": { $p.* } }; ] };
`;

/**
 * Companies the parent controls directly or indirectly: reachability only (owners_above), so it
 * is safe even if the ownership data had a cycle. Used to group nodes, never for percentages.
 */
export function groupMembersQuery(parentCode: string): string {
  return `
match $parent isa company, has code ${string(parentCode)}; $c isa company, has code $code;
      let $above in owners_above($c); $above is $parent;
select $code; distinct;
`;
}

/** "mandate:adviser" -> "adviser". */
function role(roleDoc: Doc): string {
  return (roleDoc.label as string).split(/:(.*)/s)[1]!;
}

export interface Player {
  role: string;
  code: string | null;
  name: string | null;
  type: string;
  kind: string;
}

function player(doc: Doc): Player {
  const p = doc.player;
  return { role: role(doc.role), code: p.code ?? null, name: p.name ?? null, type: typeLabel(doc.type), kind: doc.type.kind };
}

export type Attributes = Record<string, string | number | boolean | null>;

/** Relation attributes for display: decimals as exact text, everything else as given. */
function attributes(doc: Doc | null | undefined): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(doc ?? {})) {
    out[k] = k === "deal-value" ? money(v) : k === "stake" ? decimalText(v) : (v as string | number | boolean | null);
  }
  return out;
}

/**
 * A stable identifier for a relation (TypeDB's internal IDs can't be fetched): its code if it has
 * one, otherwise its type, players and attributes, so two events by the same person stay distinct.
 */
function relationKey(rtype: string, attrs: Attributes, players: { role: string; code: string | null }[]): string {
  if (attrs.code) return String(attrs.code);
  const parts = [...sorted(players.map((p) => `${p.role}=${pyStr(p.code)}`)), ...sorted(Object.entries(attrs).map(([k, v]) => `${k}=${pyStr(v)}`))];
  return rtype + ":" + parts.join(",");
}

/** Python's str() of the values a key can hold (None, True and False spelt as Python spells them). */
function pyStr(v: string | number | boolean | null): string {
  return v === null ? "None" : typeof v === "boolean" ? (v ? "True" : "False") : String(v);
}

export interface TypeHierarchy {
  parties: Record<string, string>;
  relations: Record<string, { parent: string | null; roles: string[] }>;
}

/** {parties: {type: parent}, relations: {type: {parent, roles}}} straight from the schema. */
export async function typeHierarchy(tx: Tx): Promise<TypeHierarchy> {
  const partyTypes: Record<string, string> = {};
  for (const d of await tx.docs(PARTY_TYPES)) partyTypes[d.type.label] = d.parent.label;
  const relations: Record<string, { parent: string | null; roles: string[] }> = {};
  for (const d of await tx.docs(RELATION_TYPES)) {
    const r = (relations[d.relation.label] ??= { parent: null, roles: [] });
    r.parent = d.parent.length ? d.parent[0].label.label : null;
    r.roles.push(role(d.role));
  }
  for (const r of Object.values(relations)) r.roles = sorted(r.roles);
  return { parties: partyTypes, relations };
}

export async function organisations(tx: Tx): Promise<(Organisation & { type: string; people: number })[]> {
  return (await tx.docs(ORGANISATIONS)).map((d) => ({ ...org(d.organisation), type: typeLabel(d.type), people: d.people || 0 }));
}

export interface Relation {
  key: string;
  type: string;
  attributes: Attributes;
  players: Player[];
}

/**
 * Every relation that has an organisation among its players (except employment and RACI, which
 * belong to people), each once, with all its players and their roles.
 */
export async function organisationRelations(tx: Tx): Promise<Relation[]> {
  const out: Record<string, Relation> = {};
  for (const d of await tx.docs(ORGANISATION_RELATIONS)) {
    const players = sorted((d.players as Doc[]).map(player), (p) => [p.role, p.code ?? ""]);
    const attrs = attributes(d.attributes);
    const rtype = typeLabel(d.type);
    const key = relationKey(rtype, attrs, players);
    out[key] = { key, type: rtype, attributes: attrs, players };
  }
  return sorted(Object.values(out), (r) => [r.type, r.key]);
}

export async function groupMembers(tx: Tx, parentCode: string): Promise<string[]> {
  return sorted((await tx.rows(groupMembersQuery(parentCode))).map((r) => value<string>(r, "code")));
}

export function partyRelationsQuery(code: string): string {
  return `
match $x isa party, has code ${string(code)}; $r links ($myrole: $x); $r isa! $rt;
      not { $r isa raci-assignment; }; not { $r isa deal-event; };
fetch { "type": $rt, "my role": $myrole, "attributes": { $r.* },
        "others": [ match $r links ($role: $p); not { $p is $x; }; $p isa! $pt;
                    fetch { "role": $role, "type": $pt, "player": { $p.* } }; ] };
`;
}

export function partyQuery(code: string): string {
  return `
match $x isa party, has code ${string(code)}; $x isa! $t;
fetch { "party": { $x.* }, "type": $t };
`;
}

export function peopleQuery(orgCode: string): string {
  return `
match $o isa organisation, has code ${string(orgCode)}; employment (employee: $p, employer: $o), has job-title $title;
fetch { "person": { $p.* }, "title": $title,
        "raci": [ match $a isa raci-assignment (holder: $p, item: $i); $a isa! $letter;
                  fetch { "letter": $letter, "item": { "code": $i.code, "name": $i.name },
                          "via": [ match $a links (via: $m); fetch { "code": $m.code, "type": $m.mandate-type }; ] }; ] };
`;
}

export function raciOfQuery(code: string): string {
  return `
match $h isa party, has code ${string(code)}; $a isa raci-assignment (holder: $h, item: $i); $a isa! $letter;
      $i has due-date $due; $i isa! $it;
sort $due asc;
fetch { "letter": $letter, "item": { "code": $i.code, "name": $i.name, "status": $i.status, "due": $due },
        "item type": $it,
        "via": [ match $a links (via: $m); fetch { "code": $m.code, "type": $m.mandate-type }; ] };
`;
}

function raciEntry(d: Doc): Doc {
  return { letter: RACI_LETTERS[typeLabel(d.letter)], item: d.item, via: d.via.length ? d.via[0].code : null };
}

export interface Membership {
  key: string;
  type: string;
  role: string;
  attributes: Attributes;
  others: Player[];
}

/**
 * One party with its exact type, every relation it plays a role in (role names kept, all other
 * players listed), its people (organisations) and its RACI letters. Null if no such party.
 */
export async function party(tx: Tx, code: string): Promise<Doc | null> {
  const found = await tx.docs(partyQuery(code));
  if (!found.length) return null;
  const p = found[0]!.party;
  const ptype = typeLabel(found[0]!.type);
  const relations: Record<string, Membership> = {};
  for (const d of await tx.docs(partyRelationsQuery(code))) {
    const others = sorted((d.others as Doc[]).map(player), (o) => [o.role, o.code ?? ""]);
    const attrs = attributes(d.attributes);
    const rtype = typeLabel(d.type);
    const mine = role(d["my role"]);
    const key = relationKey(rtype, attrs, [...others, { role: mine, code }]);
    relations[key] = { key, type: rtype, role: mine, attributes: attrs, others };
  }
  const out: Doc = { code, name: p.name ?? null, type: ptype, description: p.description ?? null,
    jurisdiction: p.jurisdiction ?? null, sector: p.sector ?? null,
    relations: sorted(Object.values(relations), (r) => [r.type, r.key]),
    raci: (await tx.docs(raciOfQuery(code))).map((d) => ({ ...raciEntry(d), item_type: typeLabel(d["item type"]) })),
    people: [] as Doc[] };
  if (ptype !== "person") {
    out.people = sorted((await tx.docs(peopleQuery(code))).map((d) => ({ code: d.person.code, name: d.person.name ?? null, title: d.title,
      raci: sorted((d.raci as Doc[]).map(raciEntry), (r) => ["ARCI".indexOf(r.letter), r.item.code]) })), (p) => p.code);
  }
  return out;
}

/** Q2.9: every direct holding into a company in the parent's group, incl. outside shareholders. */
export function ownershipEdgesQuery(parentCode: string): string {
  return `
match $p isa company, has code ${string(parentCode)}; let $c, $e in group_members($p);
      $o isa ownership (owner: $owner, owned: $c), has stake $s;
select $o, $owner, $c, $s; distinct;
fetch { "owner": { "code": $owner.code, "name": $owner.name }, "owned": { "code": $c.code, "name": $c.name }, "stake": $s,
        "description": $o.description };
`;
}

export interface OwnershipEdge {
  owner: Ref;
  owned: Ref;
  stake: Dec;
  description: string | null;
}

/** Direct stakes [{owner, owned, stake}]. De-duplicated here as well. */
export async function ownershipEdges(tx: Tx, parentCode: string): Promise<OwnershipEdge[]> {
  const seen = new Map<string, OwnershipEdge>();
  for (const d of await tx.docs(ownershipEdgesQuery(parentCode))) {
    seen.set(`${d.owner.code}\u0000${d.owned.code}`, { owner: d.owner, owned: d.owned, stake: Dec.of(d.stake), description: d.description ?? null });
  }
  return sorted(seen.values(), (e) => [e.owned.code, e.owner.code]);
}

export function namesQuery(codes: string[]): string {
  // Codes are validated identifiers (capitals, digits, hyphens), so they are safe in a pattern.
  const pattern = "^(" + sortedUnique(codes).join("|") + ")$";
  return `
match $x has code $c, has name $n; $c like ${string(pattern)};
fetch { "code": $c, "name": $n };
`;
}

/** {code: name} for any coded things (parties, deal items, financing...). */
export async function names(tx: Tx, codes: string[]): Promise<Record<string, string>> {
  if (!codes.length) return {};
  if (!codes.every((c) => CODE_TEXT.test(c))) throw new Error("not a valid code");
  const out: Record<string, string> = {};
  for (const d of await tx.docs(namesQuery(codes))) out[d.code] = d.name;
  return out;
}

// ---- Impact Explorer (Q3.4, Q3.5) -------------------------------------------------------------
// impactEdges (recursive), allItems and allDeadlineLimits above supply the projection itself;
// these add context: every dependency (to inspect any item), which kinds are "hard" (from the
// schema), and who holds RACI letters on everything the recursion reaches.

export const HARD_DEPENDENCY_KINDS = `
match $k sub hard-dependency;
fetch { "kind": $k };
`;

export const ALL_DEPENDENCIES = `
match $d isa dependency (prerequisite: $a, dependent: $b); $d isa! $k;
fetch { "from": $a.code, "to": $b.code, "kind": $k, "lag": $d.lag-days };
`;

/** The dependency types that move dates: hard-dependency and its subtypes, from the schema. */
export async function hardDependencyKinds(tx: Tx): Promise<string[]> {
  return sorted((await tx.docs(HARD_DEPENDENCY_KINDS)).map((d) => d.kind.label as string));
}

export interface Dependency {
  from: string;
  to: string;
  kind: string;
  lag: number | null;
}

/** Every dependency, hard or soft: [{from, to, kind, lag}]. */
export async function allDependencies(tx: Tx): Promise<Dependency[]> {
  return sorted((await tx.docs(ALL_DEPENDENCIES)).map((d) => ({ from: d.from as string, to: d.to as string, kind: typeLabel(d.kind), lag: (d.lag ?? null) as number | null })),
    (e) => [e.from, e.to]);
}

/** Q3.5: RACI on the start item, on everything downstream of it (recursive), and on the deadlines that limit those items. */
export function impactRaciQuery(startCode: string): string {
  return `
match $start isa deal-item, has code ${string(startCode)};
      { $x is $start; } or { let $x in downstream($start); } or
      { let $y in downstream($start); deadline-limit (limited-item: $y, deadline: $x); };
      $r isa raci-assignment (holder: $h, item: $x); $r isa! $letter; $h isa! $htype;
fetch { "item": $x.code, "letter": $letter, "holder": { "code": $h.code, "name": $h.name }, "holder type": $htype,
        "employer": [ match employment (employee: $h, employer: $o), has job-title $t; fetch { "code": $o.code, "name": $o.name, "title": $t }; ],
        "via": [ match $r links (via: $m); fetch { "code": $m.code, "type": $m.mandate-type }; ] };
`;
}

export interface ImpactHolder {
  letter: string;
  code: string;
  name: string | null;
  type: string;
  employer: Ref | null;
  title: string | null;
  via: Doc | null;
}

/**
 * {item code: [{letter, code, name, type, employer, title, via}]}, de-duplicated here
 * (`or` branches can repeat a row, and distinct doesn't remove repeats after `or`).
 */
export async function impactRaci(tx: Tx, startCode: string): Promise<Record<string, ImpactHolder[]>> {
  const seen = new Map<string, { item: string; entry: ImpactHolder }>();
  for (const d of await tx.docs(impactRaciQuery(startCode))) {
    const emp = d.employer.length ? d.employer[0] : null;
    const entry: ImpactHolder = { letter: RACI_LETTERS[typeLabel(d.letter)]!, code: d.holder.code, name: d.holder.name ?? null,
      type: typeLabel(d["holder type"]), employer: emp && { code: emp.code, name: emp.name },
      title: emp && emp.title, via: d.via.length ? d.via[0] : null };
    seen.set(`${d.item}\u0000${entry.letter}\u0000${entry.code}`, { item: d.item, entry });
  }
  const out: Record<string, ImpactHolder[]> = {};
  for (const { item, entry } of sorted(seen.values(), (kv) => [kv.item, "ARCI".indexOf(kv.entry.letter), kv.entry.code])) {
    (out[item] ??= []).push(entry);
  }
  return out;
}

// ---- Shared item detail (Gantt, and later Workstreams, Parties and Impact) --------------------

/**
 * Everything about one work item in one fetch: its own attributes, workstream, RACI (with the
 * mandate each adviser acts under), dependencies both ways, deadline limits both ways, who is bound
 * and whose consent it needs, its events and the risks that threaten it.
 */
export function itemDetailQuery(code: string): string {
  return `
match $x isa deal-item, has code ${string(code)}; $x isa! $t;
fetch { "item": { $x.* }, "type": $t,
  "workstream": [ match work-breakdown (whole: $w, part: $x); fetch { "code": $w.code, "name": $w.name }; ],
  "raci": [ match $r isa raci-assignment (holder: $h, item: $x); $r isa! $l; $h isa! $ht;
            fetch { "letter": $l, "holder": { "code": $h.code, "name": $h.name }, "holder type": $ht,
                     "employer": [ match employment (employee: $h, employer: $o); fetch { "name": $o.name }; ],
                     "via": [ match $r links (via: $m); fetch { "code": $m.code }; ] }; ],
  "depends on": [ match $d isa dependency (prerequisite: $a, dependent: $x); $d isa! $k;
                  fetch { "code": $a.code, "name": $a.name, "kind": $k, "lag": $d.lag-days }; ],
  "needed by": [ match $d isa dependency (prerequisite: $x, dependent: $b); $d isa! $k;
                 fetch { "code": $b.code, "name": $b.name, "kind": $k, "lag": $d.lag-days }; ],
  "limited by": [ match deadline-limit (limited-item: $x, deadline: $dl);
                  fetch { "code": $dl.code, "name": $dl.name, "due": $dl.due-date }; ],
  "limits": [ match deadline-limit (limited-item: $y, deadline: $x); fetch { "code": $y.code, "name": $y.name }; ],
  "bound": [ match bound-by (obligor: $o, obligation: $x); fetch { "code": $o.code, "name": $o.name }; ],
  "consent from": [ match consent-right (obligation: $x, grantor: $g); fetch { "code": $g.code, "name": $g.name }; ],
  "events": [ match $e isa deal-event (subject: $x, actor: $who), has occurred-at $at; $e isa! $et;
              fetch { "code": $e.code, "when": $at, "type": $et, "summary": $e.summary,
                       "actor": { "code": $who.code, "name": $who.name } }; ],
  "discussed at": [ match $m isa meeting (agenda-item: $x, actor: $who, subject: $s), has occurred-at $at;
                    fetch { "code": $m.code, "when": $at, "summary": $m.summary, "actor": { "code": $who.code, "name": $who.name },
                             "subject": { "code": $s.code, "name": $s.name } }; ],
  "risks": [ match risk-exposure (risk: $k, exposed: $x); $k isa risk;
             fetch { "code": $k.code, "name": $k.name, "severity": $k.severity, "likelihood": $k.likelihood,
                      "status": $k.risk-status }; ]
};
`;
}

/** One item's detail (see itemDetailQuery), or null if there is no item with that code. */
export async function itemDetail(tx: Tx, code: string): Promise<Doc | null> {
  const found = await tx.docs(itemDetailQuery(code));
  if (!found.length) return null;
  const d = found[0]!;
  const x = d.item;
  const deps = (rows: Doc[]) => sorted(rows.map((r) => ({ code: r.code, name: r.name ?? null, kind: typeLabel(r.kind), lag: r.lag ?? null })), (r) => r.code);
  const raci: Record<string, Doc[]> = {};
  for (const r of d.raci as Doc[]) { // the same holder can't hold one letter twice, but sort for a stable answer
    const entry = { code: r.holder.code, name: r.holder.name ?? null, type: typeLabel(r["holder type"]),
      employer: r.employer.length ? r.employer[0].name : null, via: r.via.length ? r.via[0].code : null };
    (raci[RACI_LETTERS[typeLabel(r.letter)]!] ??= []).push(entry);
  }
  const events = sorted((d.events as Doc[]).map((e) => ({ code: e.code, when: when(e.when), type: typeLabel(e.type), summary: e.summary ?? null,
    actor: e.actor })), (e) => [e.when, e.code], true);
  const raciSorted: Record<string, Doc[]> = {};
  for (const [letter, holders] of Object.entries(raci)) raciSorted[letter] = sorted(holders, (h) => h.code);
  return {
    code: x.code, name: x.name ?? null, type: typeLabel(d.type), status: x.status ?? null,
    criticality: x.criticality ?? null, description: x.description ?? null,
    planned_start: x["planned-start"] ?? null, actual_start: x["actual-start-date"] ?? null,
    due: x["due-date"] ?? null, baseline_due: x["baseline-due-date"] ?? null, completed: x["completed-date"] ?? null,
    progress: x.progress ?? null, legal_basis: x["legal-basis"] ?? null, consequence: x.consequence ?? null,
    workstream: d.workstream.length ? ref(d.workstream[0]) : null,
    raci: raciSorted,
    depends_on: deps(d["depends on"]), needed_by: deps(d["needed by"]),
    limited_by: sorted((d["limited by"] as Doc[]).map((r) => ({ code: r.code, name: r.name ?? null, due: r.due ?? null })), (r) => r.code),
    limits: sorted((d.limits as Doc[]).map(ref), (r) => r.code),
    bound: sorted((d.bound as Doc[]).map(ref), (r) => r.code),
    consent_from: sorted((d["consent from"] as Doc[]).map(ref), (r) => r.code),
    events, risks: sorted((d.risks as Doc[]).map((r) => ({ code: r.code, name: r.name ?? null, severity: r.severity ?? null,
      likelihood: r.likelihood ?? null, status: r.status ?? null })), (r) => r.code),
    discussed_at: sorted((d["discussed at"] as Doc[]).map((m) => ({ code: m.code, when: when(m.when), summary: m.summary ?? null, actor: m.actor,
      subject: m.subject })), (m) => m.when, true),
  };
}

// ---- Workstreams (Phase 6C) ----------------------------------------------------------------

/** Restrict a pattern binding $ws to one workstream, or leave it open for all of them. */
function inWorkstream(code?: string | null): string {
  return code ? `$ws has code ${string(code)};` : "";
}

const EVENT_FETCH = `
fetch { "workstream": $ws.code, "event": { $e.* }, "type": $et,
  "actor": { "code": $who.code, "name": $who.name }, "actor type": $wt,
  "employer": [ match employment (employee: $who, employer: $o); fetch { "name": $o.name }; ],
  "item": { "code": $i.code, "name": $i.name },
  "recipients": [ match $e links (recipient: $r); fetch { "code": $r.code, "name": $r.name }; ],
  "attendees": [ match $e links (attendee: $r); fetch { "code": $r.code, "name": $r.name }; ],
  "agenda": [ match $e links (agenda-item: $a); fetch { "code": $a.code, "name": $a.name }; ],
  "replies to": [ match reply (answer: $e, original: $q); fetch { "code": $q.code }; ],
  "answered by": [ match reply (original: $e, answer: $a); fetch { "code": $a.code, "when": $a.occurred-at }; ] };
`;

/**
 * Every recorded event on a workstream's items, of every kind (polymorphic deal-event), with who
 * it was sent to, who attended, what a meeting discussed (agenda-item), and the request/response chain
 * (reply relates two relations).
 */
export function workstreamEventsQuery(code?: string | null): string {
  return `
match $ws isa workstream; ${inWorkstream(code)} work-breakdown (whole: $ws, part: $i);
      $e isa deal-event (subject: $i, actor: $who), has occurred-at $t; $e isa! $et; $who isa! $wt;
${EVENT_FETCH}`;
}

/**
 * Events recorded against a workstream itself (steering meetings: oversight). A separate query rather
 * than `{ $i is $ws; } or { work-breakdown ... }`, which hits TypeDB 3.14.1's planner bug QPL1.
 */
export function workstreamOversightQuery(code?: string | null): string {
  return `
match $ws isa workstream; ${inWorkstream(code)} $i is $ws;
      $e isa deal-event (subject: $i, actor: $who), has occurred-at $t; $e isa! $et; $who isa! $wt;
${EVENT_FETCH}`;
}

export interface EventActor extends Ref {
  type: string;
  employer: string | null;
}

export interface WorkstreamEvent {
  workstream: string;
  code: string;
  when: string;
  type: string;
  kind: string | null;
  summary: string | null;
  actor: EventActor;
  item: Ref;
  recipients: Ref[];
  attendees: Ref[];
  agenda: Ref[];
  replies_to: string[];
  answered_by: { code: string; when: string }[];
  response_due: string | null;
  automated: boolean | null;
  previous_status: string | null;
  new_status: string | null;
}

/** Every event on a workstream's items and on the workstream itself, newest first. */
export async function workstreamEvents(tx: Tx, code?: string | null): Promise<WorkstreamEvent[]> {
  const out: WorkstreamEvent[] = [];
  for (const d of [...(await tx.docs(workstreamEventsQuery(code))), ...(await tx.docs(workstreamOversightQuery(code)))]) {
    const e = d.event;
    out.push({
      workstream: d.workstream, code: e.code, when: when(e["occurred-at"])!, type: typeLabel(d.type),
      kind: e["event-kind"] ?? null, summary: e.summary ?? null,
      actor: { ...d.actor, type: typeLabel(d["actor type"]), employer: d.employer.length ? d.employer[0].name : null },
      item: d.item,
      recipients: sorted(d.recipients as Ref[], (r) => r.code),
      attendees: sorted(d.attendees as Ref[], (r) => r.code),
      agenda: sorted(d.agenda as Ref[], (r) => r.code),
      replies_to: sorted((d["replies to"] as Doc[]).map((r) => r.code as string)),
      answered_by: sorted((d["answered by"] as Doc[]).map((a) => ({ code: a.code as string, when: when(a.when)! })), (a) => a.when),
      response_due: e["response-due-date"] ?? null, automated: e.automated ?? null,
      previous_status: e["previous-status"] ?? null, new_status: e["new-status"] ?? null,
    });
  }
  return sorted(out, (e) => [e.when, e.code], true);
}

export const WORKSTREAM_RISKS = `
match $k isa risk; risk-exposure (risk: $k, exposed: $x); work-breakdown (whole: $ws, part: $x);
fetch { "workstream": $ws.code, "risk": { $k.* }, "item": $x.code,
  "owner": [ match risk-ownership (owned-risk: $k, risk-owner: $o); fetch { "code": $o.code, "name": $o.name }; ] };
`;

export interface Risk {
  code: string;
  name: string | null;
  description: string | null;
  likelihood: string | null;
  severity: string | null;
  status: string | null;
  mitigation: string | null;
  owner: Ref | null;
  items: string[];
}

/** {workstream: [{code, name, description, likelihood, severity, status, mitigation, owner, items}]}. */
export async function workstreamRisks(tx: Tx): Promise<Record<string, Risk[]>> {
  const found: Record<string, Record<string, Risk>> = {};
  for (const d of await tx.docs(WORKSTREAM_RISKS)) {
    const k = d.risk;
    const risk = ((found[d.workstream] ??= {})[k.code] ??= {
      code: k.code, name: k.name ?? null, description: k.description ?? null,
      likelihood: k.likelihood ?? null, severity: k.severity ?? null, status: k["risk-status"] ?? null,
      mitigation: k.mitigation ?? null, owner: d.owner.length ? d.owner[0] : null, items: [] });
    risk.items = sortedUnique([...risk.items, d.item]);
  }
  const out: Record<string, Risk[]> = {};
  for (const [w, r] of Object.entries(found)) out[w] = sorted(Object.values(r), (x) => x.code);
  return out;
}

/**
 * Contractual deadlines a workstream's open items can still affect: a deadline limiting an open
 * item, or anything downstream of it (the recursive downstream function).
 */
export function deadlinesInReachQuery(code?: string | null): string {
  return `
match $ws isa workstream, has code $w; ${inWorkstream(code)} work-breakdown (whole: $ws, part: $i);
      not { $i has status "complete"; };
      { $x is $i; } or { let $x in downstream($i); };
      deadline-limit (limited-item: $x, deadline: $dl);
fetch { "workstream": $w, "deadline": $dl.code, "via": $x.code, "from": $i.code };
`;
}

export type Reach = Record<string, Record<string, { via: string[]; from: string[] }>>;

/**
 * {workstream: {deadline code: {via: [limited items], from: [open items in the workstream]}}},
 * de-duplicated here (`or` branches can repeat rows).
 */
export async function deadlinesInReach(tx: Tx, code?: string | null): Promise<Reach> {
  const out: Record<string, Record<string, { via: Set<string>; from: Set<string> }>> = {};
  for (const d of await tx.docs(deadlinesInReachQuery(code))) {
    const entry = ((out[d.workstream] ??= {})[d.deadline] ??= { via: new Set(), from: new Set() });
    entry.via.add(d.via);
    entry.from.add(d.from);
  }
  const result: Reach = {};
  for (const [w, dls] of Object.entries(out)) {
    result[w] = {};
    for (const [dl, e] of Object.entries(dls)) result[w][dl] = { via: sorted(e.via), from: sorted(e.from) };
  }
  return result;
}

// Written with the RACI pattern inside each branch: `{ $i is $ws; } or { ... }` followed by the RACI
// pattern makes TypeDB 3.14.1's query planner fail (QPL1; see docs/queries.md).
export const WORKSTREAM_HOLDERS = `
match $ws isa workstream, has code $w;
      { raci-assignment (holder: $h, item: $ws); } or
      { work-breakdown (whole: $ws, part: $i); raci-assignment (holder: $h, item: $i); };
      $h isa! $ht;
fetch { "workstream": $w, "holder": { "code": $h.code, "name": $h.name }, "type": $ht,
  "employer": [ match employment (employee: $h, employer: $o); fetch { "code": $o.code, "name": $o.name }; ] };
`;

/**
 * {workstream: [organisations involved]}: every organisation holding a RACI letter on the workstream
 * or its items, directly or through one of its people.
 */
export async function workstreamOrganisations(tx: Tx): Promise<Record<string, Ref[]>> {
  const out: Record<string, Record<string, string>> = {};
  for (const d of await tx.docs(WORKSTREAM_HOLDERS)) {
    const orgs = (out[d.workstream] ??= {});
    if (d.employer.length) orgs[d.employer[0].code] = d.employer[0].name;
    else if (typeLabel(d.type) !== "person") orgs[d.holder.code] = d.holder.name;
  }
  const result: Record<string, Ref[]> = {};
  for (const [w, o] of Object.entries(out)) result[w] = sorted(Object.entries(o), (x) => x[1]).map(([c, n]) => ({ code: c, name: n }));
  return result;
}

/** For each item in a workstream, its prerequisites at any depth (the recursive upstream function) that are not yet complete. */
export function openPrerequisitesQuery(code: string): string {
  return `
match $ws isa workstream, has code ${string(code)}; work-breakdown (whole: $ws, part: $i);
      let $u in upstream($i); not { $u has status "complete"; };
fetch { "item": $i.code, "open prerequisite": $u.code };
`;
}

/** {item code: [open prerequisite codes]}, de-duplicated. */
export async function openPrerequisites(tx: Tx, code: string): Promise<Record<string, string[]>> {
  const out: Record<string, Set<string>> = {};
  for (const d of await tx.docs(openPrerequisitesQuery(code))) (out[d.item] ??= new Set()).add(d["open prerequisite"]);
  const result: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(out)) result[k] = sorted(v);
  return result;
}

/**
 * A workstream's obligations (conditions, covenants and deadlines: the abstract parent type), with who
 * is bound, whose consent is needed and what each deadline limits.
 */
export function workstreamObligationsQuery(code: string): string {
  return `
match $ws isa workstream, has code ${string(code)}; work-breakdown (whole: $ws, part: $o); $o isa obligation; $o isa! $t;
fetch { "obligation": { $o.* }, "type": $t,
  "bound": [ match bound-by (obligor: $b, obligation: $o); fetch { "code": $b.code, "name": $b.name }; ],
  "consent from": [ match consent-right (obligation: $o, grantor: $g); fetch { "code": $g.code, "name": $g.name }; ],
  "limits": [ match deadline-limit (deadline: $o, limited-item: $x); fetch { "code": $x.code, "name": $x.name }; ] };
`;
}

export async function workstreamObligations(tx: Tx, code: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const d of await tx.docs(workstreamObligationsQuery(code))) {
    const o = d.obligation;
    out.push({ code: o.code, name: o.name ?? null, type: typeLabel(d.type), status: o.status ?? null,
      due: o["due-date"] ?? null, legal_basis: o["legal-basis"] ?? null, consequence: o.consequence ?? null,
      bound: sorted((d.bound as Doc[]).map(ref), (r) => r.code),
      consent_from: sorted((d["consent from"] as Doc[]).map(ref), (r) => r.code),
      limits: sorted((d.limits as Doc[]).map(ref), (r) => r.code) });
  }
  return sorted(out, (o) => [o.due ?? "", o.code]);
}

// ---- Parties and engagement (Phase 6D) --------------------------------------------------------

export const PEOPLE = `
match $p isa person;
fetch { "code": $p.code, "name": $p.name,
  "employment": [ match employment (employee: $p, employer: $o), has job-title $t; $o isa! $ot;
                  fetch { "code": $o.code, "name": $o.name, "type": $ot, "title": $t }; ] };
`;

// Contacts are read here only, and masked on the server before any response is built (decision D8):
// "Show TypeQL" shows this query, never the values.
export const CONTACTS = `
match $p isa person, has code $c;
fetch { "code": $c, "email": $p.email, "phone": $p.phone };
`;

export const ORGANISATION_PARTIES = `
match $o isa organisation; $o isa! $t;
fetch { "code": $o.code, "name": $o.name, "type": $t, "jurisdiction": $o.jurisdiction,
  "authority": [ match $o isa authority; fetch { "code": $o.code }; ] };
`;

export const ALL_RACI = `
match $r isa raci-assignment (holder: $h, item: $i); $r isa! $l;
fetch { "holder": $h.code, "item": $i.code, "letter": $l,
  "via": [ match $r links (via: $m); fetch { "code": $m.code }; ] };
`;

export const ENGAGEMENT_TYPES = `
match $t sub engagement;
fetch { "type": $t };
`;

export const OUTREACH_TYPES = `
match $t sub outreach;
fetch { "type": $t };
`;

export const AUTHORITY_REVIEWS = `
match $a isa authority; authority-review (reviewer: $a, subject: $c);
fetch { "authority": $a.code, "clearance": $c.code };
`;

export interface EmployerRef extends Ref {
  type: string;
}

export interface Person {
  code: string;
  name: string;
  employer: EmployerRef | null;
  title: string | null;
}

export async function people(tx: Tx): Promise<Person[]> {
  const out: Person[] = [];
  for (const d of await tx.docs(PEOPLE)) {
    const e = d.employment.length ? d.employment[0] : null;
    out.push({ code: d.code, name: d.name,
      employer: e ? { code: e.code, name: e.name, type: typeLabel(e.type) } : null,
      title: e ? e.title : null });
  }
  return sorted(out, (p) => p.name);
}

/** {person code: [email, phone]}: full values, for masking on the server only. */
export async function contacts(tx: Tx): Promise<Record<string, [string | null, string | null]>> {
  const out: Record<string, [string | null, string | null]> = {};
  for (const d of await tx.docs(CONTACTS)) out[d.code] = [d.email ?? null, d.phone ?? null];
  return out;
}

export interface OrganisationParty {
  code: string;
  name: string;
  type: string;
  jurisdiction: string | null;
  authority: boolean;
}

export async function organisationParties(tx: Tx): Promise<OrganisationParty[]> {
  return sorted((await tx.docs(ORGANISATION_PARTIES)).map((d) => ({ code: d.code as string, name: d.name as string, type: typeLabel(d.type),
    jurisdiction: (d.jurisdiction ?? null) as string | null, authority: d.authority.length > 0 })), (o) => o.name);
}

export interface RaciRow {
  holder: string;
  item: string;
  letter: string;
  via: string | null;
}

export async function allRaci(tx: Tx): Promise<RaciRow[]> {
  return sorted((await tx.docs(ALL_RACI)).map((d) => ({ holder: d.holder as string, item: d.item as string, letter: RACI_LETTERS[typeLabel(d.letter)]!,
    via: (d.via.length ? d.via[0].code : null) as string | null })), (r) => [r.holder, r.item, r.letter]);
}

export async function subtypes(tx: Tx, query: string): Promise<Set<string>> {
  return new Set((await tx.docs(query)).map((d) => typeLabel(d.type)));
}

export async function authorityReviews(tx: Tx): Promise<{ authority: string; clearance: string }[]> {
  return sorted((await tx.docs(AUTHORITY_REVIEWS)).map((d) => ({ authority: d.authority as string, clearance: d.clearance as string })),
    (r) => [r.authority, r.clearance]);
}

// ---- Connection paths (Phase 6E) ---------------------------------------------------------------

export const CODE_PATTERN = /^[A-Z0-9-]+$/;

function workBreakdown(include: boolean): string {
  return include ? "" : "not { $r isa work-breakdown; };";
}

/**
 * Everything one relation away from `code` that is an entity (the kind statement `entity $mt;`), with
 * the relation and its exact type. Role-less matching ($r links ($a, $m)) finds every kind of relation.
 */
export function neighboursQuery(code: string, workstreams = false): string {
  return `match $a has code ${string(code)}; $r links ($a, $m); $m isa $mt, has code $mc; entity $mt; $r isa! $t;
      not { $m is $a; }; ${workBreakdown(workstreams)}
select $r, $t, $mc; distinct;`;
}

/**
 * For three-step paths, met in the middle: the relations joining a neighbour of one end ($m) to a
 * neighbour of the other ($n). Activity records (deal-event and its subtypes) are not used for three steps.
 */
export function middleQuery(starts: string[], ends: string[], workstreams = false, rowCap = 2000): string {
  for (const code of [...starts, ...ends]) {
    if (!CODE_PATTERN.test(code)) throw new Error(`not a code: ${code}`);
  }
  return `match $m has code $mc; $mc like "^(${sorted(starts).join("|")})$";
      $r links ($m, $n); $n has code $nc; $nc like "^(${sorted(ends).join("|")})$"; $r isa! $t;
      not { $r isa deal-event; }; ${workBreakdown(workstreams)}
select $r, $t, $mc, $nc; distinct; limit ${Math.trunc(rowCap)};`;
}

function iidPatterns(iids: string[]): string {
  return iids.map((i) => `{ $r iid ${i}; }`).join(" or ");
}

/** Every player of the given relations, with the role it plays and its code. */
export function relationPlayersQuery(iids: string[]): string {
  return `match ${iidPatterns(iids)}; $r links ($role: $p); $p has code $c;\nselect $r, $role, $c;`;
}

export function relationAttributesQuery(iids: string[]): string {
  return `match ${iidPatterns(iids)}; $r has $attr;\nselect $r, $attr;`;
}

export const ENTITY_LINKS = `
match $x isa $t, has code $c; entity $t; $r links ($x);
reduce $links = count groupby $c;
`;

export const CONNECTABLES = `
match $x isa! $t, has code $c, has name $n; entity $t;
select $c, $n, $t;
`;

export interface Connectable {
  code: string;
  name: string;
  type: string;
}

/** {code: {code, name, type}} for every entity that has a code: the things a path can join. */
export async function connectables(tx: Tx): Promise<Record<string, Connectable>> {
  const out: Record<string, Connectable> = {};
  for (const r of await tx.rows(CONNECTABLES)) {
    const code = value<string>(r, "c");
    out[code] = { code, name: value<string>(r, "n"), type: rowLabel(r, "t") };
  }
  return out;
}

export async function entityLinks(tx: Tx): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await tx.rows(ENTITY_LINKS)) out[value<string>(r, "c")] = value<number>(r, "links");
  return out;
}

/** The relation iid, type label and neighbour code of a neighbours-query row. */
export function hopRow(r: ConceptRow): [string, string, string] {
  return [iid(r, "r"), rowLabel(r, "t"), value<string>(r, "mc")];
}

/** Counts how many of `codes` are present in `set` (used by the explorer's node filter). */
export function countIn(codes: (string | null)[], set: Record<string, unknown>): number {
  return count(codes, (c) => c !== null && c in set);
}
