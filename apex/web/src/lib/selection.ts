// The selected work item lives in the URL (?item=CODE), so any panel on a page can open the shared item
// panel and the view can be linked to.
import { useSearchParams } from 'react-router'

export function useSelectedItem(): [string | undefined, (code: string | undefined) => void] {
  const [params, setParams] = useSearchParams()
  const select = (code: string | undefined) => {
    const next = new URLSearchParams(params)
    if (code) next.set('item', code)
    else next.delete('item')
    setParams(next, { replace: true, preventScrollReset: true })
  }
  return [params.get('item') ?? undefined, select]
}
