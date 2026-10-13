/**
 * Zusätzliche Grafik für Plus-Mitglieder: weicher Lichtverlauf, Vignette und funkelnde Partikel.
 * Wird nach dem normalen Zeichnen über das Spielfeld gelegt und ändert nichts an der Spiellogik.
 */
export function plusOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const t = performance.now() / 1000
  ctx.save()
  // wandernder Farbschimmer
  const gx = ((Math.sin(t * 0.4) + 1) / 2) * w
  const g = ctx.createRadialGradient(gx, h * 0.15, 0, gx, h * 0.15, Math.max(w, h) * 0.8)
  g.addColorStop(0, 'rgba(217,70,239,0.16)')
  g.addColorStop(0.5, 'rgba(34,211,238,0.07)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Funkeln
  for (let i = 0; i < 14; i++) {
    const px = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1
    const py = ((Math.sin(i * 78.233) * 12345.6789) % 1 + 1) % 1
    const a = 0.25 + 0.55 * Math.abs(Math.sin(t * (0.8 + (i % 5) * 0.3) + i))
    ctx.globalAlpha = a
    ctx.fillStyle = i % 2 ? '#f0abfc' : '#a5f3fc'
    const r = 1 + (i % 3) * 0.7
    ctx.beginPath()
    ctx.arc(px * w, py * h, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Vignette
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(8,4,24,0.45)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}
