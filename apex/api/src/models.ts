// The shapes of the API's answers. web/openapi.json is the documented contract (maintained by hand
// alongside this file), and web/src/api/schema.d.ts is generated from it (`npm run gen:api` in web/),
// so the frontend and the API share one set of types. Money and stakes are exact decimals sent as text
// ("2400000000", "0.9"); dates are ISO text.

import type { components } from "../../web/src/api/schema.d.ts";

export type Schemas = components["schemas"];

export type Health = Schemas["Health"];
export type OwnershipProblem = Schemas["OwnershipProblem"];
export type DealResponse = Schemas["DealResponse"];
export type MilestonesResponse = Schemas["MilestonesResponse"];
export type ApprovalsResponse = Schemas["ApprovalsResponse"];
export type ActivityResponse = Schemas["ActivityResponse"];
export type PartiesResponse = Schemas["PartiesResponse"];
export type ProgressResponse = Schemas["ProgressResponse"];
export type RaciResponse = Schemas["RaciResponse"];
export type ChecksResponse = Schemas["ChecksResponse"];
export type OwnershipResponse = Schemas["OwnershipResponse"];
export type GraphResponse = Schemas["GraphResponse"];
export type PartyResponse = Schemas["PartyResponse"];
export type ScheduleResponse = Schemas["ScheduleResponse"];
export type ItemResponse = Schemas["ItemResponse"];
export type WorkstreamsResponse = Schemas["WorkstreamsResponse"];
export type WorkstreamResponse = Schemas["WorkstreamResponse"];
export type RegisterResponse = Schemas["RegisterResponse"];
export type PartyProfileResponse = Schemas["PartyProfileResponse"];
export type EngagementPolicyResponse = Schemas["EngagementPolicyResponse"];
export type ConnectablesResponse = Schemas["ConnectablesResponse"];
export type ConnectionsResponse = Schemas["ConnectionsResponse"];
export type AdvantageResponse = Schemas["AdvantageResponse"];
export type InvestigationResponse = Schemas["InvestigationResponse"];
export type GuideResponse = Schemas["GuideResponse"];
export type ImpactResponse = Schemas["ImpactResponse"];

/** The part of every answer that says how it was produced ("Show TypeQL"). */
export type Envelope = Pick<DealResponse, "typeql" | "parameters" | "database" | "elapsed_ms" | "capabilities" | "query_capabilities">;
