// The seed loader: reads data/seed/*.yaml, checks it, and loads it into TypeDB in ONE transaction.
//
// Steps, all or nothing:
// 1. validate(): the YAML is complete and consistent (every reference exists and has the right
//    kind, codes are unique, values are allowed, every item has exactly one Accountable).
// 2. render(): turn it into a single TypeQL `insert` (also saved as data/seed.tql for Studio users).
// 3. load(): inside one WRITE transaction, run the insert, then check in TypeDB that every expected
//    entity and relation arrived (a relation with no players, or an insert that matched nothing,
//    would otherwise vanish silently), that the ownership guards and the data-quality checks find
//    nothing. Only then commit. If anything is wrong the transaction is abandoned: nothing is saved.
//
// Used by the seed service, the scripts and the tests, never by the API: this module reads files.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, visit } from "yaml";
import { Dec } from "./decimal.ts";
import * as queries from "./queries.ts";
import { sorted } from "./py.ts";
import { decimalLiteral, string, type Connection } from "./typedb.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SEED_DIR = join(ROOT, "data", "seed");
export const SEED_TQL = join(ROOT, "data", "seed.tql");
// Shared files, then one file per workstream (its items, the dependencies into them, RACI and history).
const SEED_FILES = ["parties.yaml", "deal.yaml", "links.yaml", "risks.yaml"];
const WORKSTREAM_DIR = "workstreams";

