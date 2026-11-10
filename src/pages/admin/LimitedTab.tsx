import { ErrorBox, Spinner } from '../../components/ui/States'
import { useAsync } from '../../lib/useAsync'
import { adminLimitedOverview } from '../../services/koins'

/** Admin: wem gehören die limitierten Artikel (inkl. Update 100) und was wird gerade angeboten. */
export default function LimitedTab() {
  const data = useAsync(adminLimitedOverview, [])
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-400">Alle limitierten Artikel mit den Personen, die sie besitzen (nach Zeitpunkt sortiert). „im Handel" heißt: die Person bietet ihn gerade an.</p>
      {data.loading && !data.data && <Spinner />}
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.data?.map((it) => (
          <section key={it.item_id} className="glass rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{it.name}</h2>
              <span className="text-xs text-slate-400">{it.holders.length} von {it.limited} vergeben · {it.source === 'advent' ? 'nur Adventskalender' : it.source === 'both' ? 'Shop + Advent' : 'Shop'}</span>
            </div>
            {it.holders.length === 0 ? <p className="mt-2 text-sm text-slate-500">Noch niemand.</p> : (
              <ol className="mt-2 space-y-1 text-sm">
                {it.holders.map((h, i) => (
                  <li key={h.user_id} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-slate-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{h.name}</span>
                    {h.listed_price != null && <span className="rounded-full border border-amber-300/40 px-2 text-[10px] text-amber-200">im Handel: {h.listed_price.toLocaleString('de-DE')}</span>}
                    <span className="text-xs text-slate-500">{new Date(h.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
