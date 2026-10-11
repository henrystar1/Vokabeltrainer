import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ImagePlus, Trash2, UploadCloud } from 'lucide-react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { Field, TextArea, TextInput } from '../../components/ui/Field'
import { Notice } from '../../components/ui/States'
import StlViewer from '../../components/print/StlViewer'
import { ColorSwatches, OptionCard, QuoteBox, Stepper, useStlMesh } from '../../components/print/parts'
import { useWallet } from '../../features/koins/WalletProvider'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { resizeImage } from '../../lib/image'
import { euro, parseEuroToCents } from '../../lib/printShop'
import {
  createPrintOrder, getPrintQuote, newFilePath, removePrintFiles, uploadPrintFile, type PrintInfo, type PrintQuote,
} from '../../services/printShop'

const MAX_STL_MB = 25
const MAX_PHOTOS = 5

/** Eigene Anfrage: STL hochladen (mit Vorschau und Richtpreis) und/oder ein Teil mit Fotos beschreiben. */
export default function RequestTab({ info, onOrdered, onShowOrders }: { info: PrintInfo; onOrdered: () => void; onShowOrders: () => void }) {
  const { user } = useAuth()
  const wallet = useWallet()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [stl, setStl] = useState<File | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [color, setColor] = useState<string | null>(info.colors[0]?.id ?? null)
  const [qty, setQty] = useState(1)
  const [offer, setOffer] = useState('')
  const [rush, setRush] = useState(false)
  const [discount, setDiscount] = useState(false)
  const [quote, setQuote] = useState<PrintQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [drag, setDrag] = useState(false)
  const stlInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const { mesh, loading: meshLoading, error: meshError } = useStlMesh(stl)
  const volumeCm3 = mesh ? Math.round((mesh.volumeMm3 / 1000) * 100) / 100 : null
  const tooBig = volumeCm3 != null && volumeCm3 > info.max_volume_cm3
  const chosen = info.colors.find((c) => c.id === color)
  const offerCents = offer.trim() === '' ? null : parseEuroToCents(offer)
  const offerInvalid = offer.trim() !== '' && offerCents == null
  const canAffordDiscount = wallet.balance >= info.discount_coins
  const blocked = !info.open || info.banned
  const photoUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls])

  // Richtpreis, sobald ein Modell geladen ist
  useEffect(() => {
    if (!volumeCm3 || tooBig || (info.colors.length > 0 && !color)) { setQuote(null); setQuoteError(null); return }
    let alive = true
    setQuoting(true)
    const t = window.setTimeout(() => {
      getPrintQuote({ kind: 'custom', product: null, volume: volumeCm3, color, qty, rush, discount }).then(
        (q) => { if (alive) { setQuote(q); setQuoteError(null); setQuoting(false) } },
        (e) => { if (alive) { setQuote(null); setQuoteError(errorMessage(e)); setQuoting(false) } },
      )
    }, 150)
    return () => { alive = false; window.clearTimeout(t) }
  }, [volumeCm3, tooBig, color, qty, rush, discount, info.colors.length])

  function pickStl(f: File | undefined | null) {
    if (!f) return
    setError(null)
    if (!/\.stl$/i.test(f.name)) { setError('Bitte eine STL-Datei wählen.'); return }
    if (f.size > MAX_STL_MB * 1024 * 1024) { setError(`Die Datei ist größer als ${MAX_STL_MB} MB.`); return }
    setStl(f)
  }

  function addPhotos(files: FileList | null) {
    if (!files) return
    const ok = [...files].filter((f) => f.type.startsWith('image/'))
    setPhotos((p) => [...p, ...ok].slice(0, MAX_PHOTOS))
    if (photoInput.current) photoInput.current.value = ''
  }

  const titleOk = title.trim().length >= 3
  const descOk = description.trim().length >= 10
  const canSend = !blocked && titleOk && descOk && !offerInvalid && !tooBig && !meshLoading && !(stl && meshError) && (info.colors.length === 0 || !!color)

  async function send() {
    if (!user) return
    setBusy(true)
    setError(null)
    const uploaded: string[] = []
    try {
      let uploadPath: string | null = null
      if (stl) {
        uploadPath = newFilePath(user.id, 'stl')
        await uploadPrintFile(uploadPath, stl)
        uploaded.push(uploadPath)
      }
      const photoPaths: string[] = []
      for (const p of photos) {
        const path = newFilePath(user.id, 'jpg')
        await uploadPrintFile(path, await resizeImage(p))
        uploaded.push(path)
        photoPaths.push(path)
      }
      await createPrintOrder({
        kind: 'custom', product: null, color, qty, rush, discount,
        volume: stl && volumeCm3 ? volumeCm3 : null,
        customText: null, title: title.trim(), description: description.trim(), uploadPath, photoPaths,
        dims: stl && mesh ? { x: round1(mesh.size.x), y: round1(mesh.size.y), z: round1(mesh.size.z) } : null,
        offerCents: offerCents,
      })
      await wallet.refresh()
      onOrdered()
      setDone(true)
    } catch (e) {
      // Hochgeladene Dateien wieder entfernen (sie gehören noch zu keiner Bestellung).
      await removePrintFiles(uploaded).catch(() => undefined)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setTitle(''); setDescription(''); setStl(null); setPhotos([]); setQty(1); setOffer(''); setRush(false); setDiscount(false); setDone(false); setError(null)
  }

  if (done) {
    return (
      <div className="glass mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl p-8 text-center">
        <CheckCircle2 size={48} className="text-emerald-400" />
        <p className="text-lg font-semibold">Anfrage gesendet!</p>
        <p className="text-sm text-slate-400">Ich schaue sie mir an und melde mich mit einem Preis oder einer Rückfrage. Den Stand siehst du unter „Meine Bestellungen“.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={onShowOrders}>Meine Bestellungen</Button>
          <Button variant="ghost" onClick={reset}>Noch eine Anfrage</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="glass space-y-4 rounded-2xl p-5">
          <Field label="Was brauchst du?" hint="Zum Beispiel „Halter für mein Handy“ oder „Zahnrad für RC-Auto“.">
            <TextInput value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Kurzer Titel" />
          </Field>
          <Field label="Beschreibung" hint="Je genauer, desto besser: Maße, wofür es ist, was kaputt gegangen ist … Fotos helfen sehr.">
            <TextArea value={description} maxLength={1000} rows={5} onChange={(e) => setDescription(e.target.value)} placeholder="Bei meinem ferngesteuerten Auto ist … kaputt gegangen. Auf den Bildern siehst du das Teil. Es ist ca. … mm lang." />
          </Field>
          <p className="text-right text-[11px] text-slate-500">{description.length} / 1000</p>
        </div>

        <div className="glass space-y-3 rounded-2xl p-5">
          <p className="label-mono">Modell (STL, optional)</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pickStl(e.dataTransfer.files[0]) }}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition ${drag ? 'border-accent-cyan bg-accent-cyan/5' : 'border-white/15 bg-white/[0.02]'}`}
          >
            <UploadCloud size={30} className="text-slate-500" />
            {stl ? (
              <>
                <p className="text-sm font-medium text-slate-100">{stl.name}</p>
                <p className="text-xs text-slate-500">{(stl.size / 1024 / 1024).toFixed(1)} MB</p>
                <Button variant="ghost" onClick={() => { setStl(null); if (stlInput.current) stlInput.current.value = '' }}><Trash2 size={15} /> Entfernen</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-300">STL-Datei hierher ziehen oder</p>
                <Button variant="secondary" onClick={() => stlInput.current?.click()}>Datei wählen</Button>
                <p className="text-xs text-slate-500">Höchstens {MAX_STL_MB} MB. Maße in Millimetern.</p>
              </>
            )}
            <input ref={stlInput} type="file" accept=".stl,model/stl" className="hidden" onChange={(e) => pickStl(e.target.files?.[0])} />
          </div>
          {meshLoading && <p className="text-sm text-slate-400">Datei wird gelesen …</p>}
          {meshError && <Notice tone="warn">{meshError}</Notice>}
          {mesh && (
            <>
              <StlViewer mesh={mesh} color={chosen?.hex ?? '#22d3ee'} className="h-72 w-full" />
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {[
                  ['Breite', `${round1(mesh.size.x)} mm`],
                  ['Tiefe', `${round1(mesh.size.y)} mm`],
                  ['Höhe', `${round1(mesh.size.z)} mm`],
                  ['Volumen', `${volumeCm3?.toLocaleString('de-DE')} cm³`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/5 px-3 py-2"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
              {tooBig && <Notice tone="warn">Das Teil ist größer als erlaubt (höchstens {info.max_volume_cm3.toLocaleString('de-DE')} cm³).</Notice>}
            </>
          )}
        </div>

        <div className="glass space-y-3 rounded-2xl p-5">
          <p className="label-mono">Fotos (optional, bis {MAX_PHOTOS})</p>
          <div className="flex flex-wrap gap-3">
            {photoUrls.map((u, i) => (
              <div key={u} className="group relative h-24 w-24 overflow-hidden rounded-xl border border-white/10">
                <img src={u} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                <button type="button" aria-label="Foto entfernen" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"><Trash2 size={13} /></button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" onClick={() => photoInput.current?.click()} className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/15 text-xs text-slate-400 transition hover:border-accent-cyan/50 hover:text-accent-cyan">
                <ImagePlus size={22} /> Foto
              </button>
            )}
          </div>
          <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        </div>
      </div>

      <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <div className="glass space-y-4 rounded-2xl p-5">
          {info.colors.length > 0 && (
            <div>
              <p className="label-mono mb-2">Farbe</p>
              <ColorSwatches colors={info.colors} value={color} onChange={setColor} />
            </div>
          )}
          <div>
            <p className="label-mono mb-2">Stückzahl</p>
            <Stepper value={qty} max={info.max_qty} onChange={setQty} label="Stückzahl" />
          </div>
          <Field label="Dein Wunschpreis (optional)" hint="Du kannst einen Preis vorschlagen. Ich antworte mit „ja“ oder einem Gegenvorschlag.">
            <TextInput inputMode="decimal" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="z. B. 3,50" aria-invalid={offerInvalid} />
          </Field>
          {offerInvalid && <Notice tone="warn">Bitte einen Betrag wie 3,50 eingeben.</Notice>}
          <div className="space-y-2">
            <OptionCard checked={rush} onChange={setRush} title="Beschleunigt" text="Dein Auftrag kommt in der Warteschlange nach vorn." right={`+${euro(info.rush_cents)}`} />
            {info.discount_percent > 0 && (
              <OptionCard
                checked={discount}
                onChange={setDiscount}
                disabled={!canAffordDiscount && !discount}
                title={`${info.discount_percent} % Rabatt`}
                text={canAffordDiscount ? 'Einmal je Bestellung. Bei Ablehnung oder Abbruch bekommst du die Coins zurück.' : `Dafür fehlen dir noch ${(info.discount_coins - wallet.balance).toLocaleString('de-DE')} Coins.`}
                right={<span className="inline-flex items-center gap-1">{info.discount_coins.toLocaleString('de-DE')} <CoinIcon size={14} /></span>}
              />
            )}
          </div>
        </div>

        <QuoteBox quote={quote} loading={quoting} note={stl ? (quoteError ?? 'Der Richtpreis erscheint, sobald die Datei gelesen ist.') : 'Ohne STL-Datei nenne ich dir den Preis nach deiner Anfrage.'} />
        <p className="text-xs text-slate-500">Der Richtpreis ist unverbindlich. Ich schaue mir alles an und bestätige oder mache einen Gegenvorschlag. Waffen und Waffenteile druckt der Admin nicht.</p>

        {error && <Notice tone="warn">{error}</Notice>}
        {!info.open && <Notice tone="warn">Bestellungen sind gerade geschlossen.</Notice>}
        {info.banned && <Notice tone="warn">Du kannst im Moment nichts bestellen.{info.ban_reason ? ` Grund: ${info.ban_reason}` : ''}</Notice>}
        {info.open_requests >= info.max_open_requests && <Notice tone="info">Du hast schon {info.open_requests} offene Anfragen. Warte bitte auf meine Antwort, bevor du weitere schickst.</Notice>}

        <Button className="w-full" busy={busy} disabled={!canSend} onClick={() => void send()}>Anfrage senden</Button>
        {!canSend && !blocked && (
          <p className="text-center text-xs text-slate-500">
            {!titleOk ? 'Es fehlt noch ein Titel (mindestens 3 Zeichen).' : !descOk ? 'Die Beschreibung braucht mindestens 10 Zeichen.' : info.colors.length > 0 && !color ? 'Bitte eine Farbe wählen.' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10
