import type * as T from 'three'
import { BIKE_KINDS, CUSTOM_FLY, KIND_DIMS, KIND_STATS } from './stats'

/**
 * Eigene Autos: Der Admin lässt eine KI einen Bauplan als JSON schreiben und fügt ihn ein.
 * Der Bauplan besteht nur aus Zahlen und einfachen Formen (kein ausführbarer Code), wird streng geprüft und im Spiel gezeichnet.
 */
export type PartKind = 'box' | 'cyl' | 'sph' | 'cone'
export interface SpecPart { t: PartKind; p: [number, number, number]; s: [number, number, number]; r?: [number, number, number]; c?: string; round?: number }
export interface SpecWheel { x: number; z: number; r: number; w?: number }
export interface CarSpec {
  len: number; wid: number
  bike?: boolean; fly?: boolean
  /** Fahrwerte (km/h wird beim Speichern aus dem Preisfeld des Admins übernommen) */
  kmh?: number; acc?: number; turn?: number; brake?: number
  wheels: SpecWheel[]
  parts: SpecPart[]
}

const MAX_PARTS = 160
const num = (v: unknown, lo: number, hi: number, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name}: Zahl erwartet`)
  if (v < lo || v > hi) throw new Error(`${name}: ${v} liegt nicht zwischen ${lo} und ${hi}`)
  return v
}
const vec = (v: unknown, lo: number, hi: number, name: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${name}: [x, y, z] erwartet`)
  return [num(v[0], lo, hi, name), num(v[1], lo, hi, name), num(v[2], lo, hi, name)]
}
const COLORS = new Set(['paint', 'paint2', 'dark', 'glass', 'chrome', 'light', 'tail', 'white', 'black'])

/** Prüft einen eingefügten Bauplan (auch mit ```json-Zaun) und gibt ihn bereinigt zurück. */
export function parseCarSpec(text: string): { ok: true; spec: CarSpec } | { ok: false; error: string } {
  try {
    const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const j = JSON.parse(raw) as Record<string, unknown>
    if (!j || typeof j !== 'object') throw new Error('Objekt erwartet')
    const len = num(j.len, 1.5, 12, 'len'), wid = num(j.wid, 0.5, 4, 'wid')
    if (!Array.isArray(j.parts) || j.parts.length < 1 || j.parts.length > MAX_PARTS) throw new Error(`parts: 1 bis ${MAX_PARTS} Teile erwartet`)
    if (!Array.isArray(j.wheels) || j.wheels.length < 2 || j.wheels.length > 8) throw new Error('wheels: 2 bis 8 Räder erwartet')
    const parts: SpecPart[] = j.parts.map((q, i) => {
      const o = q as Record<string, unknown>
      const n = `parts[${i}]`
      if (o.t !== 'box' && o.t !== 'cyl' && o.t !== 'sph' && o.t !== 'cone') throw new Error(`${n}.t: box, cyl, sph oder cone erwartet`)
      let c = typeof o.c === 'string' ? o.c : 'paint'
      if (!COLORS.has(c) && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error(`${n}.c: unbekannte Farbe ${c}`)
      c = c.toLowerCase()
      const part: SpecPart = { t: o.t, p: vec(o.p, -8, 8, `${n}.p`), s: vec(o.s, 0.01, 12, `${n}.s`), c }
      if (o.r !== undefined) part.r = vec(o.r, -360, 360, `${n}.r`)
      if (o.round !== undefined) part.round = num(o.round, 0, 1, `${n}.round`)
      return part
    })
    const wheels: SpecWheel[] = j.wheels.map((q, i) => {
      const o = q as Record<string, unknown>
      const n = `wheels[${i}]`
      return { x: num(o.x, -3, 3, `${n}.x`), z: num(o.z, -6, 6, `${n}.z`), r: num(o.r, 0.12, 1.2, `${n}.r`), w: o.w === undefined ? 0.3 : num(o.w, 0.05, 1, `${n}.w`) }
    })
    const spec: CarSpec = { len, wid, wheels, parts, bike: j.bike === true, fly: j.fly === true }
    for (const k of ['kmh', 'acc', 'turn', 'brake'] as const) if (j[k] !== undefined) spec[k] = num(j[k], 0.1, 1000, k)
    return { ok: true, spec }
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? 'Das ist kein gültiges JSON.' : (e as Error).message }
  }
}

