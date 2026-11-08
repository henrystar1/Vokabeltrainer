import type { RecentBuy } from '../../services/plus'

const PRO = [
  (n: string) => `${n} hatte zu viele Coins und hat sich Pro gegönnt.`,
  (n: string) => `${n} schwimmt in Coins und kauft sich Pro. Luxus!`,
  (n: string) => `${n} hat den Geldbeutel ausgeschüttelt: Pro ist drin.`,
  (n: string) => `${n}: „Plus war gestern.“ Jetzt gibt es Pro!`,
  (n: string) => `${n} gönnt sich Pro. Im Parkour wird jetzt nicht mehr gelernt.`,
  (n: string) => `${n} hat den Pro-Knopf gedrückt. Mutig!`,
]
const PLUS = [
  (n: string) => `${n} hat Coins ausgegeben und Plus geholt.`,
  (n: string) => `${n} gönnt sich Plus. Fancy!`,
  (n: string) => `${n} wollte mehr Coins und kauft dafür Plus.`,
  (n: string) => `${n} hat Plus gekauft. Die Coins brannten schon im Geldbeutel.`,
  (n: string) => `${n} ist jetzt Plus. Applaus!`,
]
const LIFE = [
  (n: string, pro: boolean) => `${n} hat sich ${pro ? 'Pro' : 'Plus'} für IMMER gekauft. Respekt!`,
  (n: string, pro: boolean) => `${n} bleibt ${pro ? 'Pro' : 'Plus'} bis ans Ende der Zeit. Wow.`,
]

/** Lustiger Satz zu einem Kauf. Pro Kauf immer derselbe Satz (hängt nur von der Kauf-Nummer ab). */
export function buyJoke(b: Pick<RecentBuy, 'id' | 'name' | 'pro' | 'days'>): string {
  const i = Math.abs(Math.trunc(b.id))
  if (b.days >= 36500) return LIFE[i % LIFE.length](b.name, b.pro)
  const list = b.pro ? PRO : PLUS
  return list[i % list.length](b.name)
}

/** „vor 5 Min.“ */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 90) return 'gerade eben'
  const m = Math.round(s / 60)
  if (m < 60) return `vor ${m} Min.`
  const h = Math.round(m / 60)
  if (h < 36) return `vor ${h} Std.`
  return `vor ${Math.round(h / 24)} Tagen`
}
