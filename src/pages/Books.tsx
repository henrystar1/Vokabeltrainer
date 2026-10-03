import { useState, type FormEvent, type ReactNode } from 'react'
import CoinIcon from '../components/ui/CoinIcon'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Brain, Check, Globe, Plus, Upload, UserRound } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextArea, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import type { PublicBook } from '../types'
import { useAsync } from '../lib/useAsync'
import { createBook, listBooks, listLanguages } from '../services/books'
import { addToLibrary, listPublicBooks, removeFromLibrary } from '../services/community'
import { useWallet } from '../features/koins/WalletProvider'
import { useSettings } from '../features/settings/SettingsProvider'

type Tab = 'mine' | 'online'

export default function Books() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'online' ? 'online' : 'mine'
  const books = useAsync(listBooks, [])
  const online = useAsync(listPublicBooks, [])
  const languages = useAsync(listLanguages, [])
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [buying, setBuying] = useState<PublicBook | null>(null)
  const wallet = useWallet()
  const navigate = useNavigate()
  const langName = (code: string) => languages.data?.find((l) => l.code === code)?.name ?? code

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id)
    setActionError(null)
    try {
      await fn()
      books.reload()
      online.reload()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const tabButton = (t: Tab, label: string, icon: ReactNode, count?: number) => (
    <button
      type="button"
      onClick={() => setParams(t === 'mine' ? {} : { tab: t })}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
        tab === t ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
      }`}
    >
      {icon} {label}
      {count !== undefined && <span className="font-mono text-xs opacity-70">{count}</span>}
    </button>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Bibliothek"
        title="Bücher"
        actions={
          <>
            <Link to="/buecher/import" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 font-medium hover:bg-white/10">
              <Upload size={16} /> Import
            </Link>
            <Button onClick={() => setCreating(true)}>
              <Plus size={18} /> Neues Buch
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {tabButton('mine', 'Meine Bücher', <UserRound size={16} />, books.data?.length)}
        {tabButton('online', 'Online', <Globe size={16} />, online.data?.length)}
      </div>

      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}

      {tab === 'mine' && (
        <>
          {books.loading && !books.data && <Spinner />}
          {books.error && <ErrorBox message={books.error} onRetry={books.reload} />}
          {books.data && books.data.length === 0 && (
            <EmptyState
              title="Noch kein Buch"
              text="Lege dein erstes Schulbuch an, trage die Vokabeln Seite für Seite ein – oder nutze ein Buch aus dem Bereich „Online“."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setCreating(true)}>Erstes Buch anlegen</Button>
                  <Button variant="secondary" onClick={() => setParams({ tab: 'online' })}>Online-Bücher ansehen</Button>
                </div>
              }
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {books.data?.map((b) => (
              <Card key={b.id} interactive className="flex flex-col">
                <Link to={`/buecher/${b.id}`} className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <BookOpen className="text-accent-violet" size={24} />
                    <span className="flex items-center gap-2">
                      {b.is_public && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-accent-cyan/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-cyan">
                          <Globe size={10} /> Online
                        </span>
                      )}
                      <span className="label-mono">{langName(b.language)}</span>
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-semibold">{b.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {b.vocab_count} Vokabeln · {b.unit_count} Units · {b.page_count} Seiten
                  </p>
                  <p className={`mt-1 text-xs ${b.active_count === 0 && b.vocab_count > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                    {b.active_count} von {b.vocab_count} Vokabeln aktiv
                    {b.active_count === 0 && b.vocab_count > 0 && ' – im Buch aktivieren, um zu lernen'}
                  </p>
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Gelernt</span>
                      <span className="font-mono text-accent-cyan">{Math.round(b.mastery_percent)}%</span>
                    </div>
                    <ProgressBar value={b.mastery_percent} label={`Fortschritt ${b.name}`} />
                  </div>
                </Link>
                <Link to={`/lernen?buch=${b.id}`} className="btn-primary mt-5 w-full">
                  <Brain size={18} /> Lernen
                </Link>
                {b.is_public && !b.is_mine && (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => void run(b.id, () => removeFromLibrary(b.id))}
                    className="mt-2 min-h-[36px] text-xs text-slate-500 hover:text-rose-300"
                  >
                    Aus meinen Büchern entfernen (Fortschritt bleibt erhalten)
                  </button>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === 'online' && (
        <>
          <p className="mb-4 max-w-2xl text-sm text-slate-400">
            Diese Bücher haben Admins und Mods für alle bereitgestellt. Die Vokabeln sind fest vorgegeben, dein Lernfortschritt
            gehört dir allein. Fehler kannst du bei einzelnen Vokabeln zur Prüfung melden.
          </p>
          {online.loading && !online.data && <Spinner />}
          {online.error && <ErrorBox message={online.error} onRetry={online.reload} />}
          {online.data && online.data.length === 0 && (
            <EmptyState title="Noch keine Online-Bücher" text="Sobald ein Admin oder Mod ein Buch veröffentlicht, erscheint es hier." />
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {online.data?.map((b) => (
              <Card key={b.id} className="flex flex-col">
                <Link to={`/buecher/${b.id}`} className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <Globe className="text-accent-cyan" size={24} />
                    <span className="label-mono">{langName(b.language)}</span>
                  </div>
                  <h2 className="mt-4 text-xl font-semibold">{b.name}</h2>
                  {b.description && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{b.description}</p>}
                  <p className="mt-1 text-sm text-slate-400">
                    {b.vocab_count} Vokabeln · {b.unit_count} Units · {b.page_count} Seiten
                  </p>
                  {b.published_by_name && <p className="mt-1 text-xs text-slate-500">Bereitgestellt von {b.published_by_name}</p>}
                </Link>
                {b.in_library ? (
                  <div className="mt-5 flex items-center gap-2">
                    <span className="inline-flex min-h-[44px] items-center gap-1 text-sm text-emerald-300">
                      <Check size={16} /> In meinen Büchern
                    </span>
                    <Link to={`/lernen?buch=${b.id}`} className="btn-primary ml-auto">
                      <Brain size={18} /> Lernen
                    </Link>
                  </div>
                ) : (
                  <Button className="mt-5 w-full" busy={busyId === b.id} onClick={() => setBuying(b)}>
                    {b.price > 0 && !b.purchased ? (
                      <>
                        <CoinIcon size={18} /> Kaufen · {b.price} Coins
                      </>
                    ) : (
                      <>
                        <Plus size={18} /> Dieses Buch verwenden
                      </>
                    )}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {buying && (
        <Modal title={buying.price > 0 && !buying.purchased ? 'Buch kaufen?' : 'Buch verwenden?'} onClose={() => setBuying(null)}>
          {buying.price > 0 && !buying.purchased ? (
            <p className="text-sm text-slate-300">
              „{buying.name}“ kostet <b>{buying.price} Coins</b>. Du hast {wallet.balance} Coins.
              {wallet.balance < buying.price && <span className="mt-2 block text-amber-300">Dir fehlen noch {buying.price - wallet.balance} Coins – z. B. mit einem Code oder durch Lernen.</span>}
            </p>
          ) : (
            <p className="text-sm text-slate-300">„{buying.name}“ ist für dich kostenlos. Danach aktivierst du die Vokabeln, die du lernen willst.</p>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setBuying(null)}>Abbrechen</Button>
            <Button
              busy={busyId === buying.id}
              disabled={buying.price > 0 && !buying.purchased && wallet.balance < buying.price}
              onClick={() => {
                const b = buying
                setBuying(null)
                void run(b.id, async () => {
                  await addToLibrary(b.id)
                  await wallet.refresh()
                  navigate(`/buecher/${b.id}`)
                })
              }}
            >
              {buying.price > 0 && !buying.purchased ? 'Jetzt kaufen' : 'Verwenden'}
            </Button>
          </div>
        </Modal>
      )}

      {creating && <CreateBookModal onClose={() => setCreating(false)} languages={languages.data ?? []} />}
    </div>
  )
}

function CreateBookModal({ onClose, languages }: { onClose: () => void; languages: { code: string; name: string }[] }) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState(settings.learn_language)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() === '') return setError('Bitte einen Namen eingeben.')
    setBusy(true)
    setError(null)
    try {
      const id = await createBook(name, language, description)
      navigate(`/buecher/${id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Neues Buch" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Green Line 3" />
        </Field>
        <Field label="Sprache">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Beschreibung (optional)">
          <TextArea maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" busy={busy}>
            Anlegen
          </Button>
        </div>
      </form>
    </Modal>
  )
}