const CODE = /^[A-Z]{2,5}-[A-Z0-9]+(-[A-Z0-9]+)*$/;
const COMPANY = new Set(["company"]);
const ADVISER_TYPES = new Set(["investment-bank", "law-firm", "accounting-firm", "consultancy", "communications-firm", "registrar"]);
const LENDER_TYPES = new Set(["investment-bank", "commercial-bank"]);
const AUTHORITY_TYPES = new Set(["regulator", "court"]);
const ORG_TYPES = new Set([...COMPANY, ...ADVISER_TYPES, ...LENDER_TYPES, ...AUTHORITY_TYPES]);
const OBLIGATION_TYPES = new Set(["regulatory-clearance", "shareholder-approval", "court-sanction", "covenant", "deadline"]);
const ITEM_TYPES = new Set(["milestone", "activity", ...OBLIGATION_TYPES]);
const REVIEWABLE_TYPES = new Set(["regulatory-clearance", "court-sanction"]);
const DEPENDENCY_KINDS = new Set(["gating", "sequencing", "informing"]);
const STATUSES = new Set(["not-started", "in-progress", "at-risk", "delayed", "complete"]);
const CRITICALITIES = new Set(["low", "medium", "high", "critical"]);
export const RACI_TYPES: Record<string, string> = { R: "responsibility", A: "accountability", C: "consultation", I: "notification" };
// Activity history (migration 001). engagement and outreach group these and are never inserted directly.
const ENGAGEMENT_TYPES = new Set(["response", "meeting", "delivery", "decision"]);
const OUTREACH_TYPES = new Set(["request", "notice"]);
const EVENT_TYPES = new Set([...ENGAGEMENT_TYPES, ...OUTREACH_TYPES, "status-change"]);
const LIKELIHOODS = new Set(["low", "medium", "high"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RISK_STATUSES = new Set(["open", "mitigating", "closed"]);
const EMAIL = /^[a-z][a-z.-]*@[a-z0-9-]+\.example$/; // reserved domain (RFC 2606) only
const PHONE = /^07700 900\d{3}$/; // Ofcom's drama range only

/** A calendar date read from the YAML (an unquoted YYYY-MM-DD). */
export class YDate {
  readonly iso: string;

  constructor(iso: string) {
    this.iso = iso;
  }

  toString(): string {
    return this.iso;
  }
}

/** A date-time read from the YAML (!!timestamp 'YYYY-MM-DD HH:MM:SS'); its date is the first ten characters. */
export class YDateTime extends YDate {
  get date(): string {
    return this.iso.slice(0, 10);
  }
}

export function isDate(v: unknown): v is YDate {
  return v instanceof YDate;
}

export function isDateTime(v: unknown): v is YDateTime {
  return v instanceof YDateTime;
}

/** The seed data is wrong. The message lists every problem found. */
export class SeedError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("Seed data problems:\n  - " + problems.join("\n  - "));
    this.problems = [...problems];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Record_ = Record<string, any>;
export type Seed = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TIMESTAMP = "tag:yaml.org,2002:timestamp";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?$/;

/** YAML as PyYAML read it: unquoted dates become YDate, timestamps YDateTime, everything else is plain JSON. */
export function parseYaml(text: string): Seed {
  const doc = parseDocument(text, { customTags: [{ tag: TIMESTAMP, resolve: (s: string) => s }] });
  visit(doc, {
    Scalar(_key, node) {
      const v = node.value;
      if (typeof v !== "string" || !(node.type === "PLAIN" || node.tag === TIMESTAMP)) return;
      if (DATE.test(v)) node.value = new YDate(v);
      else if (DATETIME.test(v)) node.value = new YDateTime(v.replace(/[ \t]+/, "T").slice(0, 19));
    },
  });
  return (doc.toJS() as Seed) ?? {};
}

// ---- 1. read and validate ------------------------------------------------------------------

/**
 * Merge the YAML files into one dictionary: list sections are concatenated across files and mapping
 * sections (raci) merged; a code defined twice is reported by validate().
 */
export function readSeed(seedDir = SEED_DIR): Seed {
  const paths = [...SEED_FILES.map((n) => join(seedDir, n)),
    ...readdirSync(join(seedDir, WORKSTREAM_DIR)).filter((n) => n.endsWith(".yaml")).sort().map((n) => join(seedDir, WORKSTREAM_DIR, n))];
  const seed: Seed = {};
  const problems: string[] = [];
  for (const path of paths) {
    const name = path.split("/").pop()!;
    const part = parseYaml(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(part)) {
      if (!(key in seed)) seed[key] = value;
      else if (Array.isArray(value) && Array.isArray(seed[key])) seed[key] = [...seed[key], ...value];
      else if (isObject(value) && isObject(seed[key]) && key === "raci") {
        for (const code of Object.keys(value)) if (code in seed[key]) problems.push(`${name}: RACI for ${code} is also given in another file`);
        seed[key] = { ...seed[key], ...value };
      } else {
        problems.push(`${name}: section '${key}' already defined in another file`);
      }
    }
  }
  if (problems.length) throw new SeedError(problems);
  return seed;
}

function isObject(v: unknown): v is Record_ {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof YDate);
}

/** Python's repr() for the values quoted in messages. */
function repr(v: unknown): string {
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/'/g, "\\'")}'`;
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

function byCode(records: Record_[] | undefined): Record<string, Record_> {
  const out: Record<string, Record_> = {};
  for (const r of records ?? []) out[r.code] = r;
  return out;
}

function holdersOf(letters: Record_): string[] {
  return [letters.A, ...["R", "C", "I"].flatMap((k) => (letters[k] ?? []) as string[])];
}

function sortedSet(values: Iterable<string>): string {
  return "[" + sorted(new Set(values)).map((v) => `'${v}'`).join(", ") + "]";
}

/** Check the seed data; throw SeedError listing every problem, or return. */
export function validate(seed: Seed): void {
  const problems: string[] = [];
  const add = (p: string) => problems.push(p);

  const orgs = byCode(seed.organisations);
  const people = byCode(seed.people);
  const deal: Record_ = seed.deal ?? {};
  const mandates = byCode(seed.mandates);
  const financing = byCode(seed.financing);
  const workstreams = byCode(seed.workstreams);
  const items = byCode(seed.items);
  const allItems = { ...workstreams, ...items };

  // An unquoted comma inside a YAML {...} entry silently starts a new, empty field and cuts the text short.
  for (const [section, records] of Object.entries(seed)) {
    for (const record of Array.isArray(records) ? records : []) {
      if (isObject(record)) {
        for (const [key, value] of Object.entries(record)) {
          if (value === null) add(`${section} ${record.code ?? ""}: field '${key}' is empty (quote any text that contains a comma)`);
        }
      }
    }
  }
  const parties = { ...orgs, ...people };

  const codes: unknown[] = [...(seed.organisations ?? []).map((o: Record_) => o.code), ...(seed.people ?? []).map((p: Record_) => p.code),
    deal.code, ...(seed.mandates ?? []).map((m: Record_) => m.code), ...(seed.financing ?? []).map((f: Record_) => f.code),
    ...(seed.workstreams ?? []).map((w: Record_) => w.code), ...(seed.items ?? []).map((i: Record_) => i.code),
    ...(seed.events ?? []).map((e: Record_) => e.code), ...(seed.risks ?? []).map((r: Record_) => r.code)];
  const counts = new Map<unknown, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const [code, n] of counts) if (n > 1) add(`code ${code} is used ${n} times (codes must be unique across the whole dataset)`);
  for (const code of codes) {
    if (typeof code !== "string" || !CODE.test(code)) add(`code ${repr(code)} doesn't match the pattern PREFIX-PART (capital letters, digits, hyphens)`);
  }

  const orgOf = (code: unknown, allowed: Set<string>, where: string) => {
    const o = orgs[code as string];
    if (o === undefined) add(`${where}: unknown organisation ${code}`);
    else if (!allowed.has(o.type)) add(`${where}: ${code} is a ${o.type}, expected one of ${sortedSet(allowed)}`);
  };

  const need = (record: Record_, fields: string[], where: string) => {
    for (const f of fields) if (record[f] === undefined || record[f] === null || record[f] === "") add(`${where}: missing ${f}`);
  };

  for (const o of Object.values(orgs)) {
    need(o, ["name", "type", "jurisdiction"], o.code);
    if (!ORG_TYPES.has(o.type)) add(`${o.code}: unknown organisation type ${repr(o.type)}`);
  }
  for (const p of Object.values(people)) {
    need(p, ["name", "employer", "job_title"], p.code);
    if (!(p.employer in orgs)) add(`${p.code}: unknown employer ${p.employer}`);
  }

  need(deal, ["code", "name", "value", "currency", "structure", "as_of", "acquirer", "target"], "deal");
  orgOf(deal.acquirer, COMPANY, "deal acquirer");
  orgOf(deal.target, COMPANY, "deal target");
  money(deal.value, "deal value", add);
  if (!isDate(deal.as_of)) add("deal as_of must be a date like 2026-10-26");

  for (const m of Object.values(mandates)) {
    need(m, ["client", "adviser", "type"], m.code);
    orgOf(m.client, COMPANY, `${m.code} client`);
    orgOf(m.adviser, ADVISER_TYPES, `${m.code} adviser`);
  }
  for (const f of Object.values(financing)) {
    need(f, ["name", "borrower", "lender", "value", "currency"], f.code);
    orgOf(f.borrower, COMPANY, `${f.code} borrower`);
    orgOf(f.lender, LENDER_TYPES, `${f.code} lender`);
    money(f.value, `${f.code} value`, add);
  }

  (seed.ownership ?? []).forEach((own: Record_, i: number) => {
    const where = `ownership #${i + 1} (${own.owner} -> ${own.owned})`;
    orgOf(own.owner, COMPANY, where);
    orgOf(own.owned, COMPANY, where);
    if (typeof own.stake !== "string") add(`${where}: stake must be a quoted string such as "0.6", so it stays exact`);
    else if (!isDecimal(own.stake)) add(`${where}: stake ${repr(own.stake)} is not a number`);
    // Range (0-1), cycles and over-100% totals are deliberately left to TypeDB: the schema's
    // @range and the guard queries run during load().
  });

  for (const [code, it] of Object.entries(allItems)) {
    need(it, ["name", "status", "due"], code);
    if (!STATUSES.has(it.status)) add(`${code}: status ${repr(it.status)} is not one of ${sortedSet(STATUSES)}`);
    if (!CRITICALITIES.has(it.criticality ?? "medium")) add(`${code}: criticality ${repr(it.criticality)} is not allowed`);
    for (const f of ["due", "planned_start", "baseline_due", "completed"]) {
      if (f in it && !isDate(it[f])) add(`${code}: ${f} must be a date like 2026-11-30`);
    }
    const progress = it.progress;
    if (progress !== undefined && progress !== null && !(Number.isInteger(progress) && progress >= 0 && progress <= 100)) {
      add(`${code}: progress must be a whole number from 0 to 100`);
    }
  }
  for (const [code, it] of Object.entries(items)) {
    if (!ITEM_TYPES.has(it.type)) add(`${code}: unknown item type ${repr(it.type)}`);
    if (!(it.workstream in workstreams)) add(`${code}: unknown workstream ${it.workstream}`);
    if (it.type === "deadline" && !it.consequence) add(`${code}: a deadline needs a consequence (what happens if it is missed)`);
  }

  (seed.dependencies ?? []).forEach((dep: Record_, i: number) => {
    const where = `dependency #${i + 1} (${dep.from} -> ${dep.to})`;
    if (!DEPENDENCY_KINDS.has(dep.kind)) add(`${where}: kind must be one of ${sortedSet(DEPENDENCY_KINDS)}`);
    for (const end of ["from", "to"]) if (!(dep[end] in allItems)) add(`${where}: unknown item ${dep[end]}`);
    if (!(Number.isInteger(dep.lag) && dep.lag >= 0 && dep.lag <= 365)) add(`${where}: lag must be a whole number of days from 0 to 365`);
  });

  for (const dl of seed.deadline_limits ?? []) {
    if (items[dl.deadline]?.type !== "deadline") add(`deadline limit: ${dl.deadline} is not a deadline item`);
    if (!(dl.item in allItems)) add(`deadline limit: unknown item ${dl.item}`);
  }
  for (const rv of seed.reviews ?? []) {
    if (!REVIEWABLE_TYPES.has(items[rv.subject]?.type)) add(`review: ${rv.subject} can't be reviewed by an authority`);
    orgOf(rv.reviewer, AUTHORITY_TYPES, `review of ${rv.subject}`);
    orgOf(rv.applicant, COMPANY, `review of ${rv.subject}`);
    need(rv, ["legal_basis", "phase"], `review of ${rv.subject}`);
  }
  for (const [section, role] of [["bound_by", "obligor"], ["consents", "grantor"]] as const) {
    for (const rec of seed[section] ?? []) {
      if (!OBLIGATION_TYPES.has(items[rec.obligation]?.type)) add(`${section}: ${rec.obligation} is not an obligation`);
      orgOf(rec[role], ORG_TYPES, `${section} ${rec.obligation}`);
    }
  }

  const raci: Record<string, Record_> = seed.raci ?? {};
  for (const code of Object.keys(allItems)) {
    if (!(code in raci)) add(`${code}: no RACI entry (every item needs exactly one Accountable)`);
  }
  for (const [code, letters] of Object.entries(raci)) {
    if (!(code in allItems)) {
      add(`RACI: unknown item ${code}`);
      continue;
    }
    if (typeof letters.A !== "string") add(`RACI ${code}: needs exactly one Accountable (A: CODE)`);
    const holders = holdersOf(letters);
    for (const h of holders) if (!(h in parties)) add(`RACI ${code}: unknown holder ${h}`);
    const seen = new Map<string, number>();
    for (const h of holders) seen.set(h, (seen.get(h) ?? 0) + 1);
    for (const [h, n] of seen) if (n > 1) add(`RACI ${code}: ${h} appears ${n} times; give each holder one letter`);
    for (const k of Object.keys(letters)) if (!(k in RACI_TYPES)) add(`RACI ${code}: unknown letter ${repr(k)}`);
  }

  (seed.events ?? []).forEach((ev: Record_, i: number) => {
    const where = `event #${i + 1}`;
    if (!isDateTime(ev.at)) add(`${where}: at must be a date-time like 2026-10-21T11:00:00`);
    if (!(ev.actor in parties)) add(`${where}: unknown actor ${ev.actor}`);
    if (!(ev.subject in allItems)) add(`${where}: unknown subject ${ev.subject}`);
    need(ev, ["kind", "summary"], where);
  });

  validatePhase6(seed, add, orgs, people, parties, workstreams, items, allItems, raci);

  if (problems.length) throw new SeedError(problems);
}

/**
 * Rules for the Phase 6 data (migration 001): dates that agree with the scenario date, contact
 * details that can only be fictional, a coherent activity history and an owned risk register.
 */
function validatePhase6(seed: Seed, add: (p: string) => void, orgs: Record<string, Record_>, people: Record<string, Record_>,
  parties: Record<string, Record_>, workstreams: Record<string, Record_>, items: Record<string, Record_>,
  allItems: Record<string, Record_>, raci: Record<string, Record_>): void {
  const asOfValue = (seed.deal ?? {}).as_of;
  if (!isDate(asOfValue)) return;
  const asOf = asOfValue.iso;

  // ---- people: fictional contact details only ----
  for (const [field, pattern, what] of [["email", EMAIL, "an address on a reserved .example domain"],
    ["phone", PHONE, "a number in Ofcom's drama range, 07700 900xxx"]] as const) {
    const seen = new Map<unknown, number>();
    for (const p of Object.values(people)) seen.set(p[field], (seen.get(p[field]) ?? 0) + 1);
    for (const p of Object.values(people)) {
      if (typeof p[field] !== "string" || !pattern.test(p[field])) add(`${p.code}: ${field} must be ${what}`);
      else if (seen.get(p[field])! > 1) add(`${p.code}: ${field} ${p[field]} is used by more than one person`);
    }
  }
  const holders = new Set(Object.values(raci).flatMap((letters) => Object.values(letters).flatMap((hs) => (typeof hs === "string" ? [hs] : (hs as string[])))));
  for (const p of Object.values(people)) if (!holders.has(p.code)) add(`${p.code}: has no RACI letter anywhere (every person needs a role)`);

  // ---- work: dates agree with each other and with the scenario date ----
  for (const w of Object.values(workstreams)) {
    if ("progress" in w) add(`${w.code}: workstream progress is derived from its items, so it must not be stored`);
  }
  for (const [code, it] of Object.entries(items)) {
    const start = it.planned_start;
    const due = it.due;
    const status = it.status;
    if (it.type === "activity" && !start) add(`${code}: an activity needs a planned_start (milestones are the items without one)`);
    if (isDate(start) && isDate(due) && start.iso > due.iso) add(`${code}: planned_start ${start} is after its due date ${due}`);
    const actual = it.actual_start;
    if (actual !== undefined && actual !== null && (!isDate(actual) || actual.iso > asOf)) {
      add(`${code}: actual_start must be a date on or before the scenario date (${asOf})`);
    }
    if (it.type === "deadline" || !isDate(due)) continue;
    if (status === "complete" && due.iso > asOf) add(`${code}: complete, but due after the scenario date (${asOf})`);
    if (["in-progress", "at-risk", "delayed"].includes(status) && isDate(start) && start.iso > asOf) {
      add(`${code}: ${status}, but its planned start is after the scenario date`);
    }
    if (status === "not-started" && isDate(start) && start.iso <= asOf) add(`${code}: not started, though its planned start (${start}) has passed`);
    const ws = workstreams[it.workstream];
    if (ws && isDate(ws.planned_start) && isDate(ws.due)) {
      const first = isDate(start) ? start : due;
      if (first.iso < ws.planned_start.iso || due.iso > ws.due.iso) add(`${code}: dates fall outside its workstream (${ws.planned_start} to ${ws.due})`);
    }
  }

  // ---- activity history ----
  const events: Record<string, Record_> = {};
  for (const e of seed.events ?? []) events[e.code] = e;
  const employer: Record<string, string> = {};
  for (const p of Object.values(people)) employer[p.code] = p.employer;
  const wsOf: Record<string, string> = {};
  for (const [c, it] of Object.entries(allItems)) wsOf[c] = it.workstream ?? c;
  const involved: Record<string, Set<string>> = {}; // workstream -> holders and their employers
  for (const [code, letters] of Object.entries(raci)) {
    for (const hs of Object.values(letters)) {
      for (const h of typeof hs === "string" ? [hs] : (hs as string[])) {
        const set = (involved[wsOf[code]!] ??= new Set());
        set.add(h);
        set.add(employer[h]!);
      }
    }
  }
  const latestChange: Record<string, Record_> = {};
  for (const [code, e] of Object.entries(events)) {
    const where = `event ${code}`;
    const typ = e.type;
    const at = e.at;
    if (!EVENT_TYPES.has(typ)) {
      add(`${where}: type must be one of ${sortedSet(EVENT_TYPES)}`);
      continue;
    }
    if (isDateTime(at) && at.date > asOf) add(`${where}: happens after the scenario date (${asOf})`);
    const actor = e.actor;
    const subject = e.subject;
    const actorType = orgs[actor]?.type;
    if (actor in parties && subject in allItems && !AUTHORITY_TYPES.has(actorType) && !(involved[wsOf[subject]!]?.has(actor))) {
      add(`${where}: ${actor} has no role in ${wsOf[subject]}, so can't act on ${subject}`);
    }
    for (const role of ["recipients", "attendees"] as const) {
      for (const party of e[role] ?? []) if (!(party in parties)) add(`${where}: unknown ${role.slice(0, -1)} ${party}`);
    }
    if (OUTREACH_TYPES.has(typ) !== Boolean(e.recipients?.length)) add(`${where}: requests and notices have recipients; other events don't`);
    if ((typ === "meeting") !== Boolean(e.attendees?.length)) add(`${where}: meetings have attendees; other events don't`);
    if (e.agenda?.length) {
      if (typ !== "meeting") add(`${where}: only meetings have an agenda`);
      for (const code_ of e.agenda) {
        if (!(code_ in allItems)) add(`${where}: unknown agenda item ${code_}`);
        else if (subject in allItems && wsOf[code_] !== wsOf[subject]) add(`${where}: agenda item ${code_} is not in ${wsOf[subject]}, the meeting's workstream`);
      }
    }
    if ("response_due" in e && (typ !== "request" || !isDate(e.response_due) || (isDateTime(at) && e.response_due.iso < at.date))) {
      add(`${where}: response_due is for requests, on or after the request`);
    }
    if ("automated" in e && (typ !== "notice" || typeof e.automated !== "boolean")) add(`${where}: automated is a true/false flag for notices`);
    for (const original of e.reply_to ?? []) {
      const req = events[original];
      if (typ !== "response") add(`${where}: only responses reply to requests`);
      else if (!req || req.type !== "request") add(`${where}: replies to ${original}, which is not a request`);
      else {
        if (isDateTime(at) && isDateTime(req.at) && at.iso < req.at.iso) add(`${where}: answers ${original} before it was asked`);
        const answerable = new Set<string>(req.recipients ?? []);
        if (!answerable.has(actor) && !answerable.has(employer[actor]!)) add(`${where}: ${actor} answers ${original} but was not one of its recipients`);
      }
    }
    if (typ === "status-change") {
      for (const f of ["previous_status", "new_status"]) if (!STATUSES.has(e[f])) add(`${where}: ${f} must be one of ${sortedSet(STATUSES)}`);
      if (isDateTime(at) && (!(subject in latestChange) || at.iso > latestChange[subject]!.at.iso)) latestChange[subject] = e;
    }
  }
  for (const [subject, e] of Object.entries(latestChange)) {
    if (allItems[subject]?.status !== e.new_status) {
      add(`event ${e.code}: the latest status change on ${subject} says ${repr(e.new_status)}, but the item's status is ${repr(allItems[subject]?.status)}`);
    }
  }

  // ---- risk register ----
  for (const r of seed.risks ?? []) {
    const where = `risk ${r.code}`;
    for (const [field, allowed] of [["likelihood", LIKELIHOODS], ["severity", SEVERITIES], ["status", RISK_STATUSES]] as const) {
      if (!allowed.has(r[field])) add(`${where}: ${field} must be one of ${sortedSet(allowed)}`);
    }
    if (!(r.owner in parties)) add(`${where}: unknown owner ${r.owner}`);
    if (!r.exposed?.length || (r.exposed as string[]).some((c) => !(c in allItems))) add(`${where}: must threaten at least one known work item`);
    for (const field of ["name", "description", "mitigation"]) if (!r[field]) add(`${where}: missing ${field}`);
  }
}

function isDecimal(text: string): boolean {
  return /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(text);
}

function money(value: unknown, where: string, add: (p: string) => void): void {
  if (typeof value !== "string") {
    add(`${where}: must be a quoted string such as "2400000000", so it stays exact`);
    return;
  }
  if (!isDecimal(value)) add(`${where}: ${repr(value)} is not a number`);
  else if (Number(value) <= 0) add(`${where}: must be positive`);
}

// ---- 2. render TypeQL ----------------------------------------------------------------------

/** TypeQL variable for a code: ORG-ATL-UK -> $org-atl-uk. */
export function variable(code: string): string {
  return "$" + code.toLowerCase();
}

type Attr = string | number | boolean | Dec | YDate | null | undefined;

function has(attrs: Record<string, Attr>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    const label = name.replace(/_/g, "-");
    let literal: string;
    if (typeof value === "boolean") literal = value ? "true" : "false";
    else if (value instanceof Dec) literal = decimalLiteral(value.toPlainString());
    else if (value instanceof YDateTime) literal = value.iso;
    else if (value instanceof YDate) literal = value.iso;
    else if (typeof value === "number" && Number.isInteger(value)) literal = String(value);
    else literal = string(String(value));
    parts.push(`has ${label} ${literal}`);
  }
  return parts.length ? ", " + parts.join(", ") : "";
}

