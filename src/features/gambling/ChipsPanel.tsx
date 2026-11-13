import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import Button from '../../components/ui/Button'
import ChipIcon from '../../components/ui/ChipIcon'
import CoinIcon from '../../components/ui/CoinIcon'
import { Notice } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { buyChips, sellChips, type ChipTrade } from '../../services/chips'
import { useChips } from './ChipsProvider'
import { maxBuyable } from './chipLogic'

/** Chips kaufen (mit Tageslimit) und zurücktauschen. Spielgeld fürs Gambling: 1 Chip kostet mehrere Coins. */
export default function ChipsPanel() {
  const chips = useChips()
  const wallet = useWallet()
  const [n, setN] = useState(10)
  const [busy, setBusy] = useState<'buy' | 'sell' | null>(null)
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null)
  const s = chips.status
  const rate = s?.rate ?? 10
  const buyMax = maxBuyable(wallet.balance, rate, s?.buy_left ?? 0)

  const trade = async (kind: 'buy' | 'sell') => {
    setBusy(kind)
    setMsg(null)
    try {
      const r: ChipTrade = kind === 'buy' ? await buyChips(n) : await sellChips(n)
      chips.apply(r)
      wallet.setBalance(r.koins)
      setMsg({ tone: 'info', text: kind === 'buy' ? `${n.toLocaleString('de-DE')} Chips gekauft.` : `${n.toLocaleString('de-DE')} Chips zurückgetauscht (+${(n * rate).toLocaleString('de-DE')} Coins).` })
    } catch (e) {
      setMsg({ tone: 'warn', text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' })
    } finally {
      setBusy(null)
    }
  }
  const valid = Number.isInteger(n) && n >= 1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 font-mono text-2xl text-amber-200"><ChipIcon size={22} /> {chips.balance.toLocaleString('de-DE')} <span className="text-sm text-slate-400">Chips</span></p>
        <p className="inline-flex items-center gap-1.5 text-sm text-slate-400"><ArrowLeftRight size={14} /> 1 Chip = {rate} <CoinIcon size={13} /> Coins</p>
      </div>
      {s && (
        <p className="text-xs text-slate-400">
          Jeden Tag gibt es {s.daily.toLocaleString('de-DE')} Chips geschenkt. Gekauft werden können heute noch höchstens <b className="text-slate-200">{s.buy_left.toLocaleString('de-DE')}</b> von {s.limit.toLocaleString('de-DE')} Chips.
        </p>
      )}
      {s && s.gift > 0 && <Notice tone="info">Tagesgeschenk: +{s.gift.toLocaleString('de-DE')} Chips.</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[8rem] flex-1">
          <label htmlFor="chip-n" className="label-mono">Anzahl Chips</label>
          <input id="chip-n" type="number" min={1} inputMode="numeric" value={Number.isFinite(n) ? n : ''} onChange={(e) => setN(Math.floor(Number(e.target.value)))} className="mt-1 min-h-[48px] w-full rounded-xl border border-white/10 bg-space-900/70 px-3 font-mono text-lg" />
        </div>
        <Button onClick={() => void trade('buy')} busy={busy === 'buy'} disabled={!valid || busy !== null || n > buyMax}>Kaufen · {valid ? (n * rate).toLocaleString('de-DE') : 0} Coins</Button>
        <Button variant="secondary" onClick={() => void trade('sell')} busy={busy === 'sell'} disabled={!valid || busy !== null || n > chips.balance}>Zurücktauschen</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[10, 50, 100, 500].map((q) => (
          <button key={q} type="button" onClick={() => setN(q)} className="min-h-[36px] rounded-lg bg-white/5 px-3 font-mono text-sm text-slate-300 hover:bg-white/10">{q}</button>
        ))}
        <button type="button" onClick={() => setN(Math.max(1, buyMax))} className="min-h-[36px] rounded-lg bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10">Max kaufen</button>
        <button type="button" onClick={() => setN(Math.max(1, chips.balance))} className="min-h-[36px] rounded-lg bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10">Alle zurück</button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  )
}
