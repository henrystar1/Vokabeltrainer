import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import { Notice } from '../../components/ui/States'
import { formatDate } from '../../lib/format'
import { usePlus } from './PlusProvider'
import PlusTiers from './PlusTiers'
import { plusPerks } from './perks'

/** Fenster „Vokabeltrainer +“ (z. B. beim Antippen eines Schlosses): Vorteile und Stufen zum Kaufen. */
export default function PlusDialog({ onClose }: { onClose: () => void }) {
  const { status } = usePlus()
  return (
    <Modal title="Vokabeltrainer +" onClose={onClose} wide>
      {!status ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : (
        <div className="space-y-4">
          <div className="plus-banner flex items-center gap-3 rounded-2xl p-4">
            <Sparkles size={26} className="shrink-0" />
            <div>
              <p className="font-semibold">{status.active ? 'Du hast Plus' : 'Mehr aus dem Vokabeltrainer machen'}</p>
              {status.active && <p className="text-sm opacity-80">{status.is_admin ? 'Als Admin immer aktiv.' : status.lifetime ? 'Für immer.' : `Gilt bis ${formatDate(status.until)}.`}</p>}
            </div>
          </div>
          <ul className="grid gap-x-4 gap-y-1.5 text-sm text-slate-300 sm:grid-cols-2">
            {plusPerks(status).slice(0, 8).map((p) => (
              <li key={p.title} className="flex gap-2"><span aria-hidden>{p.icon}</span><span><b className="font-medium text-slate-100">{p.title}</b></span></li>
            ))}
          </ul>
          <PlusTiers status={status} />
          {status.ai_state !== 'ok' && status.ai_enabled && (
            <Notice tone="warn">
              {status.ai_state === 'no_key' ? 'Hinweis: Die KI ist gerade nicht verfügbar, weil noch kein Schlüssel hinterlegt ist.' : status.ai_state === 'empty' ? 'Hinweis: Die KI ist gerade nicht verfügbar, weil das Guthaben leer ist.' : 'Hinweis: Die KI hatte zuletzt einen Fehler.'}
            </Notice>
          )}
          <p className="text-right text-sm"><Link to="/plus" onClick={onClose} className="text-accent-cyan hover:underline">Alle Vorteile ansehen →</Link></p>
        </div>
      )}
    </Modal>
  )
}
