import { useState } from 'react'
import Button from '../ui/Button'
import { TextArea } from '../ui/Field'
import Modal from '../ui/Modal'
import { ErrorBox } from '../ui/States'
import { errorMessage } from '../../lib/errors'
import { requestReview } from '../../services/community'

export interface ReportEntry { vocabulary_id: string; german: string; german_alts: string[]; translations: string[] }

/** Meldet eine Vokabel eines Online-Buchs zur Prüfung (aus der Seitenansicht und aus der Suche). */
export default function ReportModal({ entry, onClose, onSent }: { entry: ReportEntry; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      await requestReview(entry.vocabulary_id, message)
      onSent()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Überprüfung anfordern" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-xl border border-white/10 bg-space-900/60 p-3 text-sm">
          <strong>{entry.translations.join(' · ')}</strong>
          <span className="text-slate-400"> = </span>
          {[entry.german, ...entry.german_alts].join(' · ')}
        </p>
        <label className="block space-y-1.5">
          <span className="label-mono">Was stimmt nicht? (optional)</span>
          <TextArea maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Tippfehler, falsche Übersetzung, fehlende Lösung …" />
        </label>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button busy={busy} onClick={() => void send()}>Anfrage senden</Button>
        </div>
      </div>
    </Modal>
  )
}
