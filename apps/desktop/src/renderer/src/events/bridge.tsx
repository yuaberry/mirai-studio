/**
 * Bridge: main-process push events → TanStack Query cache + toasts.
 * Registered exactly once at the app root.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { onEvent } from '../lib/ipc'
import { queryKeys } from '../lib/queries'
import { toast } from '../store/appStore'

const REFETCH_THROTTLE_MS = 400

function useThrottledInvalidator() {
  const queryClient = useQueryClient()
  const last = { jobs: 0, logs: 0, project: 0 }
  return {
    jobs() {
      const now = Date.now()
      if (now - last.jobs < REFETCH_THROTTLE_MS) return
      last.jobs = now
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
    },
    logs() {
      const now = Date.now()
      if (now - last.logs < REFETCH_THROTTLE_MS) return
      last.logs = now
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
    },
    project() {
      const now = Date.now()
      if (now - last.project < REFETCH_THROTTLE_MS) return
      last.project = now
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentProject })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  }
}

export function MainEventsBridge() {
  const invalidate = useThrottledInvalidator()

  useEffect(() => {
    const offJob = onEvent('jobs:updated', ({ job }) => {
      invalidate.jobs()
      if (job.status === 'COMPLETED') {
        toast({ kind: 'success', title: `Job completed — ${job.type}` })
      } else if (job.status === 'FAILED' && job.error) {
        toast({
          kind: 'error',
          title: `Job failed — ${job.type}`,
          description: job.error.message,
        })
      }
    })
    const offNotify = onEvent('notify', (n) => {
      toast({ kind: n.kind, title: n.title, description: n.description })
    })
    const offProject = onEvent('project:changed', () => {
      invalidate.project()
      invalidate.jobs()
    })
    const offLogs = onEvent('logs:appended', () => {
      invalidate.logs()
    })
    return () => {
      offJob()
      offNotify()
      offProject()
      offLogs()
    }
  }, [invalidate])

  return null
}
