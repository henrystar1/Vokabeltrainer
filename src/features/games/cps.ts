/** CPS-Test: 10 Sekunden klicken. Gewertet wird die höchste Klickzahl innerhalb einer Sekunde (= beste CPS). */
export const CPS_SECONDS = 10
export const CPS_WINDOW_MS = 1000

/** Größte Anzahl Klicks in irgendeinem Fenster von 1 Sekunde (Zeitstempel in ms, aufsteigend). */
export function peakCps(times: number[]): number {
  let best = 0
  let lo = 0
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] >= CPS_WINDOW_MS) lo++
    best = Math.max(best, hi - lo + 1)
  }
  return best
}

/** Klicks in der letzten Sekunde bis `now`. */
export function currentCps(times: number[], now: number): number {
  let n = 0
  for (let i = times.length - 1; i >= 0 && now - times[i] < CPS_WINDOW_MS; i--) n++
  return n
}
