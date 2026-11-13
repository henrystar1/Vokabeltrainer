/** Reine Logik rund um die Chips (getestet in chipLogic.test.ts). */

/** Erkennt die Fehlermeldung der Sperre nach drei Verlusten. */
export const isPurseError = (e: unknown): boolean => /Portemonnaie/i.test(e instanceof Error ? e.message : String(e ?? ''))

/** Verlustserie im Client: nur ein Hinweis, wann der Server nach der Sperre gefragt werden soll (der Server entscheidet). */
export function nextLossRun(run: number, before: number, after: number): number {
  return after < before ? run + 1 : 0
}

/** Wie viele Chips lassen sich mit dem Rest-Kauflimit und den Coins höchstens kaufen? */
export function maxBuyable(coins: number, rate: number, buyLeft: number): number {
  if (rate < 1) return 0
  return Math.max(0, Math.min(Math.floor(coins / rate), buyLeft))
}

/** Restsekunden der Sperre (aufgerundet, nie negativ). */
export const lockSeconds = (untilMs: number, nowMs: number): number => Math.max(0, Math.ceil((untilMs - nowMs) / 1000))
