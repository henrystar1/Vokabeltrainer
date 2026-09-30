import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './errors'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** Lädt Daten beim Einbinden und bei Änderung von `deps`; verwirft veraltete Antworten. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  const loader = useRef(load)
  loader.current = load

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    loader.current().then(
      (d) => {
        if (id !== seq.current) return
        setData(d)
        setLoading(false)
      },
      (e) => {
        if (id !== seq.current) return
        setError(errorMessage(e))
        setLoading(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload }
}
