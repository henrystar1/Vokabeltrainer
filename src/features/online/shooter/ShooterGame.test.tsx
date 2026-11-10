import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ShooterGame from './ShooterGame'
import type { OgView } from '../../../services/online'

const view = {
  id: 'g1', kind: 'shooter', status: 'running', version: 1, host_id: 'u1', me: { user_id: 'u1', seat: 0, join_state: 'joined' }, turn_seat: null, winner_seat: null,
  state: { t0: 0, minutes: 5, to_win: 10, scores: {} }, mine: {},
  players: [{ user_id: 'u1', name: 'Henry', seat: 0, join_state: 'joined' }, { user_id: 'u2', name: 'Gegner', seat: 1, join_state: 'joined' }],
} as unknown as OgView

describe('ShooterGame', () => {
  it('zeigt Panik-Knopf, Leben und Mitspieler', () => {
    const h = renderToString(<ShooterGame view={view} onReport={() => undefined} />).replace(/<!-- -->/g, '')
    expect(h).toContain('PANIK')
    expect(h).toContain('100 Leben')
    expect(h).toContain('Gegner')
  })
})
