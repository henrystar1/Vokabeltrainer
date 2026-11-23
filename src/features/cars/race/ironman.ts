import type { Walker } from './foot'

/** Iron-Man-Anzug (nur Admin): zu Fuß frei fliegen – W/S vor/zurück, A/D drehen, E hoch, R runter */
export const IRON = { fly: 38, boost: 62, climb: 17, walk: 8, turn: 2.7, ceiling: 420 }

export interface IronIn { fwd: boolean; back: boolean; left: boolean; right: boolean; up: boolean; down: boolean; boost?: boolean; turn?: number }

/** Ein Flugschritt. `ground` liefert die Höhe des Bodens/Dachs unter (x, z), `roof` die Dachhöhe von Häusern (0 = frei). */
export function stepIron(w: Walker, inp: IronIn, dt: number, ground: (x: number, z: number, y: number) => number, roof: (x: number, z: number) => number): Walker {
  const h = w.h + ((inp.left ? 1 : 0) - (inp.right ? 1 : 0) - (inp.turn ?? 0)) * IRON.turn * dt
  const g0 = ground(w.x, w.z, w.y)
  const air = w.y > g0 + 0.3 || inp.up
  const top = air ? (inp.boost ? IRON.boost : IRON.fly) : IRON.walk
  const sp = ((inp.fwd ? 1 : 0) - (inp.back ? 0.55 : 0)) * top
  let x = w.x + Math.sin(h) * sp * dt, z = w.z + Math.cos(h) * sp * dt
  let y = w.y + ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * IRON.climb * dt
  y = Math.min(IRON.ceiling, y)
  // nicht seitlich in ein Haus hineinfliegen (unterhalb der Dachkante), außer man ist schon drin
  const inside = (px: number, pz: number) => { const r = roof(px, pz); return r > 0.5 && y < r - 0.3 }
  if (inside(x, z) && !inside(w.x, w.z)) {
    if (!inside(x, w.z)) z = w.z
    else if (!inside(w.x, z)) x = w.x
    else { x = w.x; z = w.z }
  }
  y = Math.max(y, ground(x, z, y))
  const speed = Math.abs(sp)
  return { ...w, x, z, h, y, vy: 0, vx: 0, vz: 0, sp: speed, ph: w.ph + Math.min(speed, 8) * dt * 1.7, stun: Math.max(0, w.stun - dt), inv: Math.max(0, w.inv - dt) }
}
