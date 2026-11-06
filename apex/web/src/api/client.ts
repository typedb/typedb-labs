// Typed access to the Apex API. Types come from the backend's own models (src/api/schema.d.ts is
// generated from web/openapi.json: `npm run gen:api`), so the two can't drift apart.
// The frontend holds no business data: everything shown comes from these calls.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from './schema'

export type Schemas = components['schemas']
/** The part of every response that describes how it was produced (shown in "Show TypeQL"). */
export type Envelope = Pick<Schemas['DealResponse'], 'typeql' | 'parameters' | 'database' | 'elapsed_ms' | 'capabilities' | 'query_capabilities'>

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Where the API lives: /api next to the app, whatever path the app itself is served from. */
const API = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiError(0, 'The Apex API is not reachable.')
  }
  if (!response.ok) {
    let detail = `The API answered ${response.status}.`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* not JSON: keep the generic message */
    }
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

const query = <T,>(key: unknown[], path: string) => ({
  queryKey: key,
  queryFn: () => getJson<T>(path),
})

export const useDeal = () => useQuery(query<Schemas['DealResponse']>(['deal'], `${API}/deal`))
export const useApprovals = () => useQuery(query<Schemas['ApprovalsResponse']>(['approvals'], `${API}/approvals`))
export const useActivity = (limit: number) =>
  useQuery(query<Schemas['ActivityResponse']>(['activity', limit], `/api/activity?limit=${limit}`))
export const useParties = () => useQuery(query<Schemas['PartiesResponse']>(['parties'], `${API}/parties`))
export const useProgress = () => useQuery(query<Schemas['ProgressResponse']>(['progress'], `${API}/progress`))
export const useRaci = (workstream: string | undefined) =>
  useQuery({
    ...query<Schemas['RaciResponse']>(['raci', workstream], `/api/raci?workstream=${encodeURIComponent(workstream ?? '')}`),
    enabled: Boolean(workstream),
  })
export const useChecks = () => useQuery(query<Schemas['ChecksResponse']>(['checks'], `${API}/checks`))
export const useGraph = () => useQuery(query<Schemas['GraphResponse']>(['graph'], `${API}/graph`))
export const useParty = (code: string | undefined) =>
  useQuery({ ...query<Schemas['PartyResponse']>(['party', code], `/api/graph/node/${encodeURIComponent(code ?? '')}`), enabled: Boolean(code) })
/** The group structure below the deal's target (the API chooses it from TypeDB; no code here). */
export const useOwnership = () => useQuery({ ...query<Schemas['OwnershipResponse']>(['ownership'], `${API}/ownership`), retry: false })
/** One impact scenario. The previous answer stays on screen while the next one loads (smooth slider). */
export const useImpact = (item: string | undefined, delayDays: number) =>
  useQuery({
    ...query<Schemas['ImpactResponse']>(['impact', item ?? 'default', delayDays],
      `/api/impact?delay_days=${delayDays}${item ? `&item=${encodeURIComponent(item)}` : ''}`),
    placeholderData: keepPreviousData, staleTime: 5 * 60_000,
  })
/** The Gantt chart: every workstream, item, dependency and deadline, with the scenario date. */
export const useSchedule = () => useQuery(query<Schemas['ScheduleResponse']>(['schedule'], `${API}/schedule`))
/** One item's detail (shared panel). The previous item stays on screen while the next one loads. */
export const useItem = (code: string | undefined) =>
  useQuery({
    ...query<Schemas['ItemResponse']>(['item', code], `/api/items/${encodeURIComponent(code ?? '')}`),
    enabled: Boolean(code), placeholderData: keepPreviousData,
  })
/** Every workstream's operational summary (one answer; the page filters and sorts it in the browser). */
export const useWorkstreams = () => useQuery(query<Schemas['WorkstreamsResponse']>(['workstreams'], `${API}/workstreams`))
/** One workstream in detail: items, dependencies, obligations and its event history. */
export const useWorkstream = (code: string | undefined) =>
  useQuery({ ...query<Schemas['WorkstreamResponse']>(['workstream', code], `/api/workstreams/${encodeURIComponent(code ?? '')}`), enabled: Boolean(code) })
/** Everyone on the deal with masked contacts and an explainable engagement assessment (one answer). */
export const useRegister = () => useQuery(query<Schemas['RegisterResponse']>(['register'], `${API}/register`))
/** One person's or organisation's profile. */
export const usePartyProfile = (code: string | undefined) =>
  useQuery({ ...query<Schemas['PartyProfileResponse']>(['party-profile', code], `/api/parties/${encodeURIComponent(code ?? '')}`), enabled: Boolean(code) })
/** The engagement thresholds in force (configuration). */
export const useEngagementPolicy = () => useQuery(query<Schemas['EngagementPolicyResponse']>(['engagement-policy'], `${API}/engagement-policy`))
/** Everything a connection path can join (for the pickers). */
export const useConnectables = () => useQuery(query<Schemas['ConnectablesResponse']>(['connectables'], `${API}/connectables`))
/** Paths between two things; the previous answer stays while the next loads. */
export const useConnections = (from: string | undefined, to: string | undefined, opts: { hops: number; results: number; activity: boolean; workstreams: boolean }) =>
  useQuery({
    ...query<Schemas['ConnectionsResponse']>(['connections', from, to, opts],
      `/api/connections?from=${encodeURIComponent(from ?? '')}&to=${encodeURIComponent(to ?? '')}&max_hops=${opts.hops}&results=${opts.results}&activity=${opts.activity}&workstreams=${opts.workstreams}`),
    enabled: Boolean(from && to && from !== to), placeholderData: keepPreviousData, retry: false,
  })
/** The TypeDB Advantage panel: evidence from the schema files and live TypeDB figures. */
export const useAdvantage = (enabled: boolean) => useQuery({ ...query<Schemas['AdvantageResponse']>(['advantage'], `${API}/advantage`), enabled })
/** AI Analyst concept preview: one predefined investigation (no AI model). */
export const useInvestigation = (key: string) => useQuery({ ...query<Schemas['InvestigationResponse']>(['analyst', key], `/api/analyst/${encodeURIComponent(key)}`), placeholderData: keepPreviousData })
/** The guided demonstration's steps. */
export const useGuide = () => useQuery(query<Schemas['GuideResponse']>(['guide'], `${API}/guide`))
/** Is TypeDB answering? Checked every 15 s, or every 4 s while it isn't. */
export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await fetch(`${API}/health`).catch(() => null)
      const body = r ? await r.json().catch(() => null) : null
      return { ok: Boolean(r?.ok && body?.status === 'ok'), detail: (body?.detail as string | undefined) ?? 'The Apex API is not reachable.' }
    },
    refetchInterval: (q) => (q.state.data?.ok === false ? 4_000 : 15_000),
    retry: false,
  })
