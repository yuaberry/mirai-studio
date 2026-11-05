/**
 * usePersistedState — useState that survives navigation AND restarts
 * (localStorage-backed). Used for per-page selections (episode/scene picks,
 * active tabs) so the user never loses their working context.
 */
import { useEffect, useState } from 'react'

export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage full/blocked — persistence is best-effort */
    }
  }, [key, value])

  return [value, setValue]
}
