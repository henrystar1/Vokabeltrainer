import type * as T from 'three'
import { addBaton } from './swatMan'
import { makeGunModel } from './gunMesh'
import { addIronSuit } from './ironSuit'

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
  if (mask & 64 && !(done & 64)) addIronSuit(THREE, m)
  if (mask & 128 && !(done & 128)) {
    // Feuerwehr-Einsatzjacke: roter Mantel mit gelben Reflexstreifen, gelber Helm mit Nackenschutz, Atemluftflasche, Axt am Gürtel
    const coat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.32), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7 })); coat.position.set(0, 1.12, 0)
    const hem = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.18, 0.34), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.7 })); hem.position.set(0, 0.74, 0)
    const refl = new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.4, emissive: 0x403300 })
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.34), refl); s1.position.set(0, 1.0, 0)
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.34), refl); s2.position.set(0, 0.84, 0)
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7 })); tank.position.set(0, 1.15, -0.26)
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.2 })); helm.position.set(0, 1.84, 0)
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 })); brim.position.set(0, 1.76, 0.33)
    const nape = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.06), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 })); nape.position.set(0, 1.72, -0.27)
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0xdc2626 })); crest.position.set(0, 1.96, 0)
    inner.add(coat, hem, s1, s2, tank, helm, brim, nape, crest)
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
