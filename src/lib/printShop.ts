/** Reine Hilfsfunktionen für den 3D-Druck-Shop (Preise anzeigen, Status, Fortschritt). */

export type PrintStatus = 'angefragt' | 'preis_vorgeschlagen' | 'in_bearbeitung' | 'druckt' | 'lieferbereit' | 'geliefert' | 'abgelehnt' | 'storniert'

export const STATUS_LABEL: Record<PrintStatus, string> = {
  angefragt: 'Angefragt',
  preis_vorgeschlagen: 'Preisvorschlag',
  in_bearbeitung: 'In Bearbeitung',
  druckt: 'Wird gedruckt',
  lieferbereit: 'Lieferbereit',
  geliefert: 'Geliefert',
  abgelehnt: 'Abgelehnt',
  storniert: 'Abgebrochen',
}

export type Tone = 'info' | 'warn' | 'ok' | 'bad' | 'muted'
export const STATUS_TONE: Record<PrintStatus, Tone> = {
  angefragt: 'info',
  preis_vorgeschlagen: 'warn',
  in_bearbeitung: 'info',
  druckt: 'warn',
  lieferbereit: 'ok',
  geliefert: 'ok',
  abgelehnt: 'bad',
  storniert: 'muted',
}

/** Schritte der Fortschrittsanzeige (ohne Ablehnung/Abbruch). */
export const STAGES: { status: PrintStatus; label: string }[] = [
  { status: 'angefragt', label: 'Angefragt' },
  { status: 'in_bearbeitung', label: 'In Bearbeitung' },
  { status: 'druckt', label: 'Druckt' },
  { status: 'lieferbereit', label: 'Lieferbereit' },
  { status: 'geliefert', label: 'Geliefert' },
]

export const ACTIVE_STATUSES: PrintStatus[] = ['angefragt', 'preis_vorgeschlagen', 'in_bearbeitung', 'druckt', 'lieferbereit']
export const FINAL_STATUSES: PrintStatus[] = ['geliefert', 'abgelehnt', 'storniert']

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export const euro = (cents: number | null | undefined) => (cents == null ? '–' : eur.format(cents / 100))

/** „12,50“ oder „12.5“ → 1250 Cent; ungültig → null. */
export function parseEuroToCents(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

export const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','))

export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

export interface ProgressInput {
  status: PrintStatus
  print_minutes: number | null
  print_started_at: string | null
  progress_override: number | null
}

export interface Progress {
  /** Gesamtfortschritt 0–100 (100 erst bei „Geliefert“). */
  pct: number
  /** Anteil am Druck selbst 0–100 (nur beim Drucken, sonst null). */
  printPct: number | null
  /** Prozent pro Minute während des Drucks (nur bei automatischer Berechnung). */
  ratePerMin: number | null
  remainingMin: number | null
}

/** Anteil der Anzeige, der auf den eigentlichen Druck entfällt: von 10 % bis 90 %. */
export const PRINT_FROM = 10
export const PRINT_TO = 90

/** Uhrzeit des Servers, fortgeschrieben seit dem letzten Laden (die Uhr des Geräts darf falsch gehen). */
export const adjustedNow = (serverNowIso: string, fetchedAtMs: number, nowMs = Date.now()) => Date.parse(serverNowIso) + (nowMs - fetchedAtMs)

export function orderProgress(o: ProgressInput, nowMs: number): Progress {
  switch (o.status) {
    case 'angefragt':
    case 'preis_vorgeschlagen':
      return { pct: 0, printPct: null, ratePerMin: null, remainingMin: null }
    case 'in_bearbeitung':
      return { pct: PRINT_FROM - 2, printPct: null, ratePerMin: null, remainingMin: null }
    case 'lieferbereit':
      return { pct: 95, printPct: null, ratePerMin: null, remainingMin: null }
    case 'geliefert':
      return { pct: 100, printPct: null, ratePerMin: null, remainingMin: null }
    case 'abgelehnt':
    case 'storniert':
      return { pct: 0, printPct: null, ratePerMin: null, remainingMin: null }
    case 'druckt': {
      const minutes = o.print_minutes && o.print_minutes > 0 ? o.print_minutes : null
      if (o.progress_override != null) {
        const p = Math.min(100, Math.max(0, o.progress_override))
        return {
          pct: PRINT_FROM + ((PRINT_TO - PRINT_FROM) * p) / 100,
          printPct: p,
          ratePerMin: null,
          remainingMin: minutes ? Math.max(0, Math.ceil(minutes * (1 - p / 100))) : null,
        }
      }
      if (!minutes || !o.print_started_at) return { pct: PRINT_FROM, printPct: 0, ratePerMin: null, remainingMin: null }
      const elapsedMin = Math.max(0, (nowMs - Date.parse(o.print_started_at)) / 60000)
      // Bis der Admin „fertig“ meldet, bleibt der Balken knapp unter dem Ende stehen.
      const p = Math.min(99, (elapsedMin / minutes) * 100)
      return {
        pct: PRINT_FROM + ((PRINT_TO - PRINT_FROM) * p) / 100,
        printPct: p,
        ratePerMin: (100 / minutes),
        remainingMin: Math.max(0, Math.ceil(minutes - elapsedMin)),
      }
    }
  }
}

/** Welche Stufe (0–4) ist erreicht? Für die Punkte unter dem Balken. */
export function stageIndex(status: PrintStatus): number {
  if (status === 'preis_vorgeschlagen') return 0
  const i = STAGES.findIndex((s) => s.status === status)
  return i < 0 ? 0 : i
}

/** Kann der Admin den Preis ohne Rückfrage annehmen? (Kunde hat die Zahl schon gesehen oder selbst genannt.) */
export function acceptsDirectly(o: { kind: 'shop' | 'custom'; status: PrintStatus; estimate_cents: number | null; offer_cents: number | null }, priceCents: number): boolean {
  return o.status === 'angefragt' && (o.kind === 'shop' || priceCents === o.estimate_cents || priceCents === o.offer_cents)
}

export interface InvoiceInput {
  breakdown: { label: string; cents: number }[] | null
  price_cents: number | null
  estimate_cents: number | null
  discount_percent: number
  rush_cents: number
}

export interface Invoice {
  lines: { label: string; cents: number }[]
  /** Artikelpreis vor Rabatt. */
  itemCents: number | null
  discountCents: number
  rushCents: number
  totalCents: number | null
}

/** Rechnung zur Anzeige: Zeilen, Anpassung nach Absprache, Rabatt, Express und Summe (stimmt mit der Datenbank überein). */
export function invoiceFor(o: InvoiceInput): Invoice {
  const item = o.price_cents ?? o.estimate_cents
  const lines = [...(o.breakdown ?? [])]
  if (item != null) {
    const diff = item - lines.reduce((a, l) => a + l.cents, 0)
    if (diff !== 0) lines.push({ label: lines.length === 0 ? 'Preis nach Absprache' : 'Anpassung nach Absprache', cents: diff })
  }
  const discount = item == null ? 0 : item - Math.round((item * (100 - o.discount_percent)) / 100)
  return { lines, itemCents: item, discountCents: discount, rushCents: o.rush_cents, totalCents: item == null ? null : item - discount + o.rush_cents }
}
