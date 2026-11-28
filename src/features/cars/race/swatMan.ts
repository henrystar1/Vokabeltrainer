import { makeGunModel } from './gunMesh'
import type * as T from 'three'
import { makeSkinWalker } from './walkerMesh'

type THREE = typeof T
let cache: HTMLCanvasElement | null = null

/** Minecraft-Skin (64×64) eines SWAT-Mannes, selbst gemalt: Helm, Sturmhaube mit Visier, Weste mit gelber Schrift, Handschuhe, Stiefel. */
export function swatSkin(): HTMLCanvasElement | null {
  if (cache) return cache
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g = c.getContext('2d'); if (!g) return null
  const f = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
  const NAVY = '#0f172a', VEST = '#1e293b', SKIN = '#d6a07a', BLACK = '#05080f'
  f(0, 0, 32, 16, BLACK)                    // Kopf: Sturmhaube
  f(8, 8, 8, 8, NAVY); f(9, 11, 6, 2, '#38bdf8'); f(11, 14, 2, 1, SKIN) // Gesicht: Visier
  f(16, 16, 24, 16, NAVY)                   // Rumpf
  f(20, 20, 8, 12, VEST); f(21, 21, 2, 3, '#0b1220'); f(25, 21, 2, 3, '#0b1220'); f(21, 28, 6, 2, '#0b1220') // Weste vorn mit Taschen
  f(21, 25, 6, 1, '#facc15')                // gelber Streifen
  f(32, 20, 8, 12, VEST); f(32, 22, 8, 1, '#facc15'); f(33, 24, 6, 4, '#facc15'); f(34, 25, 4, 2, VEST) // Rücken: gelbes Feld (SWAT)
  g.fillStyle = '#facc15'; g.font = 'bold 5px monospace'; g.textBaseline = 'top'
  f(0, 16, 16, 16, '#111827'); f(16, 48, 16, 16, '#111827')     // Beine
  f(0, 29, 16, 3, BLACK); f(16, 61, 16, 3, BLACK)               // Stiefel
  f(40, 16, 16, 16, NAVY); f(32, 48, 16, 16, NAVY)              // Arme
  f(40, 29, 16, 3, SKIN); f(32, 61, 16, 3, SKIN)                // Hände
  f(44, 22, 4, 2, '#facc15'); f(36, 54, 4, 2, '#facc15')        // Abzeichen
  // Helm (zweite Schicht): Kappe + Schirm über der Stirn, Rest bleibt durchsichtig
  f(32, 0, 32, 8, '#1f2937'); f(32, 8, 32, 3, '#1f2937'); f(32, 11, 32, 5, 'rgba(0,0,0,0)')
  g.clearRect(32, 11, 32, 5)
  f(56, 8, 8, 3, '#1f2937')
  f(40, 8, 8, 3, '#111827')
  cache = c
  return c
}

/** SWAT-Mann: Skin-Figur mit Pistole in der rechten Hand (Körperteile wie bei den Spielern, gleiche Animation). */
export function makeSwatMan(THREE: THREE): T.Group {
  const sk = swatSkin()
  const m = sk ? makeSkinWalker(THREE, sk) : new THREE.Group()
  const arm = m.userData.armR as T.Group | undefined
  if (arm) { arm.add(makeGunModel(THREE, 'pistol')); m.userData.gunned = true }
  return m
}

/** Schlagstock in die rechte Hand eines Laufmodells (Polizist, Dieb mit Schlagstock) */
export function addBaton(THREE: THREE, m: T.Group): void {
  if (m.userData.bt) return
  const arm = m.userData.armR as T.Group | undefined
  if (!arm) return
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.4, metalness: 0.5 }))
  stick.rotation.x = Math.PI / 2; stick.position.set(0, -0.58, 0.28)
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.8 }))
  grip.rotation.x = Math.PI / 2; grip.position.set(0, -0.58, 0.02)
  arm.add(stick, grip); m.userData.bt = 1; m.userData.btMeshes = [stick, grip]
}

let medicCache: HTMLCanvasElement | null = null
/** Minecraft-Skin eines Sanitäters: rote Warnjacke mit gelben Reflexstreifen, dunkle Hose, Mütze mit Kreuz */
export function medicSkin(): HTMLCanvasElement | null {
  if (medicCache) return medicCache
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g = c.getContext('2d'); if (!g) return null
  const f = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
  const SKIN = '#e0ac86', RED = '#dc2626', DARK = '#1f2937'
  f(0, 0, 32, 16, '#5b3a1e'); f(8, 8, 8, 8, SKIN); f(10, 11, 1, 1, '#111827'); f(13, 11, 1, 1, '#111827'); f(11, 14, 2, 1, '#a0522d')
  f(16, 16, 24, 16, RED); f(20, 20, 8, 12, RED); f(20, 25, 8, 1, '#facc15'); f(20, 29, 8, 1, '#facc15'); f(23, 21, 2, 1, '#f8fafc')
  f(32, 20, 8, 12, RED); f(32, 25, 8, 1, '#facc15'); f(32, 29, 8, 1, '#facc15'); f(34, 21, 4, 3, '#f8fafc'); f(35, 21, 2, 3, RED); f(34, 22, 4, 1, RED)
  f(0, 16, 16, 16, DARK); f(16, 48, 16, 16, DARK); f(0, 29, 16, 3, '#111827'); f(16, 61, 16, 3, '#111827')
  f(40, 16, 16, 16, RED); f(32, 48, 16, 16, RED); f(40, 29, 16, 3, SKIN); f(32, 61, 16, 3, SKIN); f(40, 25, 16, 1, '#facc15'); f(32, 57, 16, 1, '#facc15')
  f(32, 0, 32, 8, '#f8fafc'); g.clearRect(32, 8, 32, 8); f(40, 8, 8, 2, '#f8fafc'); f(43, 8, 2, 2, RED)
  medicCache = c
  return c
}
export function makeMedic(THREE: THREE): T.Group {
  const sk = medicSkin()
  return sk ? makeSkinWalker(THREE, sk) : new THREE.Group()
}
