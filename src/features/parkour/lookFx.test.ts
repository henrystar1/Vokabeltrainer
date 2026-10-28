import { describe, expect, it } from 'vitest'
import { LOOKS } from './lookFx'
import type { HoleAnim, Look } from './lookTypes'

/** Zeichenfläche, die alles annimmt und mitzählt (prüft, dass kein Auftritt abstürzt und tatsächlich etwas zeichnet). */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: { n: number; ys: number[] } } {
  const calls = { n: 0, ys: [] as number[] } // ys: Ziel jeder Verschiebung (translate)
  const grad = { addColorStop: () => undefined }
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 40 })
      return (...a: unknown[]) => { calls.n++; if (k === 'translate') calls.ys.push(Number(a[1])) }
    },
    set(t, k: string, v) { t[k] = v; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('Auftritte', () => {
  const ids = Object.keys(LOOKS) as Look[]
  it('es gibt die Gitarre', () => expect(ids).toContain('guitar'))
  for (const id of ids) {
    it(`${id}: Kommen und Gehen zeichnen ohne Fehler (auch hoch oben im Level)`, () => {
      const def = LOOKS[id]
      for (const [y, top] of [[292, undefined], [-900, -864], [60, 36]] as const) {
        for (const kind of ['in', 'out'] as const) {
          const dur = kind === 'in' ? def.inDur : def.outDur
          let drew = 0
          for (let s = 0; s <= dur; s += dur / 40) {
            const { ctx, calls } = fakeCtx()
            const h: HoleAnim = { x: 300, y, t: s, kind, lv: 0, face: 1, look: id, top }
            def.anim(ctx, h, s)
            if (s >= def.appear) { def.back(ctx, 300, y, s); def.body(ctx, 300, y, 1, s); def.label(ctx, 311, y - 8, 'Test', s) }
            drew += calls.n
          }
          expect(drew, `${id} ${kind}`).toBeGreaterThan(50)
        }
      }
    })
  }
  it('Schwarzes Loch hängt in hohen Ebenen über der Figur, nicht am Bildrand der Ebene 0', () => {
    const { ctx, calls } = fakeCtx()
    const y = -900
    LOOKS.blackhole.anim(ctx, { x: 300, y, t: 0.9, kind: 'in', lv: 0, face: 1, look: 'blackhole', top: -864 }, 0.9)
    const ys = calls.ys.filter((v) => Number.isFinite(v))
    expect(ys.length).toBeGreaterThan(0)
    expect(Math.max(...ys)).toBeLessThan(-800) // das Loch liegt in der Höhe der Figur (y = −900), nicht bei y = 36
  })
})
