import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Network } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/shell'
import { Overview } from '@/pages/Overview'
import { ComingSoon } from '@/pages/ComingSoon'
// The Explorer (with the graph layout engine) loads only when it is opened.
const Explorer = lazy(() => import('@/pages/Explorer').then((m) => ({ default: m.Explorer })))
const Impact = lazy(() => import('@/pages/Impact').then((m) => ({ default: m.Impact })))
const Workstreams = lazy(() => import('@/pages/Workstreams').then((m) => ({ default: m.Workstreams })))
const Workstream = lazy(() => import('@/pages/Workstream').then((m) => ({ default: m.Workstream })))
const Parties = lazy(() => import('@/pages/Parties').then((m) => ({ default: m.Parties })))
const Party = lazy(() => import('@/pages/Party').then((m) => ({ default: m.Party })))
const Analyst = lazy(() => import('@/pages/Analyst').then((m) => ({ default: m.Analyst })))
const Guide = lazy(() => import('@/pages/Guide').then((m) => ({ default: m.Guide })))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AppShell>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/workstreams" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Workstreams /></Suspense>} />
              <Route path="/workstreams/:code" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Workstream /></Suspense>} />
              <Route path="/parties" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Parties /></Suspense>} />
              <Route path="/parties/:code" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Party /></Suspense>} />
              <Route path="/analyst" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Analyst /></Suspense>} />
              <Route path="/guide" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Guide /></Suspense>} />
              <Route path="/explorer" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Explorer /></Suspense>} />
              <Route path="/impact" element={<Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}><Impact /></Suspense>} />
              <Route path="*" element={<ComingSoon title="Page not found" phase="Not found" icon={Network} points={[]} />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
