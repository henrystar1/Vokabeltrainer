import { useEffect, useRef, useState } from 'react'
import { Crop, ZoomIn, ZoomOut } from 'lucide-react'
import type { OcrWord } from '../../features/ocr/types'

export interface OverlayRow {
  key: number
  boxes?: { foreign: OcrWord[]; german: OcrWord[] }
}

interface Props {
  image: HTMLCanvasElement
  rows: OverlayRow[]
  selected: number | null
  onSelect: (key: number) => void
  /** Wenn gesetzt: Bereich im Foto aufziehen und nochmal prüfen lassen (Koordinaten im Foto). */
  onRegion?: (rect: { x: number; y: number; w: number; h: number }) => void
  busy?: boolean
}

const RED = '239,68,68'
const BLUE = '59,130,246'

/** Das Foto mit Markierung: rot = als Wort erkannt, blau = als Übersetzung erkannt. Ohne Farbe = nicht erkannt. Nur lokal im Browser. */
export default function ScanOverlay({ image, rows, selected, onSelect, onRegion, busy }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pick, setPick] = useState(false)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = image.width
    c.height = image.height
    ctx.drawImage(image, 0, 0)
    const pad = 2
    const draw = (ws: OcrWord[], rgb: string, strong: boolean) => {
      for (const w of ws) {
        ctx.fillStyle = `rgba(${rgb},${strong ? 0.38 : 0.22})`
        ctx.strokeStyle = `rgba(${rgb},${strong ? 1 : 0.85})`
        ctx.lineWidth = strong ? 3 : 1.5
        ctx.fillRect(w.x0 - pad, w.y0 - pad, w.x1 - w.x0 + 2 * pad, w.y1 - w.y0 + 2 * pad)
        ctx.strokeRect(w.x0 - pad, w.y0 - pad, w.x1 - w.x0 + 2 * pad, w.y1 - w.y0 + 2 * pad)
      }
    }
    rows.forEach((r) => {
      if (!r.boxes) return
      const strong = r.key === selected
      draw(r.boxes.foreign, RED, strong)
      draw(r.boxes.german, BLUE, strong)
    })
    // Zeilennummern links neben dem Wort
    ctx.font = `bold ${Math.max(14, Math.round(image.width / 110))}px sans-serif`
    ctx.textBaseline = 'middle'
    rows.forEach((r, i) => {
      const f = r.boxes?.foreign[0]
      if (!f) return
      const label = String(i + 1)
      const w = ctx.measureText(label).width
      const x = Math.max(0, f.x0 - w - 8)
      const y = (f.y0 + f.y1) / 2
      ctx.fillStyle = r.key === selected ? 'rgba(250,204,21,1)' : 'rgba(15,23,42,0.85)'
      ctx.fillRect(x - 2, y - 10, w + 6, 20)
      ctx.fillStyle = r.key === selected ? '#000' : '#fff'
      ctx.fillText(label, x + 1, y)
    })
    if (drag) {
      ctx.fillStyle = 'rgba(250,204,21,0.15)'
      ctx.strokeStyle = 'rgba(250,204,21,1)'
      ctx.lineWidth = 4
      ctx.setLineDash([14, 8])
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
      ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      ctx.setLineDash([])
    }
  }, [image, rows, selected, drag])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pick || busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(e)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return
    const p = pos(e)
    setDrag({ ...drag, x1: p.x, y1: p.y })
  }
  function up() {
    if (!drag) return
    const rect = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    setDrag(null)
    if (rect.w > 40 && rect.h > 25) {
      setPick(false)
      onRegion?.(rect)
    }
  }

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = ref.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * c.width
    const y = ((e.clientY - rect.top) / rect.height) * c.height
    const hit = rows.find((r) => [...(r.boxes?.foreign ?? []), ...(r.boxes?.german ?? [])].some((w) => x >= w.x0 - 4 && x <= w.x1 + 4 && y >= w.y0 - 4 && y <= w.y1 + 4))
    if (hit) onSelect(hit.key)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-red-500 bg-red-500/30" /> Wort erkannt</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-blue-500 bg-blue-500/30" /> Übersetzung erkannt</span>
        <span className="text-slate-500">Ohne Farbe = nicht erkannt. Tippe auf ein Wort, um die Zeile zu finden.</span>
        <span className="ml-auto flex gap-1">
          {onRegion && (
            <button type="button" disabled={busy} aria-pressed={pick} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs ${pick ? 'border-yellow-300 bg-yellow-300/15 text-yellow-200' : 'border-white/10 hover:bg-white/10'}`} onClick={() => setPick((v) => !v)}>
              <Crop size={14} /> {pick ? 'Bereich aufziehen …' : 'Bereich nochmal prüfen'}
            </button>
          )}
          <button type="button" aria-label="Bild verkleinern" className="rounded-lg border border-white/10 p-1.5 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><ZoomOut size={16} /></button>
          <button type="button" aria-label="Bild vergrößern" className="rounded-lg border border-white/10 p-1.5 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}><ZoomIn size={16} /></button>
        </span>
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-xl border border-white/10 bg-black/40">
        <canvas ref={ref} onClick={onClick} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} style={{ width: `${zoom * 100}%`, maxWidth: 'none', touchAction: pick ? 'none' : 'auto' }} className={`block ${pick ? 'cursor-crosshair' : 'cursor-pointer'}`} aria-label="Foto der Seite mit Markierungen" />
      </div>
    </div>
  )
}
