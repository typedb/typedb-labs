import { useSearchParams } from 'react-router'
import { GitFork, Network, Route } from 'lucide-react'
import { useDeal } from '@/api/client'
import { NetworkView } from '@/components/explorer/network'
import { OwnershipView } from '@/components/explorer/ownership'
import { PathsView } from '@/components/explorer/paths'
import { PageHeader, Segmented } from '@/components/page'

/** Relationship Explorer: the transaction network, and the target's group structure. */
export function Explorer() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'group' ? 'group' : params.get('view') === 'paths' ? 'paths' : 'network'
  const deal = useDeal()
  const target = deal.data?.data.target.name
  const tabs = [
    { key: 'network', label: 'Transaction network', short: 'Network', icon: Network },
    { key: 'group', label: target ? `${target} group structure` : 'Group structure', short: 'Group structure', icon: GitFork },
    { key: 'paths', label: 'Connections', short: 'Connections', icon: Route },
  ] as const
  return (
    <div className="space-y-5">
      <PageHeader title="Relationship Explorer"
        description="Who is involved in the deal and how, drawn directly from the typed relations stored in TypeDB."
        actions={<Segmented label="View" options={[...tabs]} value={view} onChange={(k) => setParams(k === 'network' ? {} : { view: k })} />} />
      {view === 'network' ? <NetworkView /> : view === 'group' ? <OwnershipView /> : <PathsView />}
    </div>
  )
}
