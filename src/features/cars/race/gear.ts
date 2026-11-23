import type * as T from 'three'
import { addBaton } from './swatMan'
import { makeGunModel } from './gunMesh'

type THREE = typeof T

/** Ausrüstung aus dem Waffenladen: Schussweste, Helm, Schlagstock, Pistole. Preise müssen zu supabase/migrations/0116 passen. */
export type GearId = 'vest' | 'helmet' | 'baton' | 'pistol'
export interface GearItem { id: GearId; name: string; icon: string; price: number; bit: number; desc: string }
export const GEAR: GearItem[] = [
  { id: 'vest', name: 'Schussweste', icon: '🦺', price: 400, bit: 1, desc: 'Schläge, Schüsse und Rammen tun etwa halb so viel weh.' },
  { id: 'helmet', name: 'Helm', icon: '⛑️', price: 300, bit: 2, desc: 'Noch ein bisschen weniger Schaden – und du siehst richtig taff aus.' },
  { id: 'baton', name: 'Schlagstock', icon: '🏏', price: 250, bit: 4, desc: 'Schläge machen fast dreimal so viel Schaden und der Stock ist in deiner Hand zu sehen.' },
  { id: 'pistol', name: 'Pistole', icon: '🔫', price: 600, bit: 8, desc: 'Zu Fuß schießen: Maus/Tippen zielt, auch über weite Strecken. Polizisten brauchen 3 Treffer.' },
]
export type GearSet = Record<GearId, boolean>
export const NO_GEAR: GearSet = { vest: false, helmet: false, baton: false, pistol: false }
export const gearMask = (g: GearSet): number => GEAR.reduce((m, it) => m | (g[it.id] ? it.bit : 0), 0)
export const gearFromList = (l: string[]): GearSet => ({ vest: l.includes('vest'), helmet: l.includes('helmet'), baton: l.includes('baton'), pistol: l.includes('pistol') })

/** Ausrüstung sichtbar an ein Laufmodell hängen (idempotent pro Teil). */
export function addGear(THREE: THREE, m: T.Group, mask: number): void {
  const done = ((m.userData.gr as number | undefined) ?? 0)
  const inner = (m.children[0] as T.Group | undefined) ?? m
  if (mask & 1 && !(done & 1)) {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.28), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 }))
    vest.position.set(0, 1.08, 0)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.04), new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.5, metalness: 0.4 }))
    plate.position.set(0, 1.12, 0.15)
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.045), new THREE.MeshStandardMaterial({ color: 0xfacc15 }))
    tag.position.set(0, 0.94, 0.15)
    inner.add(vest, plate, tag)
  }
  if (mask & 2 && !(done & 2)) {
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.3 }))
    helm.position.set(0, 1.84, 0)
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.5 }))
    visor.position.set(0, 1.78, 0.25)
    inner.add(helm, visor)
  }
  if (mask & 64 && !(done & 64)) {
    // Iron-Man-Anzug (Admin): rot-goldene Rüstung, leuchtender Reaktor, Gesichtsplatte, Düsen an Händen und Füßen
    const red = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.3, metalness: 0.75 })
    const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.8 })
    const glow = new THREE.MeshBasicMaterial({ color: 0x7dd3fc })
    const add = (g: T.BufferGeometry, mt: T.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, mt); o.position.set(x, y, z); inner.add(o); return o }
    add(new THREE.BoxGeometry(0.56, 0.58, 0.32), red, 0, 1.08, 0)
    add(new THREE.BoxGeometry(0.34, 0.2, 0.05), gold, 0, 0.84, 0.17)
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), glow, 0, 1.14, 0.18).rotation.x = Math.PI / 2
    add(new THREE.BoxGeometry(0.54, 0.26, 0.54), red, 0, 1.82, 0)
    add(new THREE.BoxGeometry(0.38, 0.18, 0.06), gold, 0, 1.8, 0.28)
    add(new THREE.BoxGeometry(0.1, 0.03, 0.02), glow, -0.1, 1.84, 0.315)
    add(new THREE.BoxGeometry(0.1, 0.03, 0.02), glow, 0.1, 1.84, 0.315)
    add(new THREE.BoxGeometry(0.62, 0.14, 0.3), gold, 0, 1.42, 0)
    add(new THREE.BoxGeometry(0.2, 0.3, 0.22), red, -0.14, 0.34, 0)
    add(new THREE.BoxGeometry(0.2, 0.3, 0.22), red, 0.14, 0.34, 0)
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), glow, -0.14, 0.04, 0)
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), glow, 0.14, 0.04, 0)
    for (const k of ['armR', 'armL'] as const) {
      const a = m.userData[k] as T.Group | undefined
      if (!a) continue
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), red); sleeve.position.set(0, -0.3, 0); a.add(sleeve)
      const palm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), glow); palm.position.set(0, -0.64, 0); a.add(palm)
    }
  }
  if (mask & 4 && !m.userData.bt) addBaton(THREE, m)
  const gunBit = mask & 32 ? 32 : mask & 16 ? 16 : mask & 8 ? 8 : 0
  if (gunBit !== ((m.userData.gunBit as number | undefined) ?? 0)) {
    const arm = m.userData.armR as T.Group | undefined
    if (arm) {
      if (m.userData.gunMesh) arm.remove(m.userData.gunMesh as T.Object3D)
      m.userData.gunMesh = undefined
      if (gunBit) { const gm = makeGunModel(THREE, gunBit === 32 ? 'sniper' : gunBit === 16 ? 'rifle' : 'pistol'); arm.add(gm); m.userData.gunMesh = gm }
      m.userData.gunBit = gunBit; m.userData.gunned = gunBit !== 0
    }
  }
  m.userData.gr = mask
}
