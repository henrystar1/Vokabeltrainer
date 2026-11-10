import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BookBoxMini from './BookBoxMini'

describe('BookBoxMini', () => {
  it('zeigt Prozent und Fächer', () => {
    const h = renderToString(<BookBoxMini fach={[2, 1, 0, 1, 4]} />).replace(/<!-- -->/g, '')
    expect(h).toContain('50%')
    expect(h).toContain('Fach 5')
  })
  it('bleibt bei leerem Buch unsichtbar', () => {
    expect(renderToString(<BookBoxMini fach={[]} />)).toBe('')
  })
})
