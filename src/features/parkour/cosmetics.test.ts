import { describe, expect, it } from 'vitest'
import { PK_COLORS, PK_FX, PK_HATS } from './cosmetics'

import sql47 from '../../../supabase/migrations/0047_parkour_shop.sql?raw'
import sql50 from '../../../supabase/migrations/0050_open_deathrun.sql?raw'
// Der Katalog steht seit 0050 komplett in _pk_price (0050 ersetzt die Funktion aus 0047)
const sql: string = sql50
void sql47

describe('Parkour-Shop-Katalog', () => {
  it('jede Farbe, jeder Hut und jeder Effekt steht im SQL (und umgekehrt)', () => {
    for (const id of Object.keys(PK_COLORS)) expect(sql, `color:${id}`).toContain(`'color:${id}'`)
    for (const id of Object.keys(PK_HATS)) expect(sql, `hat:${id}`).toContain(`'hat:${id}'`)
    for (const id of Object.keys(PK_FX)) expect(sql, `fx:${id}`).toContain(`'fx:${id}'`)
    const price = sql.slice(sql.indexOf('function public._pk_price'), sql.indexOf('function public._pk_state'))
    const inSql = [...price.matchAll(/'(color|hat|fx):([a-z]+)'/g)].map((m) => `${m[1]}:${m[2]}`)
    for (const k of new Set(inSql)) {
      const [kind, id] = k.split(':')
      expect(id in (kind === 'color' ? PK_COLORS : kind === 'hat' ? PK_HATS : PK_FX), k).toBe(true)
    }
  })
  it('Premium-Artikel im Client entsprechen dem Dreifachpreis im SQL', () => {
    const premiumSql = (sql.match(/when p_item in \(([^)]*)\) then 3 \*/g) ?? []).join(' ')
    for (const [id, c] of Object.entries(PK_COLORS)) expect(premiumSql.includes(`'color:${id}'`), id).toBe(!!c.premium)
    for (const [id, h] of Object.entries(PK_HATS)) expect(premiumSql.includes(`'hat:${id}'`), id).toBe(!!h.premium)
    for (const [id, f] of Object.entries(PK_FX)) expect(premiumSql.includes(`'fx:${id}'`), id).toBe(!!f.premium)
  })
})
