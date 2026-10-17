/** Klicker: jeder Klick bringt 0,1 Punkte, gewertet werden aber nur gerade ganze Zahlen (2, 4, 6 …). */
export const CLICKER_SECONDS = 30
export const CLICKS_PER_POINT = 10

/** Gesammelte Punkte mit einer Nachkommastelle (Klicks / 10). */
export const clickerRaw = (clicks: number): number => clicks / CLICKS_PER_POINT

/** Gewertet: die größte gerade ganze Zahl, die ≤ den gesammelten Punkten ist. */
export const clickerScore = (clicks: number): number => 2 * Math.floor(clicks / (CLICKS_PER_POINT * 2))

/** Klicks bis zum nächsten gewerteten Stand. */
export const clicksToNext = (clicks: number): number => CLICKS_PER_POINT * 2 - (clicks % (CLICKS_PER_POINT * 2))
