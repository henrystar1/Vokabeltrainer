/** Autobahn-Spiel: Dein Auto fährt nach rechts, langsamere Autos blockieren die drei Spuren. Reine Logik (testbar). */
export const LANES = 3
export const PLAYER_X = 0.14
export const HIT_W = 0.085

export interface Obstacle { id: number; lane: number; x: number; kind: string; color: string }
export interface RunState { lane: number; obstacles: Obstacle[]; speed: number; dist: number; over: boolean; nextId: number; spawnIn: number }

export const KINDS = ['kleinwagen', 'limousine', 'kombi', 'suv', 'pickup', 'bus'] as const
const COLORS = ['#94a3b8', '#64748b', '#0ea5e9', '#f97316', '#84cc16', '#e11d48']

export const startRun = (): RunState => ({ lane: 1, obstacles: [], speed: 1, dist: 0, over: false, nextId: 1, spawnIn: 1.2 })

export function moveLane(s: RunState, d: -1 | 1): RunState {
  if (s.over) return s
  return { ...s, lane: Math.max(0, Math.min(LANES - 1, s.lane + d)) }
}

/** Ein Zeitschritt (dt in Sekunden). rand liefert Zahlen in [0,1). */
export function stepRun(s: RunState, dt: number, rand: () => number = Math.random): RunState {
  if (s.over) return s
  const speed = Math.min(3.2, s.speed + dt * 0.04)
  const move = dt * 0.32 * speed
  let obstacles = s.obstacles.map((o) => ({ ...o, x: o.x - move })).filter((o) => o.x > -0.2)
  let spawnIn = s.spawnIn - dt * speed
  let nextId = s.nextId
  if (spawnIn <= 0) {
    // höchstens 2 von 3 Spuren zugleich blockieren, damit es immer einen Weg gibt
    const lane = Math.floor(rand() * LANES)
    const near = obstacles.filter((o) => o.x > 0.85)
    const blocked = new Set(near.map((o) => o.lane))
    if (!(blocked.size >= LANES - 1 && !blocked.has(lane))) {
      obstacles = [...obstacles, { id: nextId++, lane, x: 1.12, kind: KINDS[Math.floor(rand() * KINDS.length)], color: COLORS[Math.floor(rand() * COLORS.length)] }]
    }
    spawnIn = 0.55 + rand() * 0.9
  }
  const hit = obstacles.some((o) => o.lane === s.lane && Math.abs(o.x - PLAYER_X) < HIT_W)
  return { ...s, obstacles, speed, spawnIn, nextId, dist: s.dist + dt * speed * 10, over: hit }
}
