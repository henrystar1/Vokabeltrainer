import type * as T from 'three'
type THREE = typeof import('three')

/** Spielfigur (Blickrichtung +z, Ursprung an den Füßen): Beine, Arme, Rumpf, Kopf – aus einfachen Quadern. */
export function makeWalkerModel(THREE: THREE, shirt: string, pants = '#1f2937'): T.Group {
  const g = new THREE.Group()
  const mat = (c: string | number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
  const skin = mat('#e8b896'), top = mat(shirt), leg = mat(pants)
  const part = (w: number, h: number, d: number, m: T.Material, x: number, y: number, z: number, pivotY = 0) => {
    const holder = new THREE.Group(); holder.position.set(x, y, z)
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.y = pivotY; holder.add(b); g.add(holder); return holder
  }
  const body = part(0.5, 0.65, 0.28, top, 0, 1.12, 0)
  void body
  const head = part(0.3, 0.3, 0.3, skin, 0, 1.62, 0)
  void head
  g.userData.legL = part(0.2, 0.75, 0.22, leg, -0.14, 0.78, 0, -0.38)
  g.userData.legR = part(0.2, 0.75, 0.22, leg, 0.14, 0.78, 0, -0.38)
  g.userData.armL = part(0.14, 0.62, 0.16, top, -0.35, 1.4, 0, -0.28)
  g.userData.armR = part(0.14, 0.62, 0.16, top, 0.35, 1.4, 0, -0.28)
  const pivot = new THREE.Group(); pivot.add(g)
  pivot.userData = g.userData
  return pivot
}

/** Haltung: Laufphase `ph`, Tempo `sp` (m/s); umgeworfen (`stun` > 0) liegt die Figur, in der Luft (`air`) kippt sie nach hinten. */
export function poseWalker(m: T.Group, ph: number, sp: number, stun: number, air: boolean): void {
  const u = m.userData as Record<string, T.Group>
  const sw = Math.sin(ph) * Math.min(1, sp / 3.5) * 0.9
  u.legL.rotation.x = sw; u.legR.rotation.x = -sw
  u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8
  const inner = m.children[0] as T.Group
  inner.rotation.order = 'YXZ'
  const lie = stun > 0 ? Math.min(1, stun * 3) : 0
  inner.rotation.x = air ? -0.9 : -lie * 1.45
  inner.position.y = lie * 0.18
  if (lie > 0 || air) { u.legL.rotation.x = 0.4; u.legR.rotation.x = -0.3; u.armL.rotation.x = -2.2; u.armR.rotation.x = -1.8 }
}
