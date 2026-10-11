import { useRef, useState } from 'react'
import { ImagePlus, Pencil, Plus, Trash2, UploadCloud } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { Field, TextArea, TextInput } from '../../../components/ui/Field'
import Modal from '../../../components/ui/Modal'
import { EmptyState, ErrorBox, Notice, Spinner } from '../../../components/ui/States'
import StlViewer from '../../../components/print/StlViewer'
import { useStlMesh } from '../../../components/print/parts'
import { useSignedUrls } from '../../../features/print/hooks'
import { errorMessage } from '../../../lib/errors'
import { resizeImage } from '../../../lib/image'
import { centsToInput, euro, parseEuroToCents } from '../../../lib/printShop'
import { useAsync } from '../../../lib/useAsync'
import {
  adminPrintDeleteProduct, adminPrintListColors, adminPrintListProducts, adminPrintSaveProduct, newFilePath, removePrintFiles, uploadPrintFile,
  type AdminColor, type AdminProduct,
} from '../../../services/printShop'

/** Katalog: die Produkte des Shops (Bild, 3D-Modell, Preis, Farben, optionaler Eingabetext). */
export default function CatalogTab() {
  const products = useAsync(adminPrintListProducts, [])
  const colors = useAsync(adminPrintListColors, [])
  const [edit, setEdit] = useState<AdminProduct | 'new' | null>(null)
  const urls = useSignedUrls((products.data ?? []).map((p) => p.image_path))

  if ((products.loading && !products.data) || (colors.loading && !colors.data)) return <Spinner />
  if (products.error || colors.error) return <ErrorBox message={(products.error ?? colors.error) as string} onRetry={() => { products.reload(); colors.reload() }} />

  async function toggle(p: AdminProduct) {
    await adminPrintSaveProduct({ ...p, active: !p.active })
    products.reload()
  }

  async function remove(p: AdminProduct) {
    if (!window.confirm(`„${p.name}“ löschen? Bestehende Bestellungen bleiben erhalten.`)) return
    const paths = await adminPrintDeleteProduct(p.id)
    await removePrintFiles(paths).catch(() => undefined)
    products.reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-400">Hier legst du fest, was im Shop zu kaufen ist. Neue Produkte sind sofort für alle sichtbar, wenn sie „aktiv“ sind.</p>
        <Button onClick={() => setEdit('new')}><Plus size={16} /> Produkt</Button>
      </div>
      {products.data?.length === 0 && <EmptyState title="Noch keine Produkte" text="Lege zum Beispiel eine Schlange, einen Frosch oder ein Namensschild an." />}
      <ul className="grid gap-3 sm:grid-cols-2">
        {products.data?.map((p) => (
          <li key={p.id} className={`glass flex gap-4 rounded-2xl p-4 ${p.active ? '' : 'opacity-60'}`}>
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-space-700">
              {p.image_path && urls[p.image_path] && <img src={urls[p.image_path]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="text-sm text-accent-cyan">{euro(p.price_cents)} · {p.print_minutes} min</p>
              <p className="text-xs text-slate-500">{p.model_path ? '3D-Modell · ' : ''}{p.text_prompt ? `Eingabe: ${p.text_prompt} · ` : ''}{p.color_ids ? `${p.color_ids.length} Farben` : 'alle Farben'}{p.active ? '' : ' · versteckt'}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button variant="secondary" className="!min-h-[36px] !px-3 text-sm" onClick={() => setEdit(p)}><Pencil size={14} /> Bearbeiten</Button>
                <Button variant="ghost" className="!min-h-[36px] !px-3 text-sm" onClick={() => void toggle(p)}>{p.active ? 'Verstecken' : 'Zeigen'}</Button>
                <Button variant="ghost" className="!min-h-[36px] !px-3 text-sm text-rose-300" aria-label="Löschen" onClick={() => void remove(p)}><Trash2 size={14} /></Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {edit && (
        <ProductEditor
          product={edit === 'new' ? null : edit}
          colors={colors.data ?? []}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); products.reload() }}
        />
      )}
    </div>
  )
}

function ProductEditor({ product, colors, onClose, onSaved }: { product: AdminProduct | null; colors: AdminColor[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [price, setPrice] = useState(centsToInput(product?.price_cents ?? 500))
  const [minutes, setMinutes] = useState(String(product?.print_minutes ?? 60))
  const [promptOn, setPromptOn] = useState(!!product?.text_prompt)
  const [prompt, setPrompt] = useState(product?.text_prompt ?? 'Dein Name')
  const [allColors, setAllColors] = useState(!product?.color_ids)
  const [colorIds, setColorIds] = useState<string[]>(product?.color_ids ?? [])
  const [active, setActive] = useState(product?.active ?? true)
  const [sort, setSort] = useState(String(product?.sort ?? 100))
  const [imageFile, setImageFile] = useState<Blob | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [removeModel, setRemoveModel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const stlInput = useRef<HTMLInputElement>(null)

  const existing = useSignedUrls([product?.image_path])
  const modelSource = modelFile ?? (!removeModel && product?.model_path ? product.model_path : null)
  const { mesh, error: meshError } = useStlMesh(modelSource)
  const priceCents = parseEuroToCents(price)
  const minutesN = Number(minutes)
  const valid = name.trim().length > 0 && priceCents != null && Number.isInteger(minutesN) && minutesN >= 1 && (!promptOn || prompt.trim().length > 0) && (allColors || colorIds.length > 0)
  const shownImage = imageUrl ?? (!removeImage && product?.image_path ? existing[product.image_path] : null)

  async function pickImage(f: File | undefined) {
    if (!f) return
    try {
      const blob = await resizeImage(f, 1200, 0.85)
      setImageFile(blob)
      setImageUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob) })
      setRemoveImage(false)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function save() {
    if (priceCents == null) return
    setBusy(true)
    setError(null)
    const uploaded: string[] = []
    try {
      let imagePath = removeImage ? null : product?.image_path ?? null
      let modelPath = removeModel ? null : product?.model_path ?? null
      if (imageFile) { imagePath = newFilePath('shop', 'jpg'); await uploadPrintFile(imagePath, imageFile); uploaded.push(imagePath) }
      if (modelFile) { modelPath = newFilePath('shop', 'stl'); await uploadPrintFile(modelPath, modelFile); uploaded.push(modelPath) }
      await adminPrintSaveProduct({
        id: product?.id ?? null, name: name.trim(), description: description.trim(), price_cents: priceCents, print_minutes: minutesN,
        text_prompt: promptOn ? prompt.trim() : null, color_ids: allColors ? null : colorIds, image_path: imagePath, model_path: modelPath,
        active, sort: Number.isFinite(Number(sort)) ? Math.round(Number(sort)) : 100,
      })
      // Ersetzte Dateien aufräumen
      const old = [product?.image_path, product?.model_path].filter((p): p is string => !!p && p !== imagePath && p !== modelPath)
      await removePrintFiles(old).catch(() => undefined)
      onSaved()
    } catch (e) {
      await removePrintFiles(uploaded).catch(() => undefined)
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={product ? 'Produkt bearbeiten' : 'Neues Produkt'} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Name"><TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="z. B. Frosch" /></Field>
          <Field label="Beschreibung"><TextArea value={description} maxLength={600} rows={3} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preis pro Stück (€)"><TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <Field label="Druckzeit pro Stück (min)" hint="Für Fortschritt und Zeitplan"><TextInput inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
          </div>
          <div className="space-y-2 rounded-xl border border-white/10 p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={promptOn} onChange={(e) => setPromptOn(e.target.checked)} /> Kunde gibt einen Text ein (z. B. Namensschild)</label>
            {promptOn && <TextInput value={prompt} maxLength={40} onChange={(e) => setPrompt(e.target.value)} placeholder="Frage an den Kunden, z. B. Dein Name" />}
          </div>
          <div className="space-y-2 rounded-xl border border-white/10 p-3">
            <p className="label-mono">Farben</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={allColors} onChange={(e) => setAllColors(e.target.checked)} /> Alle aktiven Farben anbieten</label>
            {!allColors && (
              <div className="flex flex-wrap gap-2">
                {colors.filter((c) => c.active).map((c) => {
                  const on = colorIds.includes(c.id)
                  return (
                    <button key={c.id} type="button" onClick={() => setColorIds((l) => (on ? l.filter((x) => x !== c.id) : [...l, c.id]))} className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-sm ${on ? 'border-accent-cyan bg-accent-cyan/10' : 'border-white/15 text-slate-400'}`}>
                      <span className="h-4 w-4 rounded-full border border-white/30" style={{ background: c.hex }} />{c.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={active} onChange={(e) => setActive(e.target.checked)} /> Im Shop sichtbar</label>
            <Field label="Reihenfolge (klein = oben)"><TextInput inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="label-mono mb-2">Bild</p>
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-space-800">
              {shownImage ? <img src={shownImage} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-600"><ImagePlus size={40} /></div>}
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => imgInput.current?.click()}><ImagePlus size={15} /> Bild wählen</Button>
              {shownImage && <Button variant="ghost" onClick={() => { setImageFile(null); setImageUrl(null); setRemoveImage(true) }}>Entfernen</Button>}
              <input ref={imgInput} type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
            </div>
          </div>
          <div>
            <p className="label-mono mb-2">3D-Modell (STL) für die Vorschau</p>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => stlInput.current?.click()}><UploadCloud size={15} /> STL wählen</Button>
              {modelSource && <Button variant="ghost" onClick={() => { setModelFile(null); setRemoveModel(true) }}>Entfernen</Button>}
              <input ref={stlInput} type="file" accept=".stl" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setModelFile(f); setRemoveModel(false) } }} />
            </div>
            {meshError && <Notice tone="warn">{meshError}</Notice>}
            {mesh && <StlViewer mesh={mesh} className="h-56 w-full" />}
            <p className="mt-2 text-xs text-slate-500">Hinweis: Wer die 3D-Vorschau öffnet, lädt die Datei dabei in den Browser. Willst du das nicht, lass das Modell weg und zeig nur ein Bild.</p>
          </div>
        </div>
      </div>
      {error && <div className="mt-4"><Notice tone="warn">{error}</Notice></div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button busy={busy} disabled={!valid || !!meshError} onClick={() => void save()}>Speichern</Button>
      </div>
    </Modal>
  )
}