function mandateByAdviser(seed: Seed): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of seed.mandates ?? []) (out[m.adviser] ??= []).push(m.code);
  return out;
}

/** The mandate a holder acts under: a person employed by an adviser with exactly one mandate. */
export function viaMandate(seed: Seed, holder: string): string | null {
  const employer: Record<string, string> = {};
  for (const p of seed.people ?? []) employer[p.code] = p.employer;
  const found = mandateByAdviser(seed)[employer[holder] ?? holder] ?? [];
  return found.length === 1 ? found[0]! : null;
}

/** The whole dataset as one TypeQL insert query. */
export function render(seed: Seed): string {
  const deal = seed.deal;
  const d = variable(deal.code);
  const lines = ["# GENERATED by api/src/seed.ts from data/seed/*.yaml. Do not edit by hand.",
    "# FICTIONAL DEMONSTRATION DATA. Load in a WRITE transaction after schema/*.tql.",
    "insert"];
  const out = (line: string) => lines.push(line);

  out("  # ---- organisations and people ----");
  for (const o of seed.organisations) {
    out(`  ${variable(o.code)} isa ${o.type}` + has({ code: o.code, name: o.name, description: o.description,
      jurisdiction: o.jurisdiction, sector: o.sector }) + ";");
  }
  for (const p of seed.people) {
    out(`  ${variable(p.code)} isa person` + has({ code: p.code, name: p.name, email: p.email, phone: p.phone }) + ";");
    out(`  employment (employee: ${variable(p.code)}, employer: ${variable(p.employer)})` + has({ job_title: p.job_title }) + ";");
  }

  out("  # ---- the deal, mandates, financing, ownership ----");
  out(`  ${d} isa acquisition (acquirer: ${variable(deal.acquirer)}, target: ${variable(deal.target)})`
    + has({ code: deal.code, name: deal.name, description: deal.description,
      deal_value: Dec.of(deal.value), currency: deal.currency, deal_structure: deal.structure,
      as_of_date: deal.as_of }) + ";");
  for (const m of seed.mandates) {
    out(`  ${variable(m.code)} isa mandate (client: ${variable(m.client)}, adviser: ${variable(m.adviser)}, engagement: ${d})`
      + has({ code: m.code, mandate_type: m.type }) + ";");
  }
  for (const f of seed.financing) {
    out(`  ${variable(f.code)} isa financing (borrower: ${variable(f.borrower)}, lender: ${variable(f.lender)}, purpose: ${d})`
      + has({ code: f.code, name: f.name, deal_value: Dec.of(f.value), currency: f.currency }) + ";");
  }
  for (const own of seed.ownership) {
    out(`  ownership (owner: ${variable(own.owner)}, owned: ${variable(own.owned)})`
      + has({ stake: Dec.of(own.stake), description: own.description }) + ";");
  }

  out("  # ---- work ----");
  for (const w of seed.workstreams) {
    out(`  ${variable(w.code)} isa workstream` + itemAttrs(w) + ";");
    out(`  deal-scope (deal: ${d}, item: ${variable(w.code)});`);
  }
  for (const it of seed.items) {
    out(`  ${variable(it.code)} isa ${it.type}` + itemAttrs(it) + ";");
    out(`  deal-scope (deal: ${d}, item: ${variable(it.code)});`);
    out(`  work-breakdown (whole: ${variable(it.workstream)}, part: ${variable(it.code)});`);
  }
  for (const dep of seed.dependencies) {
    out(`  ${dep.kind} (prerequisite: ${variable(dep.from)}, dependent: ${variable(dep.to)})` + has({ lag_days: dep.lag }) + ";");
  }
  for (const dl of seed.deadline_limits) out(`  deadline-limit (limited-item: ${variable(dl.item)}, deadline: ${variable(dl.deadline)});`);
  for (const rv of seed.reviews) {
    out(`  authority-review (reviewer: ${variable(rv.reviewer)}, subject: ${variable(rv.subject)}, applicant: ${variable(rv.applicant)})`
      + has({ legal_basis: rv.legal_basis, review_phase: rv.phase }) + ";");
  }
  for (const b of seed.bound_by) out(`  bound-by (obligor: ${variable(b.obligor)}, obligation: ${variable(b.obligation)});`);
  for (const c of seed.consents) out(`  consent-right (grantor: ${variable(c.grantor)}, obligation: ${variable(c.obligation)});`);

  out("  # ---- RACI ----");
  for (const [code, letters] of Object.entries(seed.raci as Record<string, Record_>)) {
    for (const [letter, holders] of Object.entries(letters)) {
      for (const h of typeof holders === "string" ? [holders] : (holders as string[])) {
        const itemRole = letter === "A" ? "accountable-item" : "item";
        const via = viaMandate(seed, h);
        const viaPart = via ? `, via: ${variable(via)}` : "";
        out(`  ${RACI_TYPES[letter]} (holder: ${variable(h)}, ${itemRole}: ${variable(code)}${viaPart});`);
      }
    }
  }

  out("  # ---- activity history ----");
  for (const ev of seed.events) {
    const roles = [`actor: ${variable(ev.actor)}`, `subject: ${variable(ev.subject)}`];
    roles.push(...(ev.recipients ?? []).map((r: string) => `recipient: ${variable(r)}`));
    roles.push(...(ev.attendees ?? []).map((a: string) => `attendee: ${variable(a)}`));
    roles.push(...(ev.agenda ?? []).map((a: string) => `agenda-item: ${variable(a)}`));
    out(`  ${variable(ev.code)} isa ${ev.type} (${roles.join(", ")})`
      + has({ code: ev.code, occurred_at: ev.at, summary: ev.summary, event_kind: ev.kind,
        response_due_date: ev.response_due, automated: ev.automated,
        previous_status: ev.previous_status, new_status: ev.new_status }) + ";");
  }
  for (const ev of seed.events) {
    for (const original of ev.reply_to ?? []) out(`  reply (original: ${variable(original)}, answer: ${variable(ev.code)});`);
  }

  out("  # ---- risk register ----");
  for (const r of seed.risks ?? []) {
    out(`  ${variable(r.code)} isa risk` + has({ code: r.code, name: r.name, description: r.description,
      likelihood: r.likelihood, severity: r.severity, risk_status: r.status, mitigation: r.mitigation }) + ";");
    out(`  risk-ownership (risk-owner: ${variable(r.owner)}, owned-risk: ${variable(r.code)});`);
    for (const item of r.exposed) out(`  risk-exposure (risk: ${variable(r.code)}, exposed: ${variable(item)});`);
  }
  return lines.join("\n") + "\n";
}

