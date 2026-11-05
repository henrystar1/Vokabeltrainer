/** Angaben für Impressum und Datenschutz: stehen in public/rechtliches.txt (Zeilen SCHLÜSSEL=Wert, # = Kommentar). */
export interface LegalInfo {
  NAME: string; STRASSE: string; PLZ_ORT: string; EMAIL: string; TELEFON: string
  SUPABASE_REGION: string; SPIEL_SUPABASE_REGION: string; SPIEL_SUPABASE_BETREIBER: string
  DATENSCHUTZ_EMAIL: string; AUFSICHTSBEHOERDE: string
}
export const LEGAL_KEYS: Array<keyof LegalInfo> = ['NAME', 'STRASSE', 'PLZ_ORT', 'EMAIL', 'TELEFON', 'SUPABASE_REGION', 'SPIEL_SUPABASE_REGION', 'SPIEL_SUPABASE_BETREIBER', 'DATENSCHUTZ_EMAIL', 'AUFSICHTSBEHOERDE']

export function emptyLegal(): LegalInfo {
  return Object.fromEntries(LEGAL_KEYS.map((k) => [k, ''])) as unknown as LegalInfo
}

export function parseLegal(text: string): LegalInfo {
  const out = emptyLegal()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const key = line.slice(0, i).trim().toUpperCase() as keyof LegalInfo
    if (LEGAL_KEYS.includes(key)) out[key] = line.slice(i + 1).trim()
  }
  return out
}

/** Pflichtfelder fürs Impressum, die noch fehlen. */
export function missingImpressum(i: LegalInfo): Array<keyof LegalInfo> {
  return (['NAME', 'STRASSE', 'PLZ_ORT', 'EMAIL', 'TELEFON'] as const).filter((k) => !i[k])
}

export async function loadLegal(): Promise<LegalInfo> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}rechtliches.txt`, { cache: 'no-cache' })
    if (!r.ok) return emptyLegal()
    return parseLegal(await r.text())
  } catch {
    return emptyLegal()
  }
}
