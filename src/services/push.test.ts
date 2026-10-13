import { describe, expect, it } from 'vitest'
import { urlBase64ToBytes } from './push'

describe('urlBase64ToBytes', () => {
  it('wandelt URL-sicheres Base64 um', () => {
    expect(Array.from(urlBase64ToBytes('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToBytes('-_8'))).toEqual([251, 255])
  })
  it('ergänzt fehlendes Padding', () => {
    expect(urlBase64ToBytes('AQ').length).toBe(1)
  })
})
