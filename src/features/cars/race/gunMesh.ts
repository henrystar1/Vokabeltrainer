import type * as T from 'three'

type THREE = typeof T
export type GunKind = 'pistol' | 'rifle' | 'sniper'

/** Waffe für die rechte Hand: Lauf zeigt entlang −y des Arms; ist der Arm nach vorn gestreckt (rotation.x ≈ −1,5), zeigt sie nach vorn. */
export function makeGunModel(THREE: THREE, kind: GunKind): T.Group {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.45, metalness: 0.5 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.35, metalness: 0.7 })
  const wood = new THREE.MeshStandardMaterial({ color: kind === 'sniper' ? 0x2f3a24 : 0x3f3f46, roughness: 0.8 })
  // w = Breite (x), l = Länge nach vorn, h = Höhe (z); fwd = Mitte vor der Hand, up = Mitte über der Hand
  const bx = (w: number, l: number, h: number, fwd: number, up: number, m: T.Material, x = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m); b.position.set(x, -0.6 - fwd, up); g.add(b); return b }
  if (kind === 'pistol') {
    bx(0.05, 0.24, 0.07, 0.1, 0.03, dark); bx(0.04, 0.09, 0.07, 0.01, -0.04, dark); bx(0.035, 0.1, 0.035, 0.28, 0.03, steel)
  } else if (kind === 'rifle') {
    bx(0.06, 0.5, 0.09, 0.22, 0.02, dark); bx(0.045, 0.32, 0.045, 0.62, 0.03, steel); bx(0.05, 0.12, 0.16, 0.3, -0.1, dark)
    bx(0.05, 0.28, 0.11, -0.16, 0.0, wood); bx(0.03, 0.08, 0.05, 0.3, 0.08, steel); bx(0.025, 0.05, 0.05, 0.74, 0.07, steel); bx(0.05, 0.14, 0.05, 0.12, -0.07, wood)
  } else {
    bx(0.06, 0.72, 0.09, 0.3, 0.02, wood); bx(0.04, 0.55, 0.04, 0.9, 0.03, steel); bx(0.06, 0.3, 0.11, -0.2, 0.0, wood)
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.34, 10), dark); scope.position.set(0, -0.6 - 0.35, 0.115); g.add(scope)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 })); lens.position.set(0, -0.6 - 0.53, 0.115); g.add(lens)
    bx(0.02, 0.18, 0.12, 0.8, -0.09, steel, 0.04); bx(0.02, 0.18, 0.12, 0.8, -0.09, steel, -0.04)
  }
  return g
}

/** Hat das Modell eine Waffe in der Hand, den rechten Arm nach vorn strecken (nach `poseWalker` aufrufen). */
export function armUp(m: T.Group): void {
  if (!m.userData.gunned) return
  const a = m.userData.armR as T.Group | undefined
  if (a) a.rotation.x = -1.5
}
