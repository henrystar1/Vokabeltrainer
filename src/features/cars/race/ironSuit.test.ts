import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { addGear } from './gear'
import { SUIT_MS, suitReady, tickSuit } from './ironSuit'
import { makeWalkerModel } from './walkerMesh'

describe('Iron-Man-Rüstung', () => {
  it('zieht sich an: erst unsichtbar, dann fertig nach SUIT_MS', () => {
    const m = makeWalkerModel(THREE, '#1f2937')
    addGear(THREE, m, 64)
    expect(suitReady(m)).toBe(false)
    tickSuit(m)
    const s = m.userData.suit as { t0: number; list: Array<{ g: { visible: boolean } }> }
    expect(s.list.length).toBeGreaterThan(20)
    s.t0 = performance.now() - (SUIT_MS + 200)
    tickSuit(m)
    expect(suitReady(m)).toBe(true)
    expect(s.list.every((p) => p.g.visible)).toBe(true)
  })
  it('ohne Rüstung sofort bereit', () => {
    expect(suitReady(makeWalkerModel(THREE, '#fff'))).toBe(true)
  })
})
