import { describe, expect, it } from 'vitest'
import { acceptsDirectly, adjustedNow, centsToInput, fmtDuration, invoiceFor, orderProgress, parseEuroToCents, stageIndex, type ProgressInput } from './printShop'

const base: ProgressInput = { status: 'druckt', print_minutes: 100, print_started_at: '2026-10-10T10:00:00Z', progress_override: null }
const at = (min: number) => Date.parse('2026-10-10T10:00:00Z') + min * 60000

describe('orderProgress', () => {
  it('Stufen vor dem Druck', () => {
    expect(orderProgress({ ...base, status: 'angefragt' }, 0).pct).toBe(0)
    expect(orderProgress({ ...base, status: 'in_bearbeitung' }, 0).pct).toBe(8)
    expect(orderProgress({ ...base, status: 'lieferbereit' }, 0).pct).toBe(95)
    expect(orderProgress({ ...base, status: 'geliefert' }, 0).pct).toBe(100)
    expect(orderProgress({ ...base, status: 'abgelehnt' }, 0).pct).toBe(0)
  })

  it('Druck: Fortschritt wächst linear mit der Zeit, Rate = 1 % pro Minute bei 100 Minuten', () => {
    const p0 = orderProgress(base, at(0))
    expect(p0.pct).toBe(10)
    expect(p0.ratePerMin).toBeCloseTo(1)
    const p50 = orderProgress(base, at(50))
    expect(p50.printPct).toBeCloseTo(50)
    expect(p50.pct).toBeCloseTo(50) // 10 + 80 * 0,5
    expect(p50.remainingMin).toBe(50)
  })

  it('bleibt vor „fertig“ knapp unter 100 % des Drucks und wird nie negativ', () => {
    const late = orderProgress(base, at(500))
    expect(late.printPct).toBe(99)
    expect(late.remainingMin).toBe(0)
    expect(orderProgress(base, at(-30)).printPct).toBe(0)
  })

  it('Handeingabe hat Vorrang', () => {
    const p = orderProgress({ ...base, progress_override: 25 }, at(90))
    expect(p.printPct).toBe(25)
    expect(p.pct).toBeCloseTo(30)
    expect(p.ratePerMin).toBeNull()
    expect(p.remainingMin).toBe(75)
  })

  it('Ohne Zeitangabe bleibt es am Anfang des Drucks', () => {
    expect(orderProgress({ ...base, print_minutes: null }, at(10)).pct).toBe(10)
    expect(orderProgress({ ...base, print_started_at: null }, at(10)).pct).toBe(10)
  })
})

describe('Hilfsfunktionen', () => {
  it('Serveruhr wird fortgeschrieben', () => {
    expect(adjustedNow('2026-10-10T10:00:00Z', 1000, 4000)).toBe(Date.parse('2026-10-10T10:00:00Z') + 3000)
  })
  it('Euro-Eingaben', () => {
    expect(parseEuroToCents('3,50')).toBe(350)
    expect(parseEuroToCents('3.5 €')).toBe(350)
    expect(parseEuroToCents('12')).toBe(1200)
    expect(parseEuroToCents('abc')).toBeNull()
    expect(parseEuroToCents('1,234')).toBeNull()
    expect(centsToInput(350)).toBe('3,50')
    expect(centsToInput(null)).toBe('')
  })
  it('Dauer', () => {
    expect(fmtDuration(45)).toBe('45 min')
    expect(fmtDuration(60)).toBe('1 h')
    expect(fmtDuration(135)).toBe('2 h 15 min')
  })
  it('Stufen', () => {
    expect(stageIndex('angefragt')).toBe(0)
    expect(stageIndex('preis_vorgeschlagen')).toBe(0)
    expect(stageIndex('druckt')).toBe(2)
    expect(stageIndex('geliefert')).toBe(4)
  })
  it('direkte Annahme wie in der Datenbank', () => {
    const o = { kind: 'custom' as const, status: 'angefragt' as const, estimate_cents: 300, offer_cents: 250 }
    expect(acceptsDirectly(o, 300)).toBe(true)
    expect(acceptsDirectly(o, 250)).toBe(true)
    expect(acceptsDirectly(o, 400)).toBe(false)
    expect(acceptsDirectly({ ...o, kind: 'shop' }, 999)).toBe(true)
    expect(acceptsDirectly({ ...o, status: 'preis_vorgeschlagen' }, 300)).toBe(false)
  })
})

describe('invoiceFor', () => {
  const lines = [{ label: 'Material', cents: 100 }, { label: 'Aufwand', cents: 200 }]
  it('Zeilen, Rabatt und Express ergeben den Endpreis', () => {
    const inv = invoiceFor({ breakdown: lines, price_cents: 300, estimate_cents: 300, discount_percent: 10, rush_cents: 200 })
    expect(inv.lines).toHaveLength(2)
    expect(inv.discountCents).toBe(30)
    expect(inv.totalCents).toBe(470)
  })
  it('Abweichender Preis nach Absprache wird als Zeile ausgewiesen', () => {
    const inv = invoiceFor({ breakdown: lines, price_cents: 420, estimate_cents: 300, discount_percent: 0, rush_cents: 0 })
    expect(inv.lines.at(-1)).toEqual({ label: 'Anpassung nach Absprache', cents: 120 })
    expect(inv.lines.reduce((a, l) => a + l.cents, 0)).toBe(420)
  })
  it('ohne Zeilen und ohne Preis', () => {
    expect(invoiceFor({ breakdown: null, price_cents: null, estimate_cents: null, discount_percent: 0, rush_cents: 0 }).totalCents).toBeNull()
    expect(invoiceFor({ breakdown: null, price_cents: 600, estimate_cents: null, discount_percent: 0, rush_cents: 0 }).lines).toEqual([{ label: 'Preis nach Absprache', cents: 600 }])
  })
})