function itemAttrs(it: Record_): string {
  const completed = "completed" in it ? it.completed : it.status === "complete" ? it.due : null;
  return has({ code: it.code, name: it.name, description: it.description, status: it.status,
    criticality: it.criticality ?? "medium", planned_start: it.planned_start,
    due_date: it.due, baseline_due_date: "baseline_due" in it ? it.baseline_due : it.due,
    completed_date: completed, progress: it.progress, actual_start_date: it.actual_start,
    legal_basis: it.legal_basis, consequence: it.consequence });
}

// ---- 3. expected counts and loading ----------------------------------------------------------

/** How many instances of each exact type the seed should create. */
export function expectedCounts(seed: Seed): Record<string, number> {
  const c: Record<string, number> = {};
  const bump = (k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };
  for (const o of seed.organisations) bump(o.type);
  bump("person", seed.people.length);
  bump("employment", seed.people.length);
  bump("acquisition");
  bump("mandate", seed.mandates.length);
  bump("financing", seed.financing.length);
  bump("ownership", seed.ownership.length);
  bump("workstream", seed.workstreams.length);
  for (const it of seed.items) bump(it.type);
  bump("deal-scope", seed.workstreams.length + seed.items.length);
  bump("work-breakdown", seed.items.length);
  for (const dep of seed.dependencies) bump(dep.kind);
  bump("deadline-limit", seed.deadline_limits.length);
  bump("authority-review", seed.reviews.length);
  bump("bound-by", seed.bound_by.length);
  bump("consent-right", seed.consents.length);
  for (const letters of Object.values(seed.raci as Record<string, Record_>)) {
    for (const [letter, holders] of Object.entries(letters)) bump(RACI_TYPES[letter]!, typeof holders === "string" ? 1 : (holders as string[]).length);
  }
  for (const ev of seed.events) bump(ev.type);
  bump("reply", (seed.events as Record_[]).reduce((n, ev) => n + (ev.reply_to?.length ?? 0), 0));
  bump("risk", (seed.risks ?? []).length);
  bump("risk-ownership", (seed.risks ?? []).length);
  bump("risk-exposure", ((seed.risks ?? []) as Record_[]).reduce((n, r) => n + r.exposed.length, 0));
  return c;
}

