import { describe, expect, it } from 'vitest'
import { hubItemsFor, navItemsFor } from './navigation'

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
})
