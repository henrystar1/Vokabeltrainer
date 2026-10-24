/**
 * Bots mit verschiedenem Können. In der Lobby steht nur eine Zahl (`team_runs.bot_skill`):
 * 1–5 = alle Bots haben dieses Können (alte Lobbys), ab 10 = Mischung (laufende Nummer in `MIXES`).
 * Können: 1 Anfänger, 2 Normal, 3 Profi, 4 Meister (rechnet am meisten), 5 Effizient (fast so gut wie der Meister, rechnet aber wenig).
 */
export const SKILL_NAMES = ['', 'Anfänger', 'Normal', 'Profi', 'Meister', 'Effizient']
/** Reihenfolge nach Stärke (für Anzeige und Aufstellung): Effizient liegt zwischen Profi und Meister. */
export const SKILL_ORDER = [1, 2, 3, 5, 4]
export const MAX_BOTS = 8

export type Mix = [number, number, number, number, number] // Anzahl je Können 1–5

const MIXES: Mix[] = []
const MIX_INDEX = new Map<string, number>()
for (let n5 = 0; n5 <= MAX_BOTS; n5++) for (let n4 = 0; n4 <= MAX_BOTS - n5; n4++) for (let n3 = 0; n3 <= MAX_BOTS - n5 - n4; n3++) for (let n2 = 0; n2 <= MAX_BOTS - n5 - n4 - n3; n2++) for (let n1 = 0; n1 <= MAX_BOTS - n5 - n4 - n3 - n2; n1++) {
  MIX_INDEX.set(`${n1},${n2},${n3},${n4},${n5}`, MIXES.length)
  MIXES.push([n1, n2, n3, n4, n5])
}

export function encodeMix(m: Mix): number {
  const i = MIX_INDEX.get(m.join(','))
  return 10 + (i ?? 0)
}

export function decodeMix(code: number | null | undefined, bots: number): Mix {
  const c = Math.round(code ?? 2)
  if (c < 10) {
    const k = Math.max(1, Math.min(5, c || 2))
    const m: Mix = [0, 0, 0, 0, 0]
    m[k - 1] = Math.max(0, bots)
    return m
  }
  return [...(MIXES[c - 10] ?? [0, 0, 0, 0, 0])] as Mix
}

/** Können je Bot (Index = Bot-Nummer). Reicht die Mischung nicht für alle, werden die letzten mit dem zuletzt genannten Können aufgefüllt. */
export function skillList(code: number | null | undefined, bots: number): number[] {
  const m = decodeMix(code, bots)
  const out: number[] = []
  for (const k of SKILL_ORDER) for (let i = 0; i < m[k - 1]; i++) out.push(k)
  while (out.length < bots) out.push(out[out.length - 1] ?? 2)
  return out.slice(0, Math.max(0, bots))
}

export const mixTotal = (m: Mix): number => m[0] + m[1] + m[2] + m[3] + m[4]
