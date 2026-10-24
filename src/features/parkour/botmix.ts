/**
 * Bots mit verschiedenem Können. In der Lobby steht nur eine Zahl (`team_runs.bot_skill`):
 * 1–4 = alle Bots haben dieses Können (alte Lobbys), ab 10 = Mischung: 10 + n1 + 9·n2 + 81·n3 + 729·n4
 * (n1 Anfänger, n2 Normal, n3 Profi, n4 Meister, je 0–8).
 */
export const SKILL_NAMES = ['', 'Anfänger', 'Normal', 'Profi', 'Meister']

export type Mix = [number, number, number, number]

export function encodeMix(m: Mix): number {
  return 10 + m[0] + 9 * m[1] + 81 * m[2] + 729 * m[3]
}

export function decodeMix(code: number | null | undefined, bots: number): Mix {
  const c = code ?? 2
  if (c < 10) {
    const k = Math.max(1, Math.min(4, Math.round(c) || 2))
    const m: Mix = [0, 0, 0, 0]
    m[k - 1] = Math.max(0, bots)
    return m
  }
  let v = Math.round(c) - 10
  const m: Mix = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) { m[i] = v % 9; v = Math.floor(v / 9) }
  return m
}

/** Können je Bot (Index = Bot-Nummer). Reicht die Mischung nicht für alle, werden die letzten mit dem zuletzt genannten Können aufgefüllt. */
export function skillList(code: number | null | undefined, bots: number): number[] {
  const m = decodeMix(code, bots)
  const out: number[] = []
  for (let k = 0; k < 4; k++) for (let i = 0; i < m[k]; i++) out.push(k + 1)
  while (out.length < bots) out.push(out[out.length - 1] ?? 2)
  return out.slice(0, Math.max(0, bots))
}

export const mixTotal = (m: Mix): number => m[0] + m[1] + m[2] + m[3]
