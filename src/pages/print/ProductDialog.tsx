import { useEffect, useState } from 'react'
import { Box, CheckCircle2, Image as ImageIcon } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import Modal from '../../components/ui/Modal'
import { Notice } from '../../components/ui/States'
import CoinIcon from '../../components/ui/CoinIcon'
import StlViewer from '../../components/print/StlViewer'
import { ColorSwatches, OptionCard, QuoteBox, Stepper, useStlMesh } from '../../components/print/parts'
import { useSignedUrls } from '../../features/print/hooks'
import { useWallet } from '../../features/koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { euro } from '../../lib/printShop'
import { createPrintOrder, getPrintQuote, type PrintInfo, type PrintProduct, type PrintQuote } from '../../services/printShop'

interface Props {
  product: PrintProduct
  info: PrintInfo
  onClose: () => void
  onOrdered: () => void
  onShowOrders: () => void
}

/** Kaufmenü: Farbe, Stückzahl, Text, Express und Rabatt – mit Live-Preis. */
export default function ProductDialog({ product, info, onClose, onOrdered, onShowOrders }: Props) {
  const wallet = useWallet()
  const urls = useSignedUrls([product.image_path])
  const [view, setView] = useState<'photo' | '3d'>(product.model_path ? '3d' : 'photo')
  const [color, setColor] = useState<string | null>(product.colors[0]?.id ?? null)
  const [qty, setQty] = useState(1)
  const [text, setText] = useState('')
  const [rush, setRush] = useState(false)
  const [discount, setDiscount] = useState(false)
  const [quote, setQuote] = useState<PrintQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const { mesh } = useStlMesh(view === '3d' ? product.model_path : null)
  const chosen = product.colors.find((c) => c.id === color)
  const canAffordDiscount = wallet.balance >= info.discount_coins
  const blocked = !info.open || info.banned
  const needsText = product.text_prompt != null

  useEffect(() => {
    if (product.colors.length > 0 && !color) { setQuote(null); return }
    let alive = true
    setQuoting(true)
    const t = window.setTimeout(() => {
      getPrintQuote({ kind: 'shop', product: product.id, volume: null, color, qty, rush, discount }).then(
        (q) => { if (alive) { setQuote(q); setError(null); setQuoting(false) } },
        (e) => { if (alive) { setQuote(null); setError(errorMessage(e)); setQuoting(false) } },
      )
    }, 150)
    return () => { alive = false; window.clearTimeout(t) }
  }, [product.id, product.colors.length, color, qty, rush, discount])

  async function order() {
    setBusy(true)
    setError(null)
    try {
      await createPrintOrder({
        kind: 'shop', product: product.id, color, qty, rush, discount, volume: null,
        customText: needsText ? text.trim() : null, title: null, description: null, uploadPath: null, photoPaths: [], dims: null, offerCents: null,
      })
      await wallet.refresh()
      onOrdered()
      setDone(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal title="Vorbestellt" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={48} className="text-emerald-400" />
          <p className="text-lg font-semibold">Deine Vorbestellung ist raus!</p>
          <p className="max-w-sm text-sm text-slate-400">Ich schaue sie mir an und melde mich. Den Stand siehst du unter „Meine Bestellungen“. Bezahlt wird bei der Übergabe in der Schule.</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button onClick={() => { onClose(); onShowOrders() }}>Meine Bestellungen</Button>
            <Button variant="ghost" onClick={onClose}>Weiter stöbern</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={product.name} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-2xl">
            {view === '3d' && product.model_path ? (
              <StlViewer mesh={mesh} color={chosen?.hex ?? '#22d3ee'} className="h-full w-full" />
            ) : urls[product.image_path ?? ''] ? (
              <img src={urls[product.image_path ?? '']} alt={product.name} className="h-full w-full rounded-2xl border border-white/10 object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-space-700 to-space-900 text-slate-600"><Box size={64} /></div>
            )}
          </div>
          {product.model_path && product.image_path && (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setView('3d')} className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl text-sm ${view === '3d' ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-white/5 text-slate-400'}`}><Box size={15} /> 3D-Ansicht</button>
              <button type="button" onClick={() => setView('photo')} className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl text-sm ${view === 'photo' ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-white/5 text-slate-400'}`}><ImageIcon size={15} /> Foto</button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {product.description && <p className="text-sm leading-relaxed text-slate-300">{product.description}</p>}
          <p className="text-2xl font-semibold">{euro(product.price_cents)} <span className="text-sm font-normal text-slate-500">pro Stück</span></p>

          {product.colors.length > 0 && (
            <div>
              <p className="label-mono mb-2">Farbe</p>
              <ColorSwatches colors={product.colors} value={color} onChange={setColor} />
            </div>
          )}

          {needsText && (
            <Field label={product.text_prompt ?? 'Text'} hint="Höchstens 40 Zeichen.">
              <TextInput value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder={product.text_prompt ?? ''} />
            </Field>
          )}

          <div>
            <p className="label-mono mb-2">Stückzahl</p>
            <Stepper value={qty} max={info.max_qty} onChange={setQty} label="Stückzahl" />
          </div>

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

          <QuoteBox quote={quote} loading={quoting} note={product.colors.length > 0 && !color ? 'Wähle zuerst eine Farbe.' : undefined} />

          {error && <Notice tone="warn">{error}</Notice>}
          {!info.open && <Notice tone="warn">Bestellungen sind gerade geschlossen.</Notice>}
          {info.banned && <Notice tone="warn">Du kannst im Moment nichts bestellen.{info.ban_reason ? ` Grund: ${info.ban_reason}` : ''}</Notice>}

          <Button className="w-full" busy={busy} disabled={blocked || !quote || (needsText && text.trim().length === 0)} onClick={() => void order()}>
            Vorbestellen
          </Button>
        </div>
      </div>
    </Modal>
  )
}