const REG = new Map<string, CarSpec>()
/** Bauplan zu einer Fahrzeugart `c_<id>` (z. B. aus der Autoliste) im Spiel bekannt machen. */
export function registerCustom(kind: string, spec: CarSpec, kmh?: number | null): void {
  REG.set(kind, spec)
  const k = KIND_STATS.kleinwagen
  KIND_STATS[kind] = { kmh: kmh && kmh > 0 ? kmh : spec.kmh ?? 200, acc: spec.acc ?? (spec.bike ? 24 : 20), turn: spec.turn ?? (spec.bike ? 2.4 : k.turn), brake: spec.brake ?? 40 }
  KIND_DIMS[kind] = { len: spec.len, wid: spec.wid }
  const bi = BIKE_KINDS.indexOf(kind)
  if (spec.bike && bi < 0) BIKE_KINDS.push(kind)
  if (!spec.bike && bi >= 0) BIKE_KINDS.splice(bi, 1)
  if (spec.fly) CUSTOM_FLY.add(kind); else CUSTOM_FLY.delete(kind)
}
export const getSpec = (kind: string): CarSpec | undefined => REG.get(kind)
/** Alle eigenen Autos einer Autoliste registrieren (ungültige werden still übersprungen). */
export function registerCustomRows(rows: Array<{ kind: string; spec?: unknown; top_kmh?: number | null }>): void {
  for (const r of rows) {
    if (!r.spec || !r.kind.startsWith('c_')) continue
    const p = parseCarSpec(JSON.stringify(r.spec))
    if (p.ok) registerCustom(r.kind, p.spec, r.top_kmh)
  }
}

/** Das Auto aus dem Bauplan als 3D-Gruppe (Blickrichtung +z, Boden bei y = 0), mit den Daten, die Rennen und Schaden brauchen. */
export function buildSpecCar(THREE: typeof import('three'), spec: CarSpec, color: string): T.Group {
  const g = new THREE.Group()
  const lean = new THREE.Group(); g.add(lean)
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 })
  const paint0 = new THREE.Color(color)
  const mats: Record<string, T.Material> = {
    paint,
    paint2: new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.4, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.7 }),
    black: new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x15202e, roughness: 0.05, metalness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.15, metalness: 1 }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  }
  const matFor = (c: string): T.Material => mats[c] ?? (mats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.3 }))
  let body: T.Mesh | undefined
  for (const q of spec.parts) {
    let geo: T.BufferGeometry
    if (q.t === 'box') geo = new THREE.BoxGeometry(q.s[0], q.s[1], q.s[2])
    else if (q.t === 'cyl') geo = new THREE.CylinderGeometry(q.s[0], q.s[0], q.s[1], 20)
    else if (q.t === 'cone') geo = new THREE.CylinderGeometry(0.001, q.s[0], q.s[1], 20)
    else { geo = new THREE.SphereGeometry(1, 20, 14); geo.scale(q.s[0], q.s[1], q.s[2]) }
    const m = new THREE.Mesh(geo, matFor(q.c ?? 'paint'))
    m.position.set(...q.p)
    if (q.r) m.rotation.set((q.r[0] * Math.PI) / 180, (q.r[1] * Math.PI) / 180, (q.r[2] * Math.PI) / 180)
    lean.add(m)
    if (!body && (q.c ?? 'paint') === 'paint') body = m
  }
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.25, metalness: 0.9 })
  const wheels: T.Group[] = []
  const zs = spec.wheels.map((w) => w.z)
  const zMid = (Math.max(...zs) + Math.min(...zs)) / 2
  for (const w of spec.wheels) {
    const wg = new THREE.Group()
    const ww = w.w ?? 0.3
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.r, ww, 20), tyre); tr.rotation.z = Math.PI / 2
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.62, w.r * 0.62, ww + 0.02, 12), rim); rm.rotation.z = Math.PI / 2
    wg.add(tr, rm)
    wg.position.set(w.x, w.r, w.z)
    wg.name = w.z >= zMid ? 'front' : 'rear'
    g.add(wg); wheels.push(wg)
  }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(spec.wid * 1.25, spec.len * 1.12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.07
  g.add(sh)
  g.userData.wheels = wheels
  g.userData.wheelR = spec.wheels[0].r
  g.userData.paint = paint
  g.userData.paint0 = paint0
  if (body) g.userData.body = body
  g.userData.len = spec.len
  g.userData.wid = spec.wid
  if (spec.bike) g.userData.lean = lean
  return g
}

