import { describe, expect, it } from 'vitest'
import { PK_COLORS, PK_HATS } from './cosmetics'

import sqlRaw from '../../../supabase/migrations/0047_parkour_shop.sql?raw'
const sql: string = sqlRaw

describe('Parkour-Shop-Katalog', () => {
  it('jede Farbe und jeder Hut steht im SQL (und umgekehrt)', () => {
    for (const id of Object.keys(PK_COLORS)) expect(sql, `color:${id}`).toContain(`'color:${id}'`)
    for (const id of Object.keys(PK_HATS)) expect(sql, `hat:${id}`).toContain(`'hat:${id}'`)
    const inSql = [...sql.matchAll(/'(color|hat):([a-z]+)'/g)].map((m) => `${m[1]}:${m[2]}`)
    for (const k of new Set(inSql)) {
      const [kind, id] = k.split(':')
      expect(kind === 'color' ? id in PK_COLORS : id in PK_HATS, k).toBe(true)
    }
  })
  it('Premium-Artikel im Client entsprechen dem Dreifachpreis im SQL', () => {
    const premiumSql = (sql.match(/when p_item in \(([^)]*)\) then 3 \*/g) ?? []).join(' ')
    for (const [id, c] of Object.entries(PK_COLORS)) expect(premiumSql.includes(`'color:${id}'`), id).toBe(!!c.premium)
    for (const [id, h] of Object.entries(PK_HATS)) expect(premiumSql.includes(`'hat:${id}'`), id).toBe(!!h.premium)
  })
})