/**
 * Validate and load the seed into an existing database that already has the schema.
 *
 * Returns a report {counts}. Throws SeedError (nothing saved) if anything is wrong.
 */
export async function load(connection: Connection, db: string, seed?: Seed | null): Promise<{ counts: Record<string, number> }> {
  seed = seed ?? readSeed();
  validate(seed);
  const insert = render(seed);
  const expected = expectedCounts(seed);
  const { result } = await connection.transaction("write", async (tx) => {
    await tx.run(insert);
    const actual = await queries.countsByType(tx, sorted(Object.keys(expected)));
    const problems = sorted(Object.entries(expected), ([l]) => l).filter(([l, n]) => actual[l] !== n)
      .map(([l, n]) => `${l}: expected ${n} in TypeDB, found ${actual[l]}`);
    const own = await queries.ownershipProblems(tx);
    if (own.cycles.length) {
      problems.push("ownership cycle through " + own.cycles.join(", ") + " (cross-shareholdings are rejected: see docs/schema-design.md §4)");
    }
    for (const [code, total] of Object.entries(own.over_owned)) problems.push(`${code} is more than 100% owned (direct stakes add up to ${total.toPlainString()})`);
    for (const [check, codes] of Object.entries(await queries.dataQualityChecks(tx))) {
      if (codes.length) problems.push(`data-quality check ${check} failed for ${codes.join(", ")}`);
    }
    if (problems.length) throw new SeedError(problems); // leaving without commit discards everything
    return actual;
  }, db);
  return { counts: result };
}

/** Save the generated insert for people who want to load the data in TypeDB Studio. */
export function writeSeedTql(seed?: Seed | null, path = SEED_TQL): string {
  seed = seed ?? readSeed();
  validate(seed);
  writeFileSync(path, render(seed));
  return path;
}
