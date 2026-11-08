import { Crown, Sparkles } from 'lucide-react'
import { useAsync } from '../../lib/useAsync'
import { plusRecentBuys } from '../../services/plus'
import { ago, buyJoke } from './buyJokes'

/** „Zuletzt gekauft“: wer sich zuletzt Plus oder Pro gegönnt hat, mit einem Spruch dazu. */
export default function BuyTicker() {
  const buys = useAsync(plusRecentBuys, [])
  const list = (buys.data ?? []).slice(0, 8)
  if (list.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Zuletzt gekauft</h2>
      <ul className="glass divide-y divide-white/5 rounded-2xl">
        {list.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            {b.pro ? <Crown size={18} className="shrink-0 text-amber-300" aria-hidden /> : <Sparkles size={18} className="shrink-0 text-fuchsia-300" aria-hidden />}
            <span className="flex-1 text-slate-200">{buyJoke(b)}</span>
            <span className="shrink-0 text-xs text-slate-500">{ago(b.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
