import { describe, expect, it } from 'vitest'
import { hubItemsFor, navGroupsFor, navItemsFor } from './navigation'

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
  it('Menü ist nach Themen geordnet: alle Spiele zusammen, Geld/Shop zusammen, Gespräche zusammen', () => {
    const by = Object.fromEntries(navGroupsFor(false).map((g) => [g.title, g.items.map((i) => i.to)]))
    expect(by['Spiele']).toEqual(['/spiele', '/mehrspieler', '/deathrun', '/parkour', '/autohaus', '/gambling'])
    expect(by['Coins & Belohnungen']).toEqual(['/advent', '/loot', '/boerse', '/shop', '/druckshop', '/plus'])
    expect(by['Community']).toEqual(['/chat', '/online', '/websites'])
    expect(by['Wettkampf']).toContain('/rangliste')
    const all = navItemsFor(false).map((i) => i.to)
    expect(new Set(all).size).toBe(all.length)
  })
})
