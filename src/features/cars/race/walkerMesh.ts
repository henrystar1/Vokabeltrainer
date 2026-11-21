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
export function poseWalker(m: T.Group, ph: number, sp: number, stun: number, air: boolean, punch = 0): void {
  const u = m.userData as Record<string, T.Group>
  const sw = Math.sin(ph) * Math.min(1, sp / 3.5) * 0.9
  u.legL.rotation.x = sw; u.legR.rotation.x = -sw
  u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8
  const inner = m.children[0] as T.Group
  inner.rotation.order = 'YXZ'
  const lie = stun > 0 ? Math.min(1, stun * 3) : 0
  inner.rotation.x = air ? -0.9 : -lie * 1.45
  inner.position.y = lie * 0.18
  if (punch > 0 && punch < 1) {
    // Schlag: rechter Arm schnellt nach vorn, Oberkörper dreht mit, kleiner Ausfallschritt
    const k = Math.sin(punch * Math.PI)
    u.armR.rotation.x = -1.6 * k; u.armR.rotation.z = -0.15 * k
    u.armL.rotation.x = 0.5 * k
    inner.rotation.y = -0.35 * k
    u.legL.rotation.x = -0.45 * k; u.legR.rotation.x = 0.35 * k
  } else { inner.rotation.y = 0; u.armR.rotation.z = 0 }
  if (lie > 0 || air) { u.legL.rotation.x = 0.4; u.legR.rotation.x = -0.3; u.armL.rotation.x = -2.2; u.armR.rotation.x = -1.8 }
}

/** Minecraft-Skin (64×64 oder altes 64×32, als PNG-Daten-URL) auf eine Figur legen. Liefert null, wenn das Bild nicht passt. */
export function skinCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement | null {
  if (w !== 64 || (h !== 64 && h !== 32)) return null
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const g = c.getContext('2d'); if (!g) return null
  g.imageSmoothingEnabled = false
  g.drawImage(img, 0, 0)
  if (h === 32) {
    // altes Format: linkes Bein/Arm sind gespiegelte Kopien der rechten
    const mirror = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => { g.save(); g.translate(dx + sw, dy); g.scale(-1, 1); g.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh); g.restore() }
    const flipPart = (sx: number, sy: number, dx: number, dy: number) => {
      // Teil 16×16 (Beine/Arme: 4×12×4): jede der Seiten einzeln spiegeln, rechts/links vertauschen
      mirror(sx + 4, sy, 4, 4, dx + 4, dy); mirror(sx + 8, sy, 4, 4, dx + 8, dy) // oben/unten
      mirror(sx, sy + 4, 4, 12, dx + 8, dy + 4); mirror(sx + 4, sy + 4, 4, 12, dx + 4, dy + 4); mirror(sx + 8, sy + 4, 4, 12, dx, dy + 4); mirror(sx + 12, sy + 4, 4, 12, dx + 12, dy + 4)
    }
    flipPart(0, 16, 16, 48); flipPart(40, 16, 32, 48)
  }
  return c
}

/** Spielfigur mit Minecraft-Skin (Körperteile als Quader mit den Skin-Flächen) – gleiche Haltung/Animation wie makeWalkerModel */
export function makeSkinWalker(THREE: THREE, canvas: HTMLCanvasElement): T.Group {
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace
  const base = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
  const over = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, transparent: true, alphaTest: 0.1 })
  const px = 0.055
  const g = new THREE.Group()
  /** Quader w×h×d Pixel mit Skin-Fläche ab (u0, v0); `grow` bläht die Außenschicht auf */
  const boxGeo = (w: number, h: number, d: number, u0: number, v0: number, grow = 0) => {
    const geo = new THREE.BoxGeometry((w + grow) * px, (h + grow) * px, (d + grow) * px)
    const rects: Array<[number, number, number, number]> = [
      [u0 + d + w, v0 + d, d, h], // +x (linke Seite der Figur)
      [u0, v0 + d, d, h], // −x
      [u0 + d, v0, w, d], // oben
      [u0 + d + w, v0, w, d], // unten
      [u0 + d, v0 + d, w, h], // vorn (+z)
      [u0 + 2 * d + w, v0 + d, w, h], // hinten
    ]
    const uv = geo.getAttribute('uv') as T.BufferAttribute
    rects.forEach(([x, y, rw, rh], f) => {
      const a = x / 64, b = (x + rw) / 64, t = 1 - y / 64, bt = 1 - (y + rh) / 64
      uv.setXY(f * 4, a, t); uv.setXY(f * 4 + 1, b, t); uv.setXY(f * 4 + 2, a, bt); uv.setXY(f * 4 + 3, b, bt)
    })
    uv.needsUpdate = true
    return geo
  }
  const part = (w: number, h: number, d: number, u0: number, v0: number, ou: number, ov: number, x: number, y: number, pivotY = 0) => {
    const holder = new THREE.Group(); holder.position.set(x, y, 0)
    const m1 = new THREE.Mesh(boxGeo(w, h, d, u0, v0), base); m1.position.y = pivotY; holder.add(m1)
    const m2 = new THREE.Mesh(boxGeo(w, h, d, ou, ov, 1), over); m2.position.y = pivotY; holder.add(m2)
    g.add(holder); return holder
  }
  part(8, 12, 4, 16, 16, 16, 32, 0, 0.72 + 0.33, 0)
  part(8, 8, 8, 0, 0, 32, 0, 0, 1.38 + 0.22, 0)
  g.userData.legL = part(4, 12, 4, 16, 48, 0, 48, 0.11, 0.66, -0.33)
  g.userData.legR = part(4, 12, 4, 0, 16, 0, 32, -0.11, 0.66, -0.33)
  g.userData.armL = part(4, 12, 4, 32, 48, 48, 48, 0.33, 1.38, -0.28)
  g.userData.armR = part(4, 12, 4, 40, 16, 40, 32, -0.33, 1.38, -0.28)
  const pivot = new THREE.Group(); pivot.add(g)
  pivot.userData = g.userData
  return pivot
}
