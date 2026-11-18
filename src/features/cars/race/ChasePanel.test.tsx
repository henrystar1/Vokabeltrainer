import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChasePanel, { type ChaseApi } from './ChasePanel'

const api: ChaseApi = { invite: () => undefined, start: () => undefined, cancel: () => undefined, answer: () => undefined }
const base = { peers: [{ id: 'a', name: 'Anna' }, { id: 'u', name: 'Ich' }], open: true, onClose: () => undefined, api, meName: 'Ich', myId: 'u' }

describe('ChasePanel', () => {
  it('Menü: zeigt nur andere Spieler aus der Stadt, Bandit-Wahl und Bots', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} ui={{}} />)
    expect(h).toContain('Anna')
    expect(h).toContain('Wer sind die Banditen?')
    expect(h).toContain('Polizei-Bots')
    expect(h.match(/Ich/g)?.length).toBeGreaterThan(0)
  })
  it('Einladung: Mitmachen/Nein und Rolle', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} open={false} ui={{ incoming: { id: '1', fn: 'Max', role: 'bandit', bots: 2 } }} />)
    expect(h).toContain('Max lädt dich zur Polizeijagd ein')
    expect(h).toContain('der Bandit')
    expect(h).toContain('Mitmachen')
  })
  it('läuft die Jagd, ist das Menü zu und der Hinweis sichtbar', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} ui={{ active: { role: 'cop', t0: Date.now(), banditName: 'Tom', bots: 0 } }} />)
    expect(h).toContain('ramme Tom')
    expect(h).not.toContain('Wen einladen')
  })
  it('Ergebnis', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} open={false} ui={{ over: { win: 'police', mine: true } }} />)
    expect(h).toContain('Die Polizei hat alle Banditen gefangen!')
  })
  it('Ersteller sieht Antworten', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} ui={{ lobby: { id: 'x', bandits: ['me'], invited: { a: 'yes' }, bots: 1 } }} />)
    expect(h).toContain('dabei')
    expect(h).toContain('Jagd starten')
  })
  it('mehrere Banditen: Auswahl per Knöpfen, Lobby nennt alle', () => {
    const h = renderToStaticMarkup(<ChasePanel {...base} ui={{ lobby: { id: 'x', bandits: ['me', 'a'], invited: { a: 'yes' }, bots: 1 } }} />)
    expect(h).toContain('Banditen')
    const m = renderToStaticMarkup(<ChasePanel {...base} ui={{}} />)
    expect(m).toContain('mehrere möglich')
    expect(m).toContain('aria-pressed')
  })
})
