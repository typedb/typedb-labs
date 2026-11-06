// The seed data and its validator, without TypeDB.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as database from "../src/database.ts";
import { Dec } from "../src/decimal.ts";
import * as seedModule from "../src/seed.ts";
import { readSeed, render, SeedError, validate, YDate, YDateTime, type Seed } from "../src/seed.ts";
import { isApexDatabase } from "../src/settings.ts";
import { decimalLiteral } from "../src/typedb.ts";

const seed = readSeed();

test("the seed is valid", () => {
  validate(seed);
});

test("the generated seed.tql is up to date", () => {
  expect(readFileSync(seedModule.SEED_TQL, "utf8")).toBe(render(seed)); // data/seed.tql is out of date: run npm run export-seed-tql
});

test("every item and workstream has exactly one Accountable", () => {
  const codes = new Set([...seed.items.map((i: Seed) => i.code), ...seed.workstreams.map((w: Seed) => w.code)]);
  expect(new Set(Object.keys(seed.raci))).toEqual(codes);
  expect(Object.values(seed.raci as Record<string, Seed>).every((letters) => typeof letters.A === "string")).toBe(true);
});

function broken(change: (s: Seed) => void): string {
  const s = readSeed();
  change(s);
  try {
    validate(s);
  } catch (error) {
    expect(error).toBeInstanceOf(SeedError);
    return (error as SeedError).message;
  }
  throw new Error("the broken seed was accepted");
}

const item = (s: Seed, code: string) => s.items.find((i: Seed) => i.code === code);
const event = (s: Seed, code: string) => s.events.find((e: Seed) => e.code === code);

test("a missing Accountable is refused", () => {
  expect(broken((s) => delete s.raci["CP-CMA"].A)).toContain("exactly one Accountable");
});

test("an unknown reference is refused", () => {
  expect(broken((s) => s.dependencies.push({ kind: "gating", from: "CP-CMA", to: "MS-NOPE", lag: 1 }))).toContain("unknown item MS-NOPE");
});

test("a duplicate code is refused", () => {
  expect(broken((s) => s.people.push({ ...s.people[0] }))).toContain("is used 2 times");
});

test("a stake must be an exact string", () => {
  expect(broken((s) => { s.ownership[0].stake = 0.7; })).toContain("quoted string");
});

test("the wrong kind of party is refused", () => {
  expect(broken((s) => { s.mandates[0].adviser = "ORG-CMA"; })).toContain("is a regulator");
});

test("a deadline needs a consequence", () => {
  expect(broken((s) => delete item(s, "DL-LONGSTOP").consequence)).toContain("needs a consequence");
});

test("decimal literals are exact", () => {
  expect(decimalLiteral(Dec.of("0.7").toPlainString())).toBe("0.7dec");
  expect(decimalLiteral(Dec.of("2400000000").toPlainString())).toBe("2400000000.0dec");
});

test("only Apex databases can be managed", () => {
  expect(isApexDatabase("apex") && isApexDatabase("apex-demo") && isApexDatabase("apex-test-1a2b")).toBe(true);
  for (const other of ["newslens", "charcoal", "cti", "apex-prod", "apex-test-", "APEX"]) expect(isApexDatabase(other), other).toBe(false);
});

test("advisers' people hold letters via their mandate", () => {
  expect(seedModule.viaMandate(seed, "PER-AINSWORTH")).toBe("MAN-BWM");
  expect(seedModule.viaMandate(seed, "PER-OKAFOR")).toBeNull(); // works for the client
  expect(seedModule.viaMandate(seed, "PER-HOLT")).toBeNull(); // lender: financing, not a mandate
});

// ---- Phase 6A.2: one test per new validation rule ----

test("every person has fictional contacts", () => {
  const emails = seed.people.map((p: Seed) => p.email);
  const phones = seed.people.map((p: Seed) => p.phone);
  expect(new Set(emails).size).toBe(45);
  expect(new Set(phones).size).toBe(45);
  expect(seed.people).toHaveLength(45);
  expect(emails.every((e: string) => e.endsWith(".example"))).toBe(true); // reserved domain: never deliverable
  expect(phones.every((p: string) => p.startsWith("07700 900"))).toBe(true); // Ofcom's range reserved for drama
});

