import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReportBtn } from './ReportBtn'

const v = { vocabulary_id: 'v1', german: 'Haus', translations: ['house'] } as never
const rep = { report: () => {}, sent: new Set<string>() }

describe('Melden zeigt keine Lösung vorab', () => {
  it('gesperrt: kein Knopf', () => {
    expect(renderToStaticMarkup(<ReportBtn v={v} rep={rep} locked />)).toBe('')
  })
  it('nach der Antwort: Knopf da', () => {
    expect(renderToStaticMarkup(<ReportBtn v={v} rep={rep} />)).toContain('Melden')
  })
})
