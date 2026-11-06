import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
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
}

const RED = '239,68,68'
const BLUE = '59,130,246'

/** Das Foto mit Markierung: rot = als Wort erkannt, blau = als Übersetzung erkannt. Ohne Farbe = nicht erkannt. Nur lokal im Browser. */
export default function ScanOverlay({ image, rows, selected, onSelect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)

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
  }, [image, rows, selected])

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
          <button type="button" aria-label="Bild verkleinern" className="rounded-lg border border-white/10 p-1.5 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><ZoomOut size={16} /></button>
          <button type="button" aria-label="Bild vergrößern" className="rounded-lg border border-white/10 p-1.5 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}><ZoomIn size={16} /></button>
        </span>
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-xl border border-white/10 bg-black/40">
        <canvas ref={ref} onClick={onClick} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="block cursor-pointer" aria-label="Foto der Seite mit Markierungen" />
      </div>
    </div>
  )
}