test("a bad email is refused", () => {
  expect(broken((s) => { s.people[0].email = "e.hartley@novacore.com"; })).toContain("email must be");
});

test("a bad phone is refused", () => {
  expect(broken((s) => { s.people[0].phone = "020 7946 0000"; })).toContain("phone must be");
});

test("a shared phone is refused", () => {
  expect(broken((s) => { s.people[1].phone = s.people[0].phone; })).toContain("used by more than one person");
});

test("stored workstream progress is refused", () => {
  expect(broken((s) => { s.workstreams[0].progress = 50; })).toContain("must not be stored");
});

test("an activity needs a planned start", () => {
  expect(broken((s) => delete item(s, "AC-DD-VDR").planned_start)).toContain("needs a planned_start");
});

test("a start after the due date is refused", () => {
  expect(broken((s) => {
    const it = item(s, "AC-DD-VDR");
    it.planned_start = new YDate(new Date(Date.parse(it.due.iso) + 86_400_000).toISOString().slice(0, 10));
  })).toContain("is after its due date");
});

test("an event after the scenario date is refused", () => {
  expect(broken((s) => { event(s, "EV-DD-03").at = new YDateTime("2027-01-05T09:00:00"); })).toContain("after the scenario date");
});

test("an actor without a role is refused", () => {
  expect(broken((s) => { event(s, "EV-DD-03").actor = "PER-MENSAH"; })).toContain("has no role in");
});

test("a response before its request is refused", () => {
  expect(broken((s) => { event(s, "EV-DD-04").at = new YDateTime("2026-05-20T09:00:00"); })).toContain("before it was asked");
});

test("a responder who was not asked is refused", () => {
  expect(broken((s) => { event(s, "EV-DD-03").recipients = ["PER-AINSWORTH"]; })).toContain("was not one of its recipients");
});

test("a reply to something other than a request is refused", () => {
  expect(broken((s) => { event(s, "EV-DD-04").reply_to = ["EV-DD-02"]; })).toContain("which is not a request");
});

test("response_due only on requests", () => {
  expect(broken((s) => { event(s, "EV-DD-02").response_due = event(s, "EV-DD-03").response_due; })).toContain("response_due is for requests");
});

test("a meeting without attendees is refused", () => {
  expect(broken((s) => delete event(s, "EV-DD-02").attendees)).toContain("meetings have attendees");
});

test("a status change contradicting the item is refused", () => {
  expect(broken((s) => { event(s, "EV-REG-16").new_status = "complete"; })).toContain("the latest status change on AC-REG-CMA-RESP");
});

test("a risk needs valid fields and a known owner", () => {
  expect(broken((s) => { s.risks[0].severity = "extreme"; })).toContain("severity must be one of");
  expect(broken((s) => { s.risks[0].owner = "PER-NOBODY"; })).toContain("unknown owner");
  expect(broken((s) => { s.risks[0].exposed = []; })).toContain("at least one known work item");
});

test("migrations are numbered once and in order", () => {
  const names = database.migrationFiles().map((f) => f.split("/").pop()!);
  expect(names).toEqual([...names].sort());
  expect(names[0]!.startsWith("001-")).toBe(true);
});

test("text split by an unquoted comma is refused", () => {
  expect(broken((s) => { item(s, "CV-COC-CALDER")["received unconditionally."] = null; })) // what YAML makes of an unquoted comma
    .toContain("quote any text that contains a comma");
});

test("agenda rules", () => {
  expect(broken((s) => { event(s, "EV-DD-04").agenda = ["MS-DD"]; })).toContain("only meetings have an agenda");
  expect(broken((s) => { event(s, "EV-LEG-22").agenda = ["AC-NOPE"]; })).toContain("unknown agenda item");
  expect(broken((s) => { event(s, "EV-LEG-22").agenda = ["CP-CMA"]; })).toContain("is not in WS-LEG");
});
