import { describe, expect, it } from 'vitest'
import { cleanBackend, looksSecret } from './backendConfig'

describe('backendConfig', () => {
  const key = 'sb_publishable_abcdefghijklmnop'
  it('akzeptiert gültige Werte und kürzt den Schrägstrich', () => {
    expect(cleanBackend({ url: ' https://abcd.supabase.co/ ', key })).toEqual({ url: 'https://abcd.supabase.co', key })
  })
  it('lehnt falsche URLs und kurze Keys ab', () => {
    expect(cleanBackend({ url: 'http://abcd.supabase.co', key })).toBeNull()
    expect(cleanBackend({ url: 'https://evil.example.com', key })).toBeNull()
    expect(cleanBackend({ url: 'https://abcd.supabase.co', key: 'x' })).toBeNull()
    expect(cleanBackend({})).toBeNull()
    expect(cleanBackend(null)).toBeNull()
  })
  it('erkennt Secret-Keys', () => {
    expect(looksSecret('sb_secret_abc')).toBe(true)
    const jwt = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`
    expect(looksSecret(jwt)).toBe(true)
    expect(looksSecret(key)).toBe(false)
  })
})
