import type * as T from 'three'
import { addBaton } from './swatMan'

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
  if (mask & 4 && !m.userData.bt) addBaton(THREE, m)
  if (mask & 8 && !(done & 8)) {
    const arm = m.userData.armL as T.Group | undefined
    if (arm) {
      const gun = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.26), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.5, metalness: 0.4 }))
      body.position.set(0, 0, 0.14)
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.2), new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.6 }))
      barrel.position.set(0, 0.04, 0.3)
      gun.add(body, barrel); gun.position.set(0, -0.6, 0.12)
      arm.add(gun)
    }
  }
  m.userData.gr = done | (mask & 11)
}
