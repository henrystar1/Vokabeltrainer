import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { deathrunOpenJoin } from '../services/play'

/** Menüpunkt „Offene Deathrun-Lobby“: Antippen = sofort in die offene Lobby (oder zurück in den laufenden Lauf). */
export default function OpenDeathrun() {
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const [again, setAgain] = useState(0)

  useEffect(() => {
    if (started.current && again === 0) return
    started.current = true
    let alive = true
    setError(null)
    deathrunOpenJoin()
      .then((id) => { if (alive) nav(`/team/${id}`, { replace: true }) })
      .catch((e) => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [again]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader eyebrow="Parkour" title="Offene Deathrun-Lobby" />
      {error ? (
        <>
          <ErrorBox message={error} />
          <div className="flex gap-2">
            <Button onClick={() => setAgain((n) => n + 1)}>Nochmal versuchen</Button>
            <Link to="/parkour" className="inline-flex min-h-[44px] items-center px-3 text-accent-cyan hover:underline">Zurück</Link>
          </div>
        </>
      ) : (
        <div className="space-y-2 text-center text-slate-300"><Spinner /><p>Du kommst in die offene Lobby …</p></div>
      )}
    </div>
  )
}
