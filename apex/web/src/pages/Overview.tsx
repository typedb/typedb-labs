import { useRef } from 'react'
import { PageHeader } from '@/components/page'
import { DealHeader, KeyMetrics } from '@/components/overview/deal'
import { Gantt } from '@/components/gantt/gantt'
import { AttentionNeeded } from '@/components/overview/attention'
import { Approvals } from '@/components/overview/approvals'
import { RecentActivity } from '@/components/overview/activity'
import { PanelError } from '@/components/panel'
import { RaciMatrix, useWorkstreamChoice, WorkstreamProgress } from '@/components/overview/workstreams'
import { Participants } from '@/components/overview/participants'
import { useSelectedItem } from '@/lib/selection'

/** Deal Overview. Every panel reads its own API endpoint; nothing on screen is hard-coded. */
export function Overview() {
  const { selected, choose, error } = useWorkstreamChoice()
  const raci = useRef<HTMLDivElement>(null)
  const [, selectItem] = useSelectedItem()
  const pick = (code: string) => {
    choose(code)
    setTimeout(() => raci.current?.scrollIntoView({ block: 'start' }), 0)
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Deal Overview"
        description="The transaction at a glance: status, the schedule, approvals, data checks and the people involved." />
      <DealHeader />
      <KeyMetrics />
      <Gantt />
      {/* Two columns on wide screens; Recent activity stretches to the height of the left column. */}
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-5 xl:col-span-8">
          <Approvals />
          <WorkstreamProgress selected={selected} onSelect={pick} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-4">
          <AttentionNeeded />
          <RecentActivity fill />
        </div>
      </div>
      <Participants />
      <div ref={raci} className="scroll-mt-20">
        {error ? <PanelError message={error} /> : <RaciMatrix workstream={selected} onSelect={selectItem} />}
      </div>
    </div>
  )
}
