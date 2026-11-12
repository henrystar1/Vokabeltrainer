import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import RaceMenu from './RaceMenu'
import RaceView from './RaceView'

describe('Rennspiel-Oberfläche', () => {
  it('zeigt Knöpfe für links, rechts, Gas und Bremse', () => {
    const h = renderToString(<RaceView trackId={0} laps={3} me={{ name: 'Du', kind: 'sportwagen', color: '#22d3ee' }} />)
    for (const l of ['Nach links', 'Nach rechts', 'Gas', 'Bremse']) expect(h).toContain(l)
  })
  it('Menü bietet alle sechs Strecken, Training und Bots', () => {
    const h = renderToString(<MemoryRouter><RaceMenu car={{ name: 'Du', kind: 'suv', color: '#fff' }} /></MemoryRouter>).replace(/<!-- -->/g, '')
    for (const n of ['Sonnenring', 'Schlangenpass', 'Haarnadel-Berg', 'Stadtkurs', 'Wüstenschleife', 'Nachtflug', 'Training allein', 'Gegen Bots', 'Rennen starten']) expect(h).toContain(n)
  })
})
