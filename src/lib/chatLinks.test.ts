import { describe, expect, it } from 'vitest'
import { chatParts, menuTarget } from './chatLinks'

describe('Chat-Links', () => {
  it('findet Menüpunkte', () => {
    expect(menuTarget('Start')?.to).toBe('/')
    expect(menuTarget('websites')?.to).toBe('/websites')
    expect(menuTarget('Auswendig')?.to).toBe('/auswendig')
    expect(menuTarget('Flaggen')?.to).toBe('/auswendig')
    expect(menuTarget('Wer_ist_da')?.to).toBe('/online')
    expect(menuTarget('Parkour')?.to).toBe('/parkour')
    expect(menuTarget('gibtesnicht')).toBeNull()
  })
  it('zerlegt Nachrichten', () => {
    expect(chatParts('Schaut mal #Websites an')).toEqual([{ text: 'Schaut mal ' }, { text: '#Websites', to: '/websites' }, { text: ' an' }])
    expect(chatParts('#Start')).toEqual([{ text: '#Start', to: '/' }])
    expect(chatParts('#Websites/Mein_Spiel.')).toEqual([{ text: '#Websites/Mein_Spiel', to: '/websites?site=Mein%20Spiel' }, { text: '.' }])
    expect(chatParts('Hallo #unbekannt und a#Start')).toEqual([{ text: 'Hallo #unbekannt und a#Start' }])
    expect(chatParts('ohne links')).toEqual([{ text: 'ohne links' }])
  })
})

import { tagSuggestions } from './chatLinks'
describe('#-Vorschläge', () => {
  it('schlägt Menüpunkte nach Anfangsbuchstaben vor', () => {
    expect(tagSuggestions('Web')).toContain('Websites')
    expect(tagSuggestions('st')).toContain('Start')
    expect(tagSuggestions('zzzzz')).toEqual([])
  })
  it('ohne Eingabe kommen die ersten Menüpunkte', () => {
    expect(tagSuggestions('').length).toBeGreaterThan(3)
  })
  it('nach Websites/ kommen die Namen der Seiten', () => {
    expect(tagSuggestions('Websites/me', ['Mein Spiel', 'Anderes', 'Memory'])).toEqual(['Websites/Mein_Spiel', 'Websites/Memory'])
    expect(tagSuggestions('Start/x', ['x'])).toEqual([])
  })
})
