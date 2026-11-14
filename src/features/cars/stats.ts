/** Fahrwerte je Fahrzeugart (Höchstgeschwindigkeit in km/h, Beschleunigung m/s², Lenkung, Bremse). Gemeinsam für Shop, Rennen und Bots. */
export interface KindStats { kmh: number; acc: number; turn: number; brake: number }
export const KIND_STATS: Record<string, KindStats> = {
  bus: { kmh: 130, acc: 10, turn: 1.25, brake: 26 },
  oldtimer: { kmh: 120, acc: 9, turn: 1.6, brake: 24 },
  kleinwagen: { kmh: 150, acc: 15, turn: 1.9, brake: 34 },
  monstertruck: { kmh: 150, acc: 13, turn: 1.45, brake: 28 },
  pickup: { kmh: 165, acc: 14, turn: 1.5, brake: 30 },
  suv: { kmh: 170, acc: 15, turn: 1.55, brake: 32 },
  kombi: { kmh: 175, acc: 15, turn: 1.7, brake: 33 },
  limousine: { kmh: 180, acc: 16, turn: 1.7, brake: 34 },
  buggy: { kmh: 185, acc: 19, turn: 2.1, brake: 34 },
  cabrio: { kmh: 210, acc: 18, turn: 1.85, brake: 36 },
  muscle: { kmh: 225, acc: 21, turn: 1.7, brake: 36 },
  rallye: { kmh: 235, acc: 22, turn: 2.1, brake: 40 },
  sportwagen: { kmh: 240, acc: 22, turn: 2.0, brake: 40 },
  gt: { kmh: 270, acc: 25, turn: 2.0, brake: 44 },
  hypercar: { kmh: 300, acc: 29, turn: 2.0, brake: 48 },
  rennwagen: { kmh: 320, acc: 33, turn: 2.2, brake: 52 },
  roadster: { kmh: 290, acc: 31, turn: 2.1, brake: 48 },
  supercar: { kmh: 330, acc: 31, turn: 2.1, brake: 50 },
  chopper: { kmh: 190, acc: 17, turn: 2.1, brake: 30 },
  crossbike: { kmh: 175, acc: 24, turn: 2.7, brake: 34 },
  sportbike: { kmh: 260, acc: 30, turn: 2.6, brake: 44 },
}
export const kindStats = (kind: string): KindStats => KIND_STATS[kind] ?? KIND_STATS.kleinwagen
/** Tatsächliche Höchstgeschwindigkeit eines Autos: eigener Wert aus dem Shop, sonst der der Art. */
export const carKmh = (kind: string, kmh?: number | null): number => (kmh && kmh > 0 ? kmh : kindStats(kind).kmh)

/** Abmessungen der Karosserie in Metern (Länge × Breite) – gleiche Werte wie im 3D-Modell, dienen als Hitbox. */
export const KIND_DIMS: Record<string, { len: number; wid: number }> = {
  kleinwagen: { len: 3.9, wid: 1.8 }, limousine: { len: 4.8, wid: 1.9 }, kombi: { len: 4.8, wid: 1.9 }, suv: { len: 4.7, wid: 2.0 },
  pickup: { len: 5.3, wid: 2.0 }, cabrio: { len: 4.3, wid: 1.85 }, sportwagen: { len: 4.5, wid: 1.95 }, bus: { len: 6.6, wid: 2.2 },
  oldtimer: { len: 4.4, wid: 1.8 }, buggy: { len: 3.4, wid: 1.9 }, monstertruck: { len: 4.8, wid: 2.4 }, muscle: { len: 4.9, wid: 1.95 },
  rallye: { len: 4.1, wid: 1.85 }, gt: { len: 4.7, wid: 2.0 }, hypercar: { len: 4.6, wid: 2.05 }, rennwagen: { len: 5.0, wid: 2.0 },
  roadster: { len: 4.2, wid: 1.85 }, supercar: { len: 4.5, wid: 1.85 },
  chopper: { len: 2.6, wid: 0.9 }, crossbike: { len: 2.1, wid: 0.8 }, sportbike: { len: 2.1, wid: 0.8 },
}
export const kindDims = (kind: string): { len: number; wid: number } => KIND_DIMS[kind] ?? KIND_DIMS.kleinwagen

/** Motorräder: legen sich in die Kurve (Modell und Kamera). */
export const BIKE_KINDS = ['chopper', 'crossbike', 'sportbike']
export const isBike = (kind: string): boolean => BIKE_KINDS.includes(kind)
/** Nur der Roadster kann kurz fliegen (2 s, danach 20 s laden). */
export const canFly = (kind: string): boolean => kind === 'roadster'
export const FLY_SECONDS = 2
export const FLY_COOLDOWN = 20
/** Höhe über der Straße (m) bei noch `left` Sekunden Flug: sanft hoch, oben halten, sanft runter. */
export const flyHeight = (left: number): number => {
  if (left <= 0) return 0
  const up = Math.min(1, (FLY_SECONDS - left) / 0.45), down = Math.min(1, left / 0.45)
  const k = Math.max(0, Math.min(up, down))
  return 6.5 * k * k * (3 - 2 * k)
}

/** Das Admin-Supercar: virtuelles Auto (nicht im Shop), rot, Tempo stellt der Admin ein (Standard 700 km/h). */
export const SUPERCAR_ID = 'supercar'
export const SUPERCAR = { id: SUPERCAR_ID, name: 'Admin-Hyperion', kind: 'supercar', color: '#dc2626', top: 700 }
