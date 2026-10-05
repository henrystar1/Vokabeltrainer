import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Flame } from 'lucide-react'
import CoinIcon from '../components/ui/CoinIcon'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getAppSettings } from '../services/koins'
import { claimQuest, getQuests, getStreak } from '../services/play'
import type { Quest, QuestId } from '../types'

const INFO: Record<QuestId, { title: string; text: (q: Quest, rules: Record<string, number>) => string; to: string; cta: string }> = {
  answers: { title: 'Fleißig', text: (q) => `${q.goal} Vokabeln richtig beantworten`, to: '/lernen', cta: 'Lernen' },
  perfect: { title: 'Fehlerfrei', text: (_q, r) => `Eine Runde mit mindestens ${r.quest_goal_perfect ?? 10} Fragen ohne einen Fehler`, to: '/lernen', cta: 'Lernen' },
  sprint: { title: 'Sprinter', text: (q) => `${q.goal} richtige Antworten in einem Sprint`, to: '/sprint', cta: 'Sprint' },
  duel: { title: 'Herausforderer', text: (q) => (q.goal > 1 ? `${q.goal} Duelle abschließen` : 'Ein Duell gegen einen Freund abschließen'), to: '/duell', cta: 'Duell' },
}

export default function Quests() {
  const wallet = useWallet()
  const quests = useAsync(getQuests, [])
  const streak = useAsync(getStreak, [])
  const rules = useAsync(getAppSettings, [])
  const [busy, setBusy] = useState<QuestId | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function claim(q: Quest) {
    setBusy(q.id)
    setError(null)
    setMsg(null)
    try {
      wallet.setBalance(await claimQuest(q.id))
      setMsg(`+${q.reward} Coins eingesammelt!`)
      quests.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const s = streak.data
  return (
    <div>
      <PageHeader eyebrow="Tagesziele" title="Quests" />
      <Card className="mb-6 flex flex-wrap items-center gap-5">
        <Flame size={34} className={s && s.current > 0 ? 'text-orange-400' : 'text-slate-600'} />
        <div>
          <p className="font-mono text-3xl text-accent-cyan">{s ? s.current : '—'} <span className="text-base text-slate-400">{s?.current === 1 ? 'Tag' : 'Tage'} in Folge</span></p>
          <p className="text-sm text-slate-400">
            Rekord: {s ? s.best : '—'} · {s?.today_done ? 'Heute schon gelernt ✓' : 'Lerne heute, um deine Serie zu halten.'}
          </p>
        </div>
      </Card>

      {msg && <div className="mb-4"><Notice tone="ok">{msg}</Notice></div>}
      {(error || quests.error) && <div className="mb-4"><ErrorBox message={error ?? quests.error ?? ''} onRetry={quests.reload} /></div>}
      {quests.loading && !quests.data && <Spinner />}
      <div className="grid gap-4 sm:grid-cols-2">
        {quests.data?.map((q) => {
          const info = INFO[q.id]
          if (!info) return null
          const done = q.progress >= q.goal
          return (
            <Card key={q.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold">{info.title}</h2>
                <span className="flex items-center gap-1 font-mono text-sm text-amber-300"><CoinIcon size={15} /> {q.reward}</span>
              </div>
              <p className="text-sm text-slate-300">{info.text(q, rules.data ?? {})}</p>
              <div>
                <div className="mb-1 flex justify-between font-mono text-xs text-slate-400">
                  <span>{Math.min(q.progress, q.goal)} / {q.goal}</span>
                </div>
                <ProgressBar value={(q.progress / q.goal) * 100} label={info.title} />
              </div>
              {q.claimed ? (
                <p className="flex items-center gap-2 text-sm text-emerald-300"><Check size={16} /> Heute eingesammelt</p>
              ) : done ? (
                <Button busy={busy === q.id} onClick={() => void claim(q)}>Belohnung einsammeln</Button>
              ) : (
                <Link to={info.to} className="text-sm text-accent-cyan hover:underline">{info.cta} starten →</Link>
              )}
            </Card>
          )
        })}
      </div>
      <p className="mt-4 max-w-xl text-xs text-slate-500">Quests setzen sich jeden Tag zurück. Belohnungen gibt es nur für Vokabeln aus deinen aktiven Büchern.</p>
    </div>
  )
}
