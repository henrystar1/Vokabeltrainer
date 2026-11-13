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
}
export const kindDims = (kind: string): { len: number; wid: number } => KIND_DIMS[kind] ?? KIND_DIMS.kleinwagen

/** Das Admin-Supercar: virtuelles Auto (nicht im Shop), Höchstgeschwindigkeit 700 km/h. */
export const SUPERCAR_ID = 'supercar'
export const SUPERCAR = { id: SUPERCAR_ID, name: 'Admin-Hyperion', kind: 'hypercar', color: '#facc15', top: 700 }
