import { useMemo, useState } from 'react'
import { accentsFor } from '../components/ui/AccentBar'
import { BookMarked, Check, History, Lock, Printer, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import GapSheet from '../components/sheet/GapSheet'
import SavedResult from '../components/sheet/SavedResult'
import { useSettings } from '../features/settings/SettingsProvider'
import { usePlus } from '../features/plus/PlusProvider'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { gradeSheet, topicKey, toSaved, type GapItem, type SheetGrade } from '../lib/gaps'
import { GRADE_WORD, gradeFromScore, percentOf } from '../lib/grade'
import { useAsync } from '../lib/useAsync'
import { aiFailText, deleteResult, generateGrammar, getResult, getSet, LEVELS, listSets, myResults, saveResult, TOPICS, isLang, LANG_NAMES, type Lang, type Level, type StoredResult } from '../services/ai'

type View = 'practice' | 'history'
interface Sheet { id: string | null; title: string; items: GapItem[]; language: Lang; level: Level }

const CUSTOM = '__custom'
const LEVEL_TEXT: Record<Level, string> = { einfach: 'Einfach: kurze Sätze, Hinweis in Klammern', mittel: 'Mittel: normale Sätze, nur Grundform als Hinweis', schwer: 'Schwer: lange Sätze, kaum Hinweise' }

export default function Grammar() {
  const { settings } = useSettings()
  const plus = usePlus()
  const [view, setView] = useState<View>('practice')
  const [language, setLanguage] = useState<Lang>(isLang(settings.learn_language) ? settings.learn_language : 'en')
  const [grade, setGrade] = useState(7)
  const [preset, setPreset] = useState(TOPICS[language][0])
  const [custom, setCustom] = useState('')
  const [level, setLevel] = useState<Level>('mittel')
  const [count, setCount] = useState(8)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [given, setGiven] = useState<string[][]>([])
  const [result, setResult] = useState<SheetGrade | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const topic = (preset === CUSTOM ? custom : preset).trim()
  const key = topicKey(topic)
  const active = plus.active
  const maxItems = plus.status?.max_items ?? 15

  const stored = useAsync(
    () => (active && key ? listSets(language, grade, key, level) : Promise.resolve([])),
    [active, language, grade, key, level],
  )

  function openSheet(s: Sheet) {
    setSheet(s)
    setGiven(s.items.map((it) => it.answers.map(() => '')))
    setResult(null)
    setSaveError(null)
    setError(null)
    window.scrollTo({ top: 0 })
  }

  async function generate() {
    if (!active) { plus.openDialog(); return }
    setBusy(true)
    setError(null)
    try {
      const r = await generateGrammar({ language, grade, topic, level, count: Math.min(count, maxItems) })
      if (!r.ok) {
        if (r.code === 'no_plus') plus.openDialog()
        setError(aiFailText(r))
        void plus.reload()
        return
      }
      openSheet({ id: r.id, title: r.title, items: r.items, language, level })
      stored.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function openStored(id: string) {
    setBusy(true)
    setError(null)
    try {
      const s = await getSet(id)
      openSheet({ id: s.id, title: s.title, items: s.items, language: s.language, level: s.level })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!sheet) return
    const g = gradeSheet(sheet.items, given)
    setResult(g)
    setSaveError(null)
    try {
      await saveResult({
        kind: 'grammar', title: sheet.title, ref: sheet.id, language: sheet.language, level: sheet.level,
        score: g.correct, total: g.total, payload: { items: toSaved(sheet.items, given, g) },
      })
      history.reload()
    } catch (e) {
      setSaveError(errorMessage(e))
    }
  }

  const history = useAsync(() => (active ? myResults('grammar') : Promise.resolve([])), [active])
  const [opened, setOpened] = useState<StoredResult | null>(null)

  const filled = useMemo(() => given.reduce((s, g) => s + g.filter((x) => x.trim() !== '').length, 0), [given])
  const total = useMemo(() => (sheet ? sheet.items.reduce((s, it) => s + it.answers.length, 0) : 0), [sheet])

  // ---------- Blatt ----------
  if (sheet) {
    const note = result ? gradeFromScore(result.correct, result.total) : null
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Grammatik" title={sheet.title} actions={<Button variant="ghost" className="no-print" onClick={() => setSheet(null)}>Zurück</Button>} />
        {result && note !== null && (
          <Card className="no-print flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="label-mono">Ergebnis</p>
              <p className="text-2xl font-semibold">{result.correct} von {result.total} richtig · {percentOf(result.correct, result.total)} %</p>
              <p className="text-sm text-slate-400">Grün ist richtig, bei Rot steht darunter die Lösung.</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-5xl text-accent-cyan">{note}</p>
              <p className="text-xs text-slate-400">{GRADE_WORD[note]}</p>
            </div>
          </Card>
        )}
        {saveError && <ErrorBox message={`Das Ergebnis konnte nicht gespeichert werden: ${saveError}`} />}
        <GapSheet
          items={sheet.items}
          given={given}
          grade={result}
          accents={accentsFor(sheet.language)}
          title={sheet.title}
          subtitle={`${LANG_NAMES[sheet.language]} · ${sheet.level}`}
          onChange={(i, k, v) => setGiven((g) => g.map((row, ri) => (ri === i ? row.map((x, ci) => (ci === k ? v : x)) : row)))}
        />
        <div className="no-print flex flex-wrap gap-3">
          {!result ? (
            <Button onClick={() => void submit()} disabled={filled === 0}><Check size={18} /> Abgeben ({filled}/{total})</Button>
          ) : (
            <>
              <Button onClick={() => openSheet(sheet)}><RotateCcw size={16} /> Nochmal</Button>
              <Button variant="secondary" onClick={() => setSheet(null)}><Sparkles size={16} /> Neues Thema</Button>
            </>
          )}
          <Button variant="ghost" onClick={() => window.print()}><Printer size={16} /> Drucken</Button>
        </div>
      </div>
    )
  }

  // ---------- Übersicht ----------
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Vokabeltrainer +" title="Grammatik" />
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {([['practice', 'Üben', Sparkles], ['history', 'Meine Ergebnisse', History]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setOpened(null) }}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${view === id ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {view === 'practice' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sprache">
                <Select value={language} onChange={(e) => { const l = e.target.value as Lang; setLanguage(l); setPreset(TOPICS[l][0]) }}>
                  {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
                </Select>
              </Field>
              <Field label="Klasse">
                <Select value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
                  {Array.from({ length: 9 }, (_, i) => i + 5).map((g) => <option key={g} value={g}>Klasse {g}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Thema">
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {TOPICS[language].map((t) => <option key={t} value={t}>{t}</option>)}
                <option value={CUSTOM}>Eigenes Thema …</option>
              </Select>
            </Field>
            {preset === CUSTOM && (
              <Field label="Eigenes Thema" hint="Nur ein Stichwort, z. B. „Bedingungssätze Typ 3“.">
                <TextInput value={custom} maxLength={60} onChange={(e) => setCustom(e.target.value)} />
              </Field>
            )}
            <Field label="Schwierigkeit" hint={LEVEL_TEXT[level]}>
              <div className="grid grid-cols-3 gap-2" role="group">
                {LEVELS.map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
                    className={`min-h-[44px] rounded-xl border text-sm capitalize transition ${level === l ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label={`Anzahl Sätze: ${Math.min(count, maxItems)}`}>
              <input type="range" min={3} max={Math.max(3, maxItems)} value={Math.min(count, maxItems)} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-cyan-400" />
            </Field>
            {error && <ErrorBox message={error} />}
            {active && plus.status && plus.status.ai_state !== 'ok' && (
              <Notice tone="warn">
                {plus.status.ai_state === 'no_key' ? 'Neue Blätter gehen gerade nicht: Es ist noch kein KI-Schlüssel hinterlegt.' : plus.status.ai_state === 'empty' ? 'Neue Blätter gehen gerade nicht: Das KI-Guthaben ist leer.' : 'Die KI hatte zuletzt einen Fehler. Du kannst es trotzdem versuchen.'} Gespeicherte Blätter kannst du weiter üben.
              </Notice>
            )}
            <Button className="w-full min-h-[52px]" busy={busy} disabled={topic.length < 2} onClick={() => void generate()}>
              {active ? <Sparkles size={18} /> : <Lock size={18} />} {active ? 'Neues Blatt erzeugen' : 'Blatt erzeugen (mit Plus)'}
            </Button>
            {!active && <p className="text-xs text-slate-400">Das Erzeugen ist Teil von Vokabeltrainer +. Tippe auf den Knopf, um Plus anzufordern.</p>}
          </Card>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><BookMarked size={18} /> Schon vorhandene Blätter</h2>
            {!active && <Notice tone="info">Mit Plus kannst du alle bereits erzeugten Blätter zu deinem Thema ansehen und üben. Das ist schneller und spart KI-Kosten.</Notice>}
            {active && stored.loading && !stored.data && <Spinner />}
            {stored.error && <ErrorBox message={stored.error} onRetry={stored.reload} />}
            {active && stored.data?.length === 0 && <EmptyState title="Noch kein Blatt" text="Zu dieser Kombination gibt es noch nichts. Erzeuge das erste Blatt." />}
            <ul className="space-y-2">
              {stored.data?.map((s) => (
                <li key={s.id}>
                  <button type="button" disabled={busy} onClick={() => void openStored(s.id)} className="glass flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl p-3 text-left transition hover:bg-white/10">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="block text-xs text-slate-500">{s.items} Sätze · {s.uses}× geübt · {formatDateTime(s.created_at)}{s.mine ? ' · von dir' : ''}</span>
                    </span>
                    <span className="shrink-0 text-sm text-accent-cyan">Üben</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {view === 'history' && (
        <div className="space-y-3">
          {!active && <Notice tone="info">Deine Ergebnisse siehst du mit Vokabeltrainer +.</Notice>}
          {opened ? (
            <>
              <Button variant="ghost" className="no-print" onClick={() => setOpened(null)}>← Alle Ergebnisse</Button>
              <SavedResult result={opened} />
            </>
          ) : (
            <>
              {history.loading && !history.data && active && <Spinner />}
              {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
              {active && history.data?.length === 0 && <EmptyState title="Noch nichts gespeichert" text="Gib ein Blatt ab, dann erscheint es hier mit deinen Antworten." />}
              <ul className="space-y-2">
                {history.data?.map((r) => (
                  <li key={r.id} className="glass flex items-center gap-2 rounded-2xl p-2">
                    <button type="button" className="flex min-h-[52px] min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 text-left hover:bg-white/5"
                      onClick={() => void getResult(r.id).then(setOpened).catch((e) => setError(errorMessage(e)))}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.title}</span>
                        <span className="block text-xs text-slate-500">{formatDateTime(r.created_at)} · {r.score}/{r.total}</span>
                      </span>
                      <span className="font-mono text-2xl text-accent-cyan">{gradeFromScore(r.score, r.total)}</span>
                    </button>
                    <button type="button" aria-label="Löschen" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-rose-300"
                      onClick={() => { if (window.confirm('Dieses Ergebnis löschen?')) void deleteResult(r.id).then(history.reload).catch((e) => setError(errorMessage(e))) }}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              {error && <ErrorBox message={error} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}
