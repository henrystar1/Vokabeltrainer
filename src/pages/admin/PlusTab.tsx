import { useState } from 'react'
import { KeyRound, RefreshCw, Undo2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import { TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDate, formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { checkAiKey } from '../../services/ai'
import { adminPlusGetSettings, adminPlusGrant, adminPlusOverview, adminPlusReject, adminPlusRevoke, adminPlusUndoSale, euro, type PlusRequestRow } from '../../services/plus'

const KIND: Record<string, string> = { paid: 'bezahlt', gift: 'Geschenk', coins: 'Coins' }

/** Anfragen, aktive Plus-Nutzer, Verkäufe und Zustand der KI. */
export default function PlusTab() {
  const ov = useAsync(adminPlusOverview, [])
  const settings = useAsync(adminPlusGetSettings, [])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(null)
    setInfo(null)
    try {
      await fn()
      if (ok) setInfo(ok)
      ov.reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function check() {
    setChecking(true)
    setError(null)
    const r = await checkAiKey()
    setInfo(r.ok ? r.message : null)
    if (!r.ok) setError(r.message)
    setChecking(false)
    ov.reload()
  }

  if (ov.loading && !ov.data) return <Spinner />
  if (ov.error) return <ErrorBox message={ov.error} onRetry={ov.reload} />
  const d = ov.data!
  const def = (k: string) => Number(settings.data?.find((s) => s.key === k)?.value ?? 0)
  const state = d.ai.state

  return (
    <div className="space-y-6">
      {state !== 'ok' && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-100">
          <p className="flex items-center gap-2 font-semibold"><KeyRound size={18} />
            {state === 'no_key' ? 'Kein OpenAI-Schlüssel hinterlegt' : state === 'empty' ? 'OpenAI-Guthaben ist leer' : 'Die KI hatte zuletzt einen Fehler'}
          </p>
          <p className="mt-1 text-sm">Die Nutzer sehen die Meldung „KI gerade nicht verfügbar“. {d.ai.message}</p>
          <p className="mt-1 text-xs opacity-80">
            {state === 'no_key' ? 'Hinterlege in Supabase unter Edge Functions → Secrets den Eintrag OPENAI_API_KEY und starte danach „Schlüssel prüfen“.' : 'Lade im OpenAI-Konto Guthaben auf und starte danach „Schlüssel prüfen“.'}
          </p>
        </div>
      )}
      <section className="glass space-y-3 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">KI diesen Monat</h2>
          <Button variant="secondary" busy={checking} onClick={() => void check()}><RefreshCw size={16} /> Schlüssel prüfen</Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ['Kosten', `${d.ai.month_cost_cents.toFixed(2).replace('.', ',')} ct`],
            ['Erzeugungen', String(d.ai.month_generations)],
            ['Tokens', d.ai.month_tokens.toLocaleString('de-DE')],
            ['Gespeichert', `${d.ai.sets} Blätter · ${d.ai.sentences} Sätze`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-mono text-slate-100">{v}</dd></div>
          ))}
        </dl>
        <p className="text-xs text-slate-500">Status: {state === 'ok' ? 'in Ordnung' : state} · zuletzt geändert {formatDateTime(d.ai.updated_at)}. Die Kosten werden vom Verdienst im Pro-Abo-Balken abgezogen.</p>
      </section>

      {info && <Notice tone="ok">{info}</Notice>}
      {error && <ErrorBox message={error} />}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Anfragen <span className="font-mono text-fuchsia-300">{d.requests.length}</span></h2>
        {d.requests.length === 0 && <p className="text-sm text-slate-500">Keine offenen Anfragen.</p>}
        {d.requests.map((r) => (
          <Request key={r.user_id} r={r} days={def('plus_days')} price={def('plus_price_eur')}
            onGrant={(days, cents) => act(() => adminPlusGrant(r.user_id, days, cents, ''), `Plus für ${r.name} vergeben.`)}
            onReject={() => act(() => adminPlusReject(r.user_id, ''), 'Anfrage abgelehnt.')} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Aktiv <span className="font-mono text-fuchsia-300">{d.active.length}</span></h2>
        {d.active.length === 0 && <p className="text-sm text-slate-500">Niemand hat gerade Plus.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.active.map((a) => (
            <li key={a.user_id} className="glass flex items-center justify-between gap-2 rounded-xl p-3 text-sm">
              <span><span className="font-medium">{a.name}</span> <span className="text-xs text-slate-500">bis {formatDate(a.until)}</span></span>
              <Button variant="ghost" className="!min-h-[36px] !px-2 text-xs" onClick={() => { if (window.confirm(`Plus von ${a.name} beenden?`)) void act(() => adminPlusRevoke(a.user_id), 'Plus beendet.') }}>Entziehen</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Zuletzt vergeben</h2>
        <p className="text-xs text-slate-500">Aus Versehen bestätigt? „Rückgängig“ nimmt die Tage zurück und rechnet den Betrag aus dem Pro-Abo-Balken heraus (bei Coin-Tagen gibt es die Coins zurück).</p>
        <ul className="space-y-1">
          {d.sales.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{s.name}</span> · {s.days} Tage · {KIND[s.kind] ?? s.kind}{s.cents > 0 ? ` · ${euro(s.cents)}` : ''}
                <span className="block text-xs text-slate-500">{formatDateTime(s.created_at)}{s.note ? ` · ${s.note}` : ''}</span>
              </span>
              <Button variant="ghost" className="!min-h-[36px] !px-2 text-xs" onClick={() => { if (window.confirm(`Diese Vergabe an ${s.name} rückgängig machen?`)) void act(() => adminPlusUndoSale(s.id), 'Rückgängig gemacht.') }}><Undo2 size={14} /> Rückgängig</Button>
            </li>
          ))}
          {d.sales.length === 0 && <p className="text-sm text-slate-500">Noch nichts.</p>}
        </ul>
      </section>
    </div>
  )
}

function Request({ r, days, price, onGrant, onReject }: { r: PlusRequestRow; days: number; price: number; onGrant: (days: number, cents: number) => void; onReject: () => void }) {
  const [d, setD] = useState(String(days || 30))
  const [p, setP] = useState(String(price).replace('.', ','))
  const dn = Number.parseInt(d, 10)
  const cents = Math.round(Number(p.replace(',', '.')) * 100)
  const ok = Number.isInteger(dn) && dn >= 1 && dn <= 365 && Number.isFinite(cents) && cents >= 0
  return (
    <div className="glass flex flex-wrap items-end gap-3 rounded-2xl p-4">
      <div className="min-w-[10rem] flex-1">
        <p className="font-medium">{r.name}</p>
        <p className="text-xs text-slate-500">angefragt {formatDateTime(r.created_at)}{r.plus_until ? ` · hatte Plus bis ${formatDate(r.plus_until)}` : ''}</p>
      </div>
      <label className="space-y-1 text-xs text-slate-400">Tage<TextInput className="!min-h-[40px] w-20" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} /></label>
      <label className="space-y-1 text-xs text-slate-400">Bezahlt €<TextInput className="!min-h-[40px] w-24" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></label>
      <Button disabled={!ok} className="!min-h-[40px]" onClick={() => { if (window.confirm(`Plus für ${r.name}: ${dn} Tage, ${(cents / 100).toFixed(2).replace('.', ',')} € bezahlt?`)) onGrant(dn, cents) }}>Freischalten</Button>
      <Button variant="ghost" className="!min-h-[40px]" onClick={onReject}>Ablehnen</Button>
    </div>
  )
}
