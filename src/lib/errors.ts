/** Wandelt Fehler aus Supabase/Netzwerk in verständliche deutsche Meldungen um. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; hint?: string; status?: number } | null
  const msg = e?.message ?? ''
  if (!e) return 'Unbekannter Fehler.'
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.'
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort ist falsch.'
  if (/email not confirmed/i.test(msg)) return 'Bitte zuerst die E-Mail-Adresse über den Bestätigungslink bestätigen.'
  if (/already registered|already been registered/i.test(msg)) return 'Diese E-Mail-Adresse ist bereits registriert.'
  if (/password should be at least/i.test(msg)) return 'Das Passwort ist zu kurz (mindestens 8 Zeichen).'
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche. Bitte einen Moment warten.'
  if (/display_name|profiles_display_name/i.test(msg) && /unique|duplicate/i.test(msg)) return 'Dieser Anzeigename ist bereits vergeben.'
  if (e.code === '42883' || /could not find the function/i.test(msg)) {
    return 'Eine Datenbankfunktion fehlt. Bitte supabase/migrations/0002_functions.sql im Supabase-SQL-Editor ausführen.'
  }
  // Ältere Datenbankmeldungen sagen noch „Koins“.
  return msg ? msg.replace(/\bKoins\b/g, 'Coins').replace(/\bKoin\b/g, 'Coin') : 'Unbekannter Fehler.'
}

/** Fehler-Hint, den die Datenbankfunktionen für bekannte Sonderfälle setzen. */
export function errorHint(err: unknown): string | null {
  return (err as { hint?: string } | null)?.hint ?? null
}
