import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeQuadModel, seatWalker } from './quad'
import { isArmored, kindDims, seatsOf, toughOf } from '../stats'

describe('KSK-Quad', () => {
  it('hat vier Räder, Minigun, Fahrer und Beifahrer', () => {
    const q = makeQuadModel(THREE)
    expect((q.userData.wheels as unknown[]).length).toBe(4)
    expect(q.userData.barrels).toBeTruthy()
    expect(q.userData.gunYaw).toBeTruthy()
    expect(q.userData.rider).toBeTruthy()
    expect((q.userData.rider2 as THREE.Group).visible).toBe(false)
  })
  it('ist unzerstörbar, hat 2 Plätze und passende Maße', () => {
    expect(toughOf('quad')).toBe(0)
    expect(isArmored('quad')).toBe(true)
    expect(seatsOf('quad')).toBe(2)
    expect(kindDims('quad').len).toBeGreaterThan(2)
  })
  it('seatWalker setzt die Figur auf den Sitz', () => {
    const w = new THREE.Group(); w.userData = { legL: new THREE.Group(), legR: new THREE.Group(), armL: new THREE.Group(), armR: new THREE.Group() }
    seatWalker(w as THREE.Group, -0.3, 0.36)
    expect(w.position.z).toBeCloseTo(-0.3)
    expect((w.userData.legL as THREE.Group).rotation.x).toBeLessThan(-1)
  })
})
