/**
 * Mirai Studio — app root. Providers, event bridge, shell, toasts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MainEventsBridge } from './events/bridge'
import { AppShell } from './shell/AppShell'
import { Toaster } from './system/Toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 3_000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainEventsBridge />
      <AppShell />
      <Toaster />
    </QueryClientProvider>
  )
}
