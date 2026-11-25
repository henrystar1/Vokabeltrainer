import { describe, expect, it } from 'vitest'
import { cacheGet, cachePut, isNetworkError, queueFlush, queueList, queuePush, type KV } from './offlineCache'

const mem = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } } }

describe('offlineCache', () => {
  it('Cache nach Argumenten getrennt', () => {
    const kv = mem()
    cachePut(kv, 'get_learning_pool', { p_book_id: 'a' }, [1, 2])
    expect(cacheGet(kv, 'get_learning_pool', { p_book_id: 'a' })).toEqual({ found: true, data: [1, 2] })
    expect(cacheGet(kv, 'get_learning_pool', { p_book_id: 'b' }).found).toBe(false)
  })
  it('Netzfehler erkennen', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError({ message: 'permission denied' })).toBe(false)
  })
  it('Warteschlange sendet der Reihe nach und stoppt bei Netzfehler', async () => {
    const kv = mem()
    queuePush(kv, 'submit_session', { a: 1 }); queuePush(kv, 'submit_session', { a: 2 }); queuePush(kv, 'submit_session', { a: 3 })
    const got: number[] = []
    let n = await queueFlush(kv, async (_f, a) => { if (a.a === 2) throw new TypeError('Failed to fetch'); got.push(a.a as number) })
    expect(n).toBe(1); expect(got).toEqual([1]); expect(queueList(kv).length).toBe(2)
    n = await queueFlush(kv, async (_f, a) => { got.push(a.a as number) })
    expect(n).toBe(2); expect(queueList(kv).length).toBe(0)
  })
  it('Fachfehler verwirft den Eintrag', async () => {
    const kv = mem(); queuePush(kv, 'submit_session', { a: 1 })
    await queueFlush(kv, async () => { throw { message: 'ungültig' } })
    expect(queueList(kv).length).toBe(0)
  })
})
