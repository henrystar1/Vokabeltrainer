import type { Rng } from '../learning/random'

/** „Wave“: Die Spitze fliegt immer im 45°-Winkel – Halten = hoch, Loslassen = runter. Stacheln und Decke/Boden töten. */
export const WW = 288
export const WH = 420
export const WAVE_X = 80
export const WAVE_R = 5
export const SPIKE_W = 40
export const SPACING = 176
const BASE_SPEED = 150
const MAX_SPEED = 235

export interface Column { x: number; c: number; g: number; passed: boolean }
export interface WaveState { y: number; cols: Column[]; score: number; started: boolean; over: boolean; t: number; speed: number }

export const newWave = (): WaveState => ({ y: WH / 2, cols: [], score: 0, started: false, over: false, t: 0, speed: BASE_SPEED })

/** Öffnung (Abstand zwischen den Spitzen) – wird mit dem Punktestand enger. */
export const gapFor = (score: number) => Math.max(104, 156 - score * 1.4)

function spawn(prev: Column | undefined, score: number, rng: Rng): Column {
  const g = gapFor(score)
  const margin = 18 + g / 2
  const maxStep = SPACING * 0.5
  const from = prev ? prev.c : WH / 2
  const c = Math.min(WH - margin, Math.max(margin, from + (rng() * 2 - 1) * maxStep))
  return { x: prev ? prev.x + SPACING : WW + 90, c, g, passed: false }
}

/** Höhe des Stachels (Dreieck) an einer Stelle: 0 außerhalb, volle Höhe in der Mitte. */
export function spikeHeight(col: Column, x: number, side: 'top' | 'bottom'): number {
  const d = Math.abs(x - col.x)
  if (d >= SPIKE_W / 2) return 0
  const full = side === 'top' ? col.c - col.g / 2 : WH - (col.c + col.g / 2)
  return full * (1 - d / (SPIKE_W / 2))
}

export function stepWave(s: WaveState, dt: number, holding: boolean, rng: Rng = Math.random): WaveState {
  if (s.over) return s
  const t = s.t + dt
  if (!s.started) {
    if (!holding) return { ...s, t, y: WH / 2 + Math.sin(t * 3) * 6 }
    s = { ...s, started: true }
  }
  const speed = Math.min(MAX_SPEED, BASE_SPEED + s.score * 2.2)
  const y = s.y + (holding ? -speed : speed) * dt
  let cols = s.cols.map((c) => ({ ...c, x: c.x - speed * dt }))
  while (cols.length === 0 || cols[cols.length - 1].x < WW + SPACING) {
    cols = [...cols, spawn(cols[cols.length - 1], s.score + cols.length, rng)]
  }
  cols = cols.filter((c) => c.x > -SPIKE_W)
  let score = s.score
  cols = cols.map((c) => {
    if (!c.passed && c.x + SPIKE_W / 2 < WAVE_X - WAVE_R) {
      score += 1
      return { ...c, passed: true }
    }
    return c
  })
  let over = y - WAVE_R < 0 || y + WAVE_R > WH
  for (const c of cols) {
    if (Math.abs(c.x - WAVE_X) > SPIKE_W / 2 + WAVE_R) continue
    // Spielerpunkt mit kleinem Spielraum gegen die Dreiecke prüfen
    const top = spikeHeight(c, WAVE_X, 'top')
    const bottom = spikeHeight(c, WAVE_X, 'bottom')
    if (y - WAVE_R * 0.7 < top || y + WAVE_R * 0.7 > WH - bottom) over = true
  }
  return { ...s, y, cols, score, over, t, speed }
}
