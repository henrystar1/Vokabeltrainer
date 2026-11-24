import type * as T from 'three'
type THREE = typeof T

interface Piece { g: T.Group; home: T.Vector3; off: T.Vector3; spin: T.Vector3; start: number; dur: number }
interface Suit { t0: number; list: Piece[]; face: T.Group; reactor: T.Mesh[]; done: boolean }

export const SUIT_MS = 2900

/** Iron-Man-Rüstung (Mark III): rot-goldene Teile fliegen nacheinander heran und rasten am Körper ein – Stiefel, Beine, Rumpf, Arme, Helm, zuletzt klappt die Gesichtsplatte zu. */
export function addIronSuit(THREE: THREE, m: T.Group): void {
  if (m.userData.suit) return
  const u = m.userData as Record<string, T.Group>
  const inner = (m.children[0] as T.Group | undefined) ?? m
  const red = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.6, emissive: 0x3b0505 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.7, emissive: 0x3a2a00 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.6 })
  const glow = new THREE.MeshBasicMaterial({ color: 0x9be7ff })
  const suit: Suit = { t0: performance.now(), list: [], face: new THREE.Group(), reactor: [], done: false }
  let n = 0
  const rnd = (a: number) => { const s = Math.sin((n + 1) * 91.7 + a * 17.3) * 43758.5453; return s - Math.floor(s) }
  const add = (parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, start: number, dur = 0.55, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.Group(); const mesh = new THREE.Mesh(geo, mat); g.add(mesh)
    const home = new THREE.Vector3(x, y, z)
    const sgn = x < 0 ? -1 : 1
    const off = new THREE.Vector3(sgn * (1.6 + rnd(1) * 2.2), 1.2 + rnd(2) * 3.2, (rnd(3) - 0.5) * 4)
    const spin = new THREE.Vector3((rnd(4) - 0.5) * 9, (rnd(5) - 0.5) * 9, (rnd(6) - 0.5) * 9)
    g.position.copy(home); g.rotation.set(rx, ry, rz); g.visible = false
    parent.add(g); suit.list.push({ g, home, off, spin, start, dur }); n++
    return mesh
  }
  const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
  const C = (r: number, h: number, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg)
  // Beine (Halter am Hüftgelenk, Bein reicht 0 … −0,77)
  for (const [k, s] of [['legL', -1], ['legR', 1]] as const) {
    const leg = u[k]; const t = k === 'legL' ? 0 : 0.12
    add(leg, B(0.24, 0.14, 0.34), red, 0, -0.7, 0.04, 0.0 + t, 0.5)
    add(leg, C(0.075, 0.04), glow, 0, -0.78, 0.04, 0.15 + t, 0.4)
    add(leg, B(0.23, 0.34, 0.26), gold, 0, -0.5, 0, 0.3 + t, 0.55)
    add(leg, B(0.2, 0.08, 0.29), red, 0, -0.34, 0.01, 0.45 + t, 0.5)
    add(leg, B(0.25, 0.3, 0.27), red, 0, -0.16, 0, 0.6 + t, 0.55)
    void s
  }
  // Rumpf (im inneren Teil)
  add(inner, B(0.46, 0.22, 0.3), gold, 0, 0.9, 0, 0.85, 0.5)
  add(inner, B(0.52, 0.08, 0.32), red, 0, 0.78, 0, 0.95, 0.45)
  add(inner, B(0.6, 0.42, 0.36), red, 0, 1.2, 0, 1.05, 0.55)
  suit.reactor.push(add(inner, C(0.085, 0.06), glow, 0, 1.2, 0.19, 1.45, 0.4, Math.PI / 2))
  add(inner, B(0.4, 0.34, 0.14), dark, 0, 1.15, -0.25, 1.15, 0.55)
  for (const x of [-0.1, 0.1]) add(inner, C(0.06, 0.05), glow, x, 1.0, -0.33, 1.5, 0.4, Math.PI / 2)
  add(inner, B(0.76, 0.1, 0.32), gold, 0, 1.43, 0, 1.2, 0.5)
  // Arme (Halter an der Schulter, Arm reicht 0 … −0,62)
  for (const [k, s] of [['armL', -1], ['armR', 1]] as const) {
    const arm = u[k]; const t = k === 'armL' ? 0 : 0.1
    add(arm, B(0.28, 0.2, 0.28), red, s * 0.04, 0.03, 0, 1.3 + t, 0.5)
    add(arm, B(0.19, 0.3, 0.2), red, 0, -0.2, 0, 1.4 + t, 0.5)
    add(arm, B(0.2, 0.3, 0.22), gold, 0, -0.46, 0, 1.5 + t, 0.5)
    add(arm, B(0.16, 0.13, 0.18), red, 0, -0.66, 0, 1.6 + t, 0.45)
    add(arm, C(0.065, 0.04), glow, 0, -0.74, 0, 1.7 + t, 0.4)
  }
  // Helm: Hinterkopf rot, Gesichtsplatte gold (klappt zuletzt zu), leuchtende Augen
  add(inner, B(0.38, 0.38, 0.38), red, 0, 1.63, -0.01, 1.7, 0.55)
  add(inner, B(0.34, 0.07, 0.3), gold, 0, 1.84, 0.02, 1.85, 0.45)
  suit.face.position.set(0, 1.76, 0.19); inner.add(suit.face)
  const plate = new THREE.Mesh(B(0.3, 0.28, 0.06), gold); plate.position.set(0, -0.14, 0); suit.face.add(plate)
  for (const x of [-0.085, 0.085]) { const eye = new THREE.Mesh(B(0.09, 0.03, 0.02), glow); eye.position.set(x, -0.08, 0.035); suit.face.add(eye) }
  const chin = new THREE.Mesh(B(0.12, 0.05, 0.05), red); chin.position.set(0, -0.28, 0.01); suit.face.add(chin)
  suit.face.rotation.x = -1.25
  m.userData.suit = suit
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3)
/** Einen Schritt der Anzieh-Animation (Zeit aus performance.now); danach nichts mehr zu tun. */
export function tickSuit(m: T.Group): void {
  const s = m.userData.suit as Suit | undefined
  if (!s || s.done) return
  const t = (performance.now() - s.t0) / 1000
  let all = true
  for (const p of s.list) {
    const k = Math.max(0, Math.min(1, (t - p.start) / p.dur))
    if (k < 1) all = false
    const back = k <= 0 ? 1 : 1 - ease(k)
    p.g.visible = k > 0
    p.g.position.set(p.home.x + p.off.x * back, p.home.y + p.off.y * back, p.home.z + p.off.z * back)
    p.g.scale.setScalar(0.5 + 0.5 * ease(k))
    p.g.userData.spin = p.spin
  }
  // Gesichtsplatte schließt sich nach dem Helm
  const f = Math.max(0, Math.min(1, (t - 2.3) / 0.4))
  s.face.rotation.x = -1.25 * (1 - ease(f))
  for (const r of s.reactor) r.scale.setScalar(1 + (t > 1.45 && t < 2.2 ? Math.sin((t - 1.45) * 12) * 0.4 : 0))
  if (all && t > SUIT_MS / 1000) {
    s.done = true
    for (const p of s.list) { p.g.position.copy(p.home); p.g.scale.setScalar(1); p.g.visible = true }
    s.face.rotation.x = 0
  }
}
export const suitReady = (m: T.Group | null | undefined): boolean => !m || !m.userData.suit || (m.userData.suit as Suit).done
