import type * as T from 'three'

type THREE = typeof T

/** KSK-Quad: Geländequad mit Gitterrohrrahmen, Stollenreifen, Federbeinen, Stoßfänger, Doppelsitz und einer Minigun auf dem Heck.
 *  Vorne ist +z. userData: wheels (name front/rear), barrels (dreht beim Schießen), gunYaw (Geschützdrehkranz), rider (Fahrerfigur, ausblendbar), rider2 (Beifahrer), len, wid. */
export const QUAD_LEN = 2.8
export const QUAD_WID = 1.6

export function makeQuadModel(THREE: THREE, color?: string): T.Group {
  const g = new THREE.Group()
  const m = (c: number, rough = 0.6, metal = 0.2, emissive = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, emissive, emissiveIntensity: emissive ? 1.2 : 0 })
  const paintC = color && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== '#f8fafc' ? new THREE.Color(color).getHex() : 0x3d4a32
  const paint = m(paintC, 0.45, 0.3), dark = m(0x14161b, 0.8, 0.2), steel = m(0x6b7280, 0.35, 0.8), black = m(0x0b0d10, 0.5, 0.5), rubber = m(0x0f1012, 0.95, 0), tan = m(0x8a7a52, 0.7, 0.1)
  const glass = m(0x38bdf8, 0.15, 0.6, 0x0c4a6e), lamp = m(0xfff7d6, 0.2, 0.2, 0xffe08a), red = m(0xdc2626, 0.3, 0.2, 0x991b1b), warn = m(0xfacc15, 0.5, 0.1)
  const box = (w: number, h: number, d: number, mt: T.Material, x: number, y: number, z: number, p: T.Object3D = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt); b.position.set(x, y, z); p.add(b); return b }
  const cyl = (r0: number, r1: number, len: number, mt: T.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', p: T.Object3D = g, seg = 12) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mt)
    if (axis === 'z') c.rotation.x = Math.PI / 2; else if (axis === 'x') c.rotation.z = Math.PI / 2
    c.position.set(x, y, z); p.add(c); return c
  }
  /** Rohr von A nach B */
  const tube = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mt: T.Material, p: T.Object3D = g) => {
    const len = Math.hypot(bx - ax, by - ay, bz - az)
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mt)
    c.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, by - ay, bz - az).normalize())
    p.add(c); return c
  }
  // ── Rahmen: Bodenwanne, Längsholme, Querstreben, Käfig ──
  box(1.0, 0.12, 2.3, black, 0, 0.42, 0)
  box(0.9, 0.05, 1.5, steel, 0, 0.34, 0.1) // Unterfahrschutz
  for (const sx of [-1, 1]) {
    tube(sx * 0.5, 0.55, -1.15, sx * 0.5, 0.55, 1.15, 0.045, steel)
    tube(sx * 0.5, 0.55, 1.15, sx * 0.42, 0.95, 0.55, 0.04, steel)
    tube(sx * 0.5, 0.55, -1.0, sx * 0.4, 1.0, -0.7, 0.04, steel)
    tube(sx * 0.42, 0.95, 0.55, sx * 0.4, 1.0, -0.7, 0.035, steel)
  }
  for (const z of [-1.0, -0.2, 0.7]) tube(-0.5, 0.55, z, 0.5, 0.55, z, 0.035, steel)
  // ── Karosserie: Bug, Kotflügel, Tank, Seitenverkleidung ──
  const nose = box(0.95, 0.26, 0.8, paint, 0, 0.78, 1.0); nose.rotation.x = -0.18
  box(0.7, 0.14, 0.5, paint, 0, 0.9, 0.72)
  box(0.9, 0.3, 0.55, paint, 0, 0.95, 0.15) // Tank
  box(0.5, 0.05, 0.4, tan, 0, 1.11, 0.15)
  for (const sx of [-1, 1]) {
    box(0.12, 0.34, 1.5, paint, sx * 0.52, 0.72, -0.1) // Seitenverkleidung
    box(0.1, 0.05, 1.3, tan, sx * 0.58, 0.55, -0.1) // Trittbrett-Kante
    box(0.5, 0.05, 1.2, black, sx * 0.72, 0.52, -0.1) // Trittbrett
    // Kotflügel über den Rädern
    for (const wz of [1.0, -0.95]) { const f = box(0.52, 0.06, 0.9, paint, sx * 0.78, 0.98, wz); f.rotation.x = wz > 0 ? -0.12 : 0.12 }
  }
  // ── Front: Bullbar, Scheinwerfer, LED-Balken, Winde ──
  box(0.9, 0.08, 0.1, steel, 0, 0.62, 1.55)
  for (const sx of [-1, 1]) { tube(sx * 0.42, 0.62, 1.5, sx * 0.45, 0.98, 1.38, 0.04, steel); tube(sx * 0.42, 0.62, 1.55, sx * 0.1, 0.62, 1.55, 0.035, steel) }
  tube(-0.45, 0.98, 1.38, 0.45, 0.98, 1.38, 0.04, steel)
  box(0.34, 0.12, 0.12, black, 0, 0.72, 1.5); cyl(0.07, 0.07, 0.2, dark, 0, 0.72, 1.57, 'z')
  for (const sx of [-1, 1]) { box(0.2, 0.13, 0.08, lamp, sx * 0.32, 0.9, 1.4); box(0.24, 0.17, 0.05, black, sx * 0.32, 0.9, 1.36) }
  box(0.7, 0.05, 0.06, lamp, 0, 1.06, 0.98) // LED-Balken
  for (const sx of [-1, 1]) box(0.08, 0.06, 0.05, warn, sx * 0.5, 0.72, 1.56)
  // ── Lenker, Instrumente, Spiegel, Bremshebel ──
  const bar = new THREE.Group(); bar.position.set(0, 1.12, 0.5); g.add(bar)
  cyl(0.03, 0.03, 0.9, steel, 0, 0, 0, 'x', bar)
  tube(0, -0.1, 0.05, 0, 0.0, 0.0, 0.03, steel, bar)
  for (const sx of [-1, 1]) {
    cyl(0.04, 0.04, 0.16, rubber, sx * 0.48, 0, 0, 'x', bar) // Griff
    box(0.03, 0.03, 0.16, steel, sx * 0.4, 0.02, 0.1, bar) // Hebel
    const mir = box(0.1, 0.07, 0.015, black, sx * 0.52, 0.2, -0.04, bar); mir.rotation.y = sx * 0.3
    tube(sx * 0.46, 0.02, 0, sx * 0.52, 0.18, -0.04, 0.012, steel, bar)
    box(0.12, 0.05, 0.14, paint, sx * 0.32, -0.02, 0.07, bar) // Handprotektor
  }
  box(0.2, 0.1, 0.06, black, 0, 0.1, 0.06, bar); box(0.17, 0.07, 0.01, glass, 0, 0.1, 0.095, bar) // Display
  cyl(0.06, 0.06, 0.14, steel, 0, -0.15, -0.02, 'y', bar) // Lenksäule
  // ── Doppelsitz (Fahrer, Beifahrer erhöht) ──
  box(0.5, 0.12, 0.62, dark, 0, 0.98, -0.28); box(0.46, 0.05, 0.55, black, 0, 1.05, -0.28)
  box(0.46, 0.14, 0.5, dark, 0, 1.1, -0.9); box(0.42, 0.05, 0.44, black, 0, 1.18, -0.9)
  box(0.46, 0.34, 0.08, dark, 0, 1.3, -1.18) // Rückenlehne
  // ── Heck: Gepäckträger, Munitionskisten, Rücklichter, Auspuff, Antenne ──
  box(1.0, 0.05, 0.7, black, 0, 0.98, -1.25)
  for (const sx of [-1, 1]) {
    tube(sx * 0.45, 0.98, -1.55, sx * 0.45, 0.98, -0.95, 0.03, steel)
    box(0.18, 0.1, 0.05, red, sx * 0.4, 0.92, -1.62)
    box(0.26, 0.2, 0.34, tan, sx * 0.62, 0.8, -1.1) // Seitenkiste
    box(0.28, 0.03, 0.36, dark, sx * 0.62, 0.91, -1.1)
  }
  cyl(0.05, 0.04, 0.5, steel, 0.46, 0.64, -1.2, 'z'); cyl(0.045, 0.045, 0.09, black, 0.46, 0.64, -1.5, 'z') // Auspuff
  tube(-0.5, 1.0, -1.45, -0.55, 2.0, -1.5, 0.008, steel); box(0.03, 0.03, 0.03, red, -0.55, 2.02, -1.5) // Antenne
  // ── Räder: Stollenreifen, Felgen, Bremsscheibe, Federbein ──
  const wheels: T.Group[] = []
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const w = new THREE.Group(); w.position.set(sx * 0.82, 0.42, sz * 0.98); w.name = sz > 0 ? 'front' : 'rear'
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 18), rubber); tire.rotation.z = Math.PI / 2; w.add(tire)
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const k = box(0.38, 0.05, 0.07, rubber, 0, Math.sin(a) * 0.43, Math.cos(a) * 0.43, w); k.rotation.x = -a } // Stollen
    cyl(0.25, 0.25, 0.38, steel, 0, 0, 0, 'x', w, 14); cyl(0.12, 0.12, 0.4, dark, 0, 0, 0, 'x', w)
    for (let i = 0; i < 5; i++) { const sp = box(0.39, 0.04, 0.22, black, 0, 0, 0, w); sp.rotation.x = (i / 5) * Math.PI }
    cyl(0.06, 0.06, 0.42, warn, 0, 0, 0, 'x', w, 8)
    g.add(w); wheels.push(w)
    cyl(0.17, 0.17, 0.02, steel, sx * 0.62, 0.42, sz * 0.98, 'x', g, 14) // Bremsscheibe
    tube(sx * 0.62, 0.42, sz * 0.98, sx * 0.46, 0.62, sz * 0.8, 0.035, steel) // Querlenker
    tube(sx * 0.58, 0.48, sz * 0.98, sx * 0.5, 0.96, sz * 0.9, 0.04, warn) // Federbein
    cyl(0.05, 0.05, 0.28, black, sx * 0.55, 0.72, sz * 0.94, 'y', g, 8)
  }
  g.userData.wheels = wheels
  // ── Minigun auf dem Heck: Drehkranz, Lafette, Schild, Rohrbündel, Munitionsgurt ──
  const ring = new THREE.Group(); ring.position.set(0, 1.05, -1.25); g.add(ring)
  cyl(0.26, 0.3, 0.1, steel, 0, 0, 0, 'y', ring, 16)
  cyl(0.1, 0.12, 0.7, dark, 0, 0.4, 0, 'y', ring, 10) // Säule
  const gunYaw = new THREE.Group(); gunYaw.position.y = 0.78; ring.add(gunYaw)
  const mini = new THREE.Group(); gunYaw.add(mini)
  const pods = new THREE.Group(); pods.visible = false; gunYaw.add(pods)
  box(0.36, 0.3, 0.5, black, 0, 0, 0, mini); box(0.4, 0.08, 0.56, steel, 0, 0.16, 0, mini)
  box(0.34, 0.2, 0.3, tan, 0.28, -0.1, -0.1, mini) // Munitionskasten
  const belt = new THREE.Group(); mini.add(belt)
  for (let i = 0; i < 6; i++) box(0.05, 0.05, 0.05, warn, 0.2 + i * 0.01, -0.02 + i * 0.015, -0.08 + i * 0.02, belt)
  box(0.03, 0.4, 0.5, steel, 0, 0.08, 0.4, mini) // Schutzschild
  const barrels = new THREE.Group(); barrels.position.set(0, 0, 0.3); mini.add(barrels)
  cyl(0.07, 0.07, 0.9, dark, 0, 0, 0.3, 'z', barrels, 10)
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(0.022, 0.022, 0.95, steel, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.32, 'z', barrels, 6) }
  for (const z of [0.0, 0.35, 0.75]) cyl(0.12, 0.12, 0.04, steel, 0, 0, z, 'z', barrels, 12)
  cyl(0.06, 0.06, 0.14, warn, 0, 0, 0.82, 'z', mini, 10) // Mündungsring
  const muz = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9 }))
  muz.position.set(0, 0, 1.35); muz.visible = false; gunYaw.add(muz)
  tube(0.2, 0.0, -0.2, 0.2, 0.0, 0.25, 0.02, steel, mini); tube(-0.2, 0.0, -0.2, -0.2, 0.0, 0.25, 0.02, steel, mini) // Griffe
    // Raketenwerfer (Alternative zur Minigun): zwei Rohrpakete mit je 6 Raketen
  for (const sx of [-1, 1]) {
    box(0.42, 0.34, 0.9, steel, sx * 0.3, 0.05, 0.25, pods); box(0.46, 0.04, 0.94, black, sx * 0.3, 0.24, 0.25, pods)
    for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) { cyl(0.065, 0.065, 1.0, dark, sx * 0.3 + (a - 1) * 0.12, b * 0.14 - 0.02, 0.3, 'z', pods, 8); cyl(0.04, 0.04, 0.06, red, sx * 0.3 + (a - 1) * 0.12, b * 0.14 - 0.02, 0.84, 'z', pods, 6) }
  }
  box(0.5, 0.2, 0.4, black, 0, -0.05, -0.1, pods)
  g.userData.setWeapon = (w: string) => { mini.visible = w !== 'rocket'; pods.visible = w === 'rocket' }
  g.userData.barrels = barrels; g.userData.gunYaw = gunYaw; g.userData.muzzle = muz
  // ── KSK-Fahrer und Beifahrer (einfache sitzende Figuren; der eigene Fahrer wird durch die Skin-Figur ersetzt) ──
  const rider = (zSeat: number, ySeat: number): T.Group => {
    const r = new THREE.Group(); r.position.set(0, ySeat, zSeat)
    const suit = m(0x1c231a, 0.8), vestM = m(0x0f1410, 0.6, 0.3), skinM = m(0xe8b896, 0.8)
    box(0.46, 0.55, 0.28, suit, 0, 0.42, 0, r); box(0.5, 0.44, 0.3, vestM, 0, 0.5, 0.01, r); box(0.34, 0.14, 0.05, tan, 0, 0.42, 0.17, r)
    box(0.3, 0.3, 0.3, skinM, 0, 0.92, 0.0, r)
    box(0.36, 0.26, 0.38, black, 0, 1.0, 0, r); box(0.3, 0.1, 0.04, glass, 0, 0.96, 0.2, r); box(0.34, 0.12, 0.32, black, 0, 0.84, 0.02, r)
    for (const sx of [-1, 1]) {
      const leg = box(0.2, 0.2, 0.7, suit, sx * 0.2, 0.0, 0.25, r); leg.rotation.x = 0.1
      box(0.2, 0.3, 0.2, suit, sx * 0.22, -0.18, 0.62, r); box(0.22, 0.12, 0.32, black, sx * 0.22, -0.36, 0.7, r) // Unterschenkel + Stiefel
      const arm = box(0.12, 0.12, 0.62, suit, sx * 0.34, 0.55, 0.38, r); arm.rotation.x = zSeat > -0.5 ? 0.15 : 0.5
      box(0.13, 0.13, 0.13, black, sx * 0.34, 0.5, 0.7, r)
    }
    return r
  }
  const r1 = rider(-0.28, 1.0), r2 = rider(-0.9, 1.12); r2.visible = false
  g.add(r1, r2); g.userData.rider = r1; g.userData.rider2 = r2
  // Bodenschatten
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.4), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false }))
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; g.add(sh)
  g.userData.len = QUAD_LEN; g.userData.wid = QUAD_WID; g.userData.wheelR = 0.42
  return g
}

/** Sitzhaltung für eine Figur (Skin-Figur) auf dem Quad: Beine nach vorn gewinkelt, Arme zum Lenker bzw. zur Minigun */
export function seatWalker(w: T.Group, zSeat = -0.28, ySeat = 0.62): void {
  w.position.set(0, ySeat, zSeat)
  const u = w.userData as Record<string, T.Group>
  if (u.legL) { u.legL.rotation.x = -1.35; u.legR.rotation.x = -1.35 }
  if (u.armL) { u.armL.rotation.x = -1.25; u.armR.rotation.x = -1.25 }
}

/** Heckwaffe des Quads umschalten: 'minigun' oder 'rocket' */
export function setQuadWeapon(g: T.Group, weapon: string): void {
  const f = g.userData.setWeapon as ((w: string) => void) | undefined
  f?.(weapon); g.userData.weapon = weapon
}
