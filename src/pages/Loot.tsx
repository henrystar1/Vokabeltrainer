import { useState } from 'react'
import { Gift, Zap } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { TextInput } from '../components/ui/Field'
import LootBox from '../components/ui/LootBox'
import PageHeader from '../components/ui/PageHeader'
import RewardReveal, { type Reward } from '../components/ui/RewardReveal'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { toReveal } from '../features/advent/doors'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { adminAdventReset, adminLootGift, adminLootReset, lootGiftsSeen, lootOpen, lootStatus } from '../services/tasks'

type Kind = 'global' | 'personal'

/** Loot Drop: täglich ein Paket für alle (nur die schnellste Person) und ein persönliches Paket. */
export default function LootPage() {
  const { refreshProfile, isAdmin } = useAuth()
  const wallet = useWallet()
  const st = useAsync(lootStatus, [])
  const [reveal, setReveal] = useState<{ title: string; rewards: Reward[] } | null>(null)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [count, setCount] = useState('3')
  const [amount, setAmount] = useState('100')
  const [adminBusy, setAdminBusy] = useState(false)

  if (st.loading && !st.data) return <Spinner />
  if (st.error || !st.data) return <ErrorBox message={st.error ?? 'Der Loot Drop konnte nicht geladen werden.'} onRetry={st.reload} />
  const data = st.data

  async function open(kind: Kind) {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      const [r] = await Promise.all([lootOpen(kind), new Promise((res) => window.setTimeout(res, 2000))])
      setReveal({ title: kind === 'global' ? 'Du warst am schnellsten!' : 'Dein Paket', rewards: toReveal(r.rewards) })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
      void Promise.all([st.reload(), refreshProfile(), wallet.refresh()])
    }
  }

  async function showGifts() {
    const total = data.gifts.reduce((s, g) => s + g.amount, 0)
    setReveal({ title: 'Ein Geschenk für dich!', rewards: [{ type: 'coins', amount: total }] })
    await lootGiftsSeen().catch(() => undefined)
    void Promise.all([st.reload(), wallet.refresh()])
  }

  async function admin(fn: () => Promise<unknown>, ok: (r: never) => string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setAdminBusy(true)
    setError(null)
    setMsg(null)
    try {
      const r = await fn()
      setMsg(ok(r as never))
      void Promise.all([st.reload(), wallet.refresh()])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setAdminBusy(false)
    }
  }

  const n = Number.parseInt(count, 10)
  const a = Number.parseInt(amount, 10)
  const giftValid = Number.isInteger(n) && n >= 1 && n <= 100 && Number.isInteger(a) && a >= 1 && a <= 1_000_000

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Jeden Tag zwei Pakete: Coins, Punkte oder Verkleidungen" title="Loot Drop" />
      {error && <ErrorBox message={error} />}
      {data.gifts.length > 0 && (
        <Notice tone="ok">
          Du hast {data.gifts.reduce((s, g) => s + g.amount, 0).toLocaleString('de-DE')} Coins geschenkt bekommen!{' '}
          <button type="button" className="underline" onClick={() => void showGifts()}>Auspacken</button>
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 text-center">
          <h2 className="flex items-center justify-center gap-2 text-lg font-semibold"><Zap size={18} className="text-yellow-300" aria-hidden /> Paket für alle</h2>
          <LootBox tone="gold" label="Paket für alle öffnen" state={busy === 'global' ? 'opening' : data.global.opened ? (data.global.mine ? 'open' : 'taken') : 'closed'} onOpen={() => void open('global')} />
          <p className="text-sm text-slate-300">
            {data.global.opened
              ? data.global.mine ? 'Das Paket von heute hast du geöffnet. Bis morgen!' : `Heute war ${data.global.by ?? 'jemand'} schneller. Morgen ist ein neues Paket da.`
              : 'Nur die schnellste Person am Tag darf es öffnen. Dafür ist mehr drin! Tippe aufs Paket, schnell!'}
          </p>
        </Card>
        <Card className="space-y-3 text-center">
          <h2 className="flex items-center justify-center gap-2 text-lg font-semibold"><Gift size={18} className="text-emerald-300" aria-hidden /> Dein Paket</h2>
          <LootBox tone="green" label="Dein Paket öffnen" state={busy === 'personal' ? 'opening' : data.personal.opened ? 'open' : 'closed'} onOpen={() => void open('personal')} />
          <p className="text-sm text-slate-300">{data.personal.opened ? 'Dein Paket für heute hast du schon geöffnet. Bis morgen!' : 'Jeden Tag ein eigenes Paket, das nur dir gehört. Tippe drauf!'}</p>
        </Card>
      </div>

      {isAdmin && (
        <Card className="space-y-4">
          <h2 className="label-mono">Admin</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-slate-400">Anzahl Personen
              <TextInput className="!min-h-[40px] w-24" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-400">Coins je Person
              <TextInput className="!min-h-[40px] w-28" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <Button className="!min-h-[40px] !px-3 text-sm" busy={adminBusy} disabled={!giftValid}
              onClick={() => void admin(() => adminLootGift(n, a), (r: string[]) => `Verschenkt an: ${r.join(', ') || 'niemanden'}.`, `${a} Coins an ${n} zufällige Person(en) verschenken?`)}>
              An Zufällige verschenken
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={adminBusy}
              onClick={() => void admin(() => adminAdventReset(false), (r: number) => `Dein Adventskalender ist zurückgesetzt (${r} Türchen wieder zu).`, 'Alle deine Türchen dieses Jahres wieder schließen? Schon erhaltene Belohnungen bleiben.')}>
              Mein Adventskalender neu starten
            </Button>
            <Button variant="danger" className="!min-h-[40px] !px-3 text-sm" busy={adminBusy}
              onClick={() => void admin(() => adminAdventReset(true), (r: number) => `Adventskalender für alle zurückgesetzt (${r} Türchen).`, 'Den Adventskalender für ALLE Personen zurücksetzen?')}>
              Adventskalender für alle neu starten
            </Button>
            <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={adminBusy}
              onClick={() => void admin(() => adminLootReset(false), () => 'Loot Drop von heute zurückgesetzt (dein Paket und das Paket für alle).')}>
              Loot Drop heute zurücksetzen (Test)
            </Button>
          </div>
          {msg && <Notice tone="ok">{msg}</Notice>}
        </Card>
      )}
      {reveal && <RewardReveal gift={false} title={reveal.title} rewards={reveal.rewards} onClose={() => setReveal(null)} />}
    </div>
  )
}
