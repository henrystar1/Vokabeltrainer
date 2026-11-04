import { useMemo, useState } from 'react'
import { Gift } from 'lucide-react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import RewardReveal, { type Reward } from '../components/ui/RewardReveal'
import { ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { doorOrder, rewardEmoji, toReveal } from '../features/advent/doors'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { adventOpen, adventStatus, type AdventReward } from '../services/tasks'

/** Adventskalender: Jeden Tag lässt sich nur das richtige Türchen öffnen. */
export default function AdventPage() {
  const { refreshProfile } = useAuth()
  const wallet = useWallet()
  const st = useAsync(adventStatus, [])
  const [reveal, setReveal] = useState<{ day: number; rewards: Reward[] } | null>(null)
  const [wrong, setWrong] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const order = useMemo(() => doorOrder(st.data?.year ?? new Date().getFullYear()), [st.data?.year])

  if (st.loading) return <Spinner />
  if (st.error || !st.data) return <ErrorBox message={st.error ?? 'Der Kalender konnte nicht geladen werden.'} />
  const data = st.data
  const opened = new Map<number, AdventReward[]>(data.opened.map((o) => [o.day, o.rewards]))

  async function press(day: number) {
    if (busy) return
    setError(null)
    if (opened.has(day)) return
    if (data.state !== 'active' || day !== data.today) {
      setWrong(day)
      window.setTimeout(() => setWrong(null), 900)
      return
    }
    setBusy(true)
    try {
      const r = await adventOpen(day)
      setReveal({ day, rewards: toReveal(r.rewards) })
      await Promise.all([st.reload(), refreshProfile(), wallet.refresh()])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const hint =
    data.state === 'before' ? 'Der Adventskalender öffnet am 1. Dezember. Dann kannst du jeden Tag ein Türchen öffnen.'
    : data.state === 'over' ? 'Der Adventskalender ist für dieses Jahr vorbei. Frohe Weihnachten!'
    : opened.has(data.today) ? `Türchen ${data.today} hast du heute schon geöffnet. Bis morgen!`
    : `Heute ist Türchen ${data.today} dran. Finde die ${data.today} und drück drauf!`

  return (
    <div className="space-y-5">
      <style>{`@keyframes advent-no{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}@keyframes advent-glow{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.0)}50%{box-shadow:0 0 22px 4px rgba(250,204,21,.55)}}`}</style>
      <PageHeader eyebrow="Jeden Tag ein Türchen: Verkleidungen, Coins, Punkte und Plus-Tage" title="Adventskalender" />
      <Card className="space-y-4">
        <p className="flex items-center gap-2 text-sm text-slate-300"><Gift size={18} className="text-red-300" aria-hidden /> {hint}</p>
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3">
          {order.map((day) => {
            const got = opened.get(day)
            const today = data.state === 'active' && day === data.today && !got
            return (
              <button
                key={day}
                type="button"
                onClick={() => void press(day)}
                aria-label={got ? `Türchen ${day}, geöffnet` : `Türchen ${day}`}
                className={`relative flex aspect-square min-h-[64px] items-center justify-center rounded-xl border text-2xl font-bold transition ${got ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-red-300/30 bg-gradient-to-br from-red-700/60 to-green-800/60 text-white hover:scale-105'}`}
                style={wrong === day ? { animation: 'advent-no .4s' } : today ? { animation: 'advent-glow 2s infinite' } : undefined}
              >
                {got ? <span className="text-xl" aria-hidden>{rewardEmoji(got)}</span> : day}
                {got && <span className="absolute left-1.5 top-0.5 text-[10px] font-normal text-slate-400">{day}</span>}
              </button>
            )
          })}
        </div>
        {wrong !== null && <p className="text-sm text-amber-300">Das ist nicht das richtige Türchen{data.state === 'active' ? `. Heute ist die ${data.today} dran.` : '.'}</p>}
      </Card>
      {reveal && <RewardReveal title={`Türchen ${reveal.day}`} rewards={reveal.rewards} onClose={() => setReveal(null)} />}
    </div>
  )
}
