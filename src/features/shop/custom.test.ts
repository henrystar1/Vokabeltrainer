import { describe, expect, it } from 'vitest'
import { svgProblem } from '../../components/shop/ItemEditor'
import { lastSeenText } from '../../pages/Presence'
import { customNameColor, customTag, customTheme, mixHex, safeHex } from './custom'
import type { CustomItem } from '../../types'

const item = (kind: CustomItem['kind'], style: Record<string, unknown>): CustomItem => ({ id: 'c_x', kind, name: 'Test', style, svg: null })

describe('Eigene Artikel', () => {
  it('lässt nur gültige Hex-Farben ins CSS', () => {
    expect(safeHex('#22d3ee', '#000000')).toBe('#22d3ee')
    expect(safeHex('red; background:url(x)', '#000000')).toBe('#000000')
    expect(safeHex(5, '#111111')).toBe('#111111')
  })

  it('mischt Farben', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030')
  })

  it('baut Namensfarbe, Tag und Design aus den Angaben', () => {
    expect(customNameColor(item('color', { colors: ['#ff0000'] })).style).toEqual({ color: '#ff0000' })
    expect(customNameColor(item('color', { colors: ['#ff0000', '#00ff00'], animate: true })).className).toContain('cname-run')
    expect(customTag(item('tag', { label: 'Superlangertext', bg1: '#111111' })).label).toBe('Superlange')
    const th = customTheme(item('theme', { bg: '#101020', fx: 'shine' }))
    expect(th.fx).toBe('shine')
    expect(th.s950).not.toBe(th.s600)
  })

  it('prüft SVGs wie der Server', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#f00"/></svg>'
    expect(svgProblem(ok)).toBeNull()
    expect(svgProblem('<svg viewBox="0 0 1 1"><script>x()</script></svg>')).not.toBeNull()
    expect(svgProblem('<svg viewBox="0 0 1 1"><rect onload="x()" width="1" height="1"/></svg>')).not.toBeNull()
    expect(svgProblem('<svg viewBox="0 0 1 1"><image href="https://a.example/x.png"/></svg>')).not.toBeNull()
    expect(svgProblem('hallo welt, das ist kein svg code')).not.toBeNull()
  })

  it('schreibt „zuletzt gesehen“ lesbar', () => {
    const now = new Date('2026-10-06T12:00:00Z').getTime()
    expect(lastSeenText('2026-10-06T11:59:30Z', now)).toBe('gerade eben')
    expect(lastSeenText('2026-10-06T11:40:00Z', now)).toBe('vor 20 Min.')
    expect(lastSeenText('2026-10-06T09:00:00Z', now)).toBe('vor 3 Std.')
    expect(lastSeenText('2026-10-05T09:00:00Z', now)).toBe('gestern')
    expect(lastSeenText('2026-10-02T12:00:00Z', now)).toBe('vor 4 Tagen')
  })
})
