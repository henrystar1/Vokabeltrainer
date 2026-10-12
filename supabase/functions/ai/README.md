# Edge Function „ai“ (OpenAI)

Erzeugt Grammatik-Lückentexte und Sätze für Test-Blätter. Der OpenAI-Schlüssel liegt nur hier.

## Einrichten (einmalig)
1. SQL: `0021_plus_ai.sql` (oder die aktuelle `ALLE_MIGRATIONEN_in_einem.sql`) im Supabase SQL-Editor ausführen.
2. Supabase → Edge Functions → neue Function **ai** anlegen und den Inhalt von `index.ts` und `lib.ts` einfügen
   (oder mit der Supabase-CLI: `supabase functions deploy ai`). „Verify JWT“ kann an bleiben.
3. Supabase → Edge Functions → Secrets: `OPENAI_API_KEY` = dein Schlüssel. Optional `OPENAI_MODEL` (Standard `gpt-4o-mini`).
4. Im OpenAI-Konto ein monatliches Ausgabenlimit setzen.
5. In der App: Verwaltung → Plus → „Schlüssel prüfen“.

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase der Function automatisch bereit.
