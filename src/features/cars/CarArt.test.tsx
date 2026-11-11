import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CarArt, { CAR_KINDS } from './CarArt'

describe('CarArt', () => {
  it('zeichnet jede Bauart mit Rädern und Farbe', () => {
    for (const k of CAR_KINDS) {
      const html = renderToString(<CarArt kind={k} color="#ef4444" label={k} />)
      expect(html).toContain('<svg')
      expect(html).toContain('#ef4444')
      expect((html.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(6)
    }
  })
  it('unbekannte Bauart fällt auf Kleinwagen zurück', () => {
    expect(renderToString(<CarArt kind="ufo" color="#000000" />)).toContain('<svg')
  })
})
