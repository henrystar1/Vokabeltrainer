import { describe, expect, it } from 'vitest'
import { hubItemsFor, hubPageFor, navGroupsFor, navItemsFor } from './navigation'

describe('Menü und Lernen-Kacheln', () => {
  it('seltene Übungsarten stehen nicht im Menü, aber als Kachel auf der Lernen-Seite', () => {
    const menu = navItemsFor(false, new Set(), 'fr').map((i) => i.to)
    const hub = hubItemsFor(new Set(), 'fr').map((i) => i.to)
    for (const to of ['/abschreiben', '/crashkurs', '/ueben', '/grammatik', '/unregelmaessig', '/konjugieren', '/genus']) {
      expect(menu).not.toContain(to)
      expect(hub).toContain(to)
    }
    for (const to of ['/lernen', '/buecher', '/test', '/karteikarten', '/suche']) expect(menu).toContain(to)
  })
  it('Sprache und Sperren gelten auch für die Kacheln', () => {
    const hub = hubItemsFor(new Set(['copy']), 'en').map((i) => i.to)
    expect(hub).not.toContain('/konjugieren')
    expect(hub).not.toContain('/abschreiben')
    expect(hub).toContain('/crashkurs')
  })
  it('Menü: Spiele und Shop sind je ein Eintrag, Schnelllesen hat einen eigenen', () => {
    const by = Object.fromEntries(navGroupsFor(false).map((g) => [g.title, g.items.map((i) => i.to)]))
    expect(by['Spiele & Shop']).toEqual(['/spielen', '/advent', '/loot', '/boerse', '/laden'])
    expect(by['Lernen']).toContain('/schnelllesen')
    expect(by['Community']).toEqual(['/chat', '/online', '/websites'])
    const all = navItemsFor(false).map((i) => i.to)
    expect(new Set(all).size).toBe(all.length)
    for (const to of ['/mehrspieler', '/deathrun', '/parkour', '/autohaus', '/gambling', '/shop', '/druckshop', '/plus']) expect(all).not.toContain(to)
  })
  it('Sammelseiten: alle Spiele zusammen, Shop mit Plus & Pro, Sperren wirken', () => {
    const games = hubPageFor('games').flatMap((g) => g.items.map((i) => i.to))
    expect(games.sort()).toEqual(['/autohaus', '/deathrun', '/gambling', '/mehrspieler', '/parkour', '/spiele'])
    expect(hubPageFor('shop').flatMap((g) => g.items.map((i) => i.to))).toEqual(['/shop', '/druckshop', '/plus'])
    expect(hubPageFor('games', new Set(['gambling'])).flatMap((g) => g.items.map((i) => i.to))).not.toContain('/gambling')
  })
})