/** Anweisung für die KI: beschreibt das Format; `wish` ist die Autobeschreibung des Admins. */
export function carPrompt(wish: string): string {
  return `Du bist 3D-Modellierer für ein kleines Rennspiel. Baue ein Auto aus einfachen Formen und gib NUR ein JSON-Objekt zurück (kein Text drumherum).

Wunsch: ${wish || 'ein cooles, hochwertig aussehendes Auto'}

Koordinaten in Metern: x = nach rechts, y = nach oben (0 = Boden), z = nach VORNE (Fahrtrichtung). Mittelpunkt des Autos = (0, ?, 0).

Format:
{
  "len": 4.5,            // Länge in m (1.5–12)
  "wid": 1.9,            // Breite in m (0.5–4)
  "bike": false,         // true = Motorrad (legt sich in Kurven)
  "wheels": [ {"x": -0.85, "z": 1.4, "r": 0.36, "w": 0.28}, ... ],   // jedes Rad einzeln; z > 0 = Vorderrad (lenkt); r = Radius, w = Breite
  "parts": [ {"t": "box", "p": [0, 0.55, 0], "s": [1.8, 0.4, 4.4], "c": "paint"}, ... ]
}

Teile ("parts", 20–120 Stück):
- "t": "box" (s = [Breite, Höhe, Länge]), "cyl" (s = [Radius, Höhe, -], Zylinder steht senkrecht), "cone" (s = [Radius, Höhe, -]), "sph" (Ellipsoid, s = [rx, ry, rz])
- "p": [x, y, z] Mitte des Teils; "r": [rx, ry, rz] Drehung in Grad (optional; z. B. cyl mit r [0,0,90] liegt quer)
- "c": "paint" (Hauptlack, vom Spieler änderbar – nutze ihn für die Karosserie), "paint2" (dunklerer Lack), "dark", "black", "white", "glass" (Scheiben), "chrome", "light" (Scheinwerfer, vorne bei +z), "tail" (Rücklichter, hinten) oder eine Farbe wie "#ff8800"
Baue: Karosserie unten, Kabine oben, Scheiben, Scheinwerfer, Rücklichter, Spoiler/Lufteinlässe/Details. Alle Teile liegen über dem Boden (y > 0), die Räder berühren den Boden (Radmitte y = Radius). Die Karosserie ist symmetrisch (Teile links UND rechts). Das Auto soll hochwertig und stimmig aussehen.

Gib das fertige JSON zurück.`
}

/** Kleines Beispiel zum Ausprobieren (flacher Sportwagen). */
export const SAMPLE_SPEC = JSON.stringify({
  len: 4.5, wid: 1.9,
  wheels: [{ x: -0.88, z: 1.4, r: 0.36, w: 0.3 }, { x: 0.88, z: 1.4, r: 0.36, w: 0.3 }, { x: -0.88, z: -1.35, r: 0.38, w: 0.34 }, { x: 0.88, z: -1.35, r: 0.38, w: 0.34 }],
  parts: [
    { t: 'box', p: [0, 0.5, 0], s: [1.8, 0.38, 4.4], c: 'paint' },
    { t: 'box', p: [0, 0.82, -0.2], s: [1.5, 0.3, 2.0], c: 'paint' },
    { t: 'box', p: [0, 0.86, 0.55], s: [1.4, 0.22, 0.9], c: 'glass', r: [-18, 0, 0] },
    { t: 'box', p: [0, 0.86, -0.95], s: [1.4, 0.22, 0.6], c: 'glass', r: [22, 0, 0] },
    { t: 'box', p: [0, 1.0, -0.2], s: [1.3, 0.05, 1.1], c: 'paint2' },
    { t: 'box', p: [-0.62, 0.6, 2.2], s: [0.4, 0.14, 0.06], c: 'light' },
    { t: 'box', p: [0.62, 0.6, 2.2], s: [0.4, 0.14, 0.06], c: 'light' },
    { t: 'box', p: [-0.62, 0.62, -2.2], s: [0.45, 0.12, 0.06], c: 'tail' },
    { t: 'box', p: [0.62, 0.62, -2.2], s: [0.45, 0.12, 0.06], c: 'tail' },
    { t: 'box', p: [0, 0.98, -2.0], s: [1.7, 0.06, 0.4], c: 'dark' },
    { t: 'box', p: [-0.7, 0.8, -2.0], s: [0.06, 0.3, 0.3], c: 'dark' },
    { t: 'box', p: [0.7, 0.8, -2.0], s: [0.06, 0.3, 0.3], c: 'dark' },
    { t: 'box', p: [0, 0.3, 2.15], s: [1.5, 0.1, 0.2], c: 'black' },
  ],
})
