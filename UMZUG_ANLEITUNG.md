# Umzug in ein neues Supabase-Projekt

1. Altes Projekt: Admin → Backup → Häkchen „Konten mitnehmen“ → Backup herunterladen (Datei gut aufbewahren, enthält Passwort-Hashes).
2. Neues Projekt (neue Organisation): im SQL-Editor `supabase/ALLE_MIGRATIONEN_in_einem.sql` ausführen.
3. Project URL und Publishable Key des neuen Projekts kopieren.
4. Eintragen: entweder Admin → Umzug (nur dein Browser) oder `public/backend.json` im Repository ersetzen: `{"url":"https://xxxx.supabase.co","key":"sb_publishable_..."}`.
5. Seite `/umzug` öffnen, Backup-Datei wählen (spielt Konten ein, nur im leeren Projekt).
6. Mit alter Admin-E-Mail anmelden, Admin → Backup → dieselbe Datei einspielen. Danach sind Bücher, Nutzer, Mods, Einstellungen und Coins wieder da.
