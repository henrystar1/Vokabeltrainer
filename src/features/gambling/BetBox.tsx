import CoinIcon from '../../components/ui/CoinIcon'

const QUICK = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]

/** Einsatzfeld mit Schnellwahl (für Würfeln, Rad, Automat). */
export default function BetBox({ bet, setBet, maxBet, balance, id = 'bet' }: { bet: number; setBet: (n: number) => void; maxBet: number; balance: number; id?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label-mono inline-flex items-center gap-1.5"><CoinIcon size={13} /> Einsatz (Coins)</label>
      <input
        id={id}
        type="number"
        min={1}
        max={maxBet}
        inputMode="numeric"
        value={bet}
        onChange={(e) => setBet(Number(e.target.value))}
        className="mt-1 min-h-[48px] w-full rounded-xl border border-white/10 bg-space-900/70 px-3 font-mono text-lg"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK.filter((q) => q <= maxBet).map((q) => (
          <button key={q} type="button" onClick={() => setBet(q)} className={`min-h-[40px] rounded-lg px-3 font-mono text-sm ${bet === q ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
            {q.toLocaleString('de-DE')}
          </button>
        ))}
        <button type="button" onClick={() => setBet(Math.min(maxBet, Math.max(1, balance)))} className="min-h-[40px] rounded-lg bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10">Max</button>
      </div>
    </div>
  )
}
