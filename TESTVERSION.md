# Testversion einrichten

Ziel: Neue Updates zuerst in einer **zweiten Kopie** ausprobieren (eigene Datenbank, eigene Webseite). Geht dort etwas schief, bleibt die echte Seite unberührt. Erst wenn alles klappt, lädst du dasselbe Update in die echte Seite.

Die App ist schon dafür vorbereitet: Der Pfad der Webseite richtet sich nach dem Namen des GitHub-Repositorys, und die Supabase-Adresse kann über „Variables“ im Repository ersetzt werden. Es muss kein Code geändert werden.

## 1. Zweites Supabase-Projekt

1. supabase.com → **New project** (z. B. Name `vokabeltrainer-test`), Region wie beim echten Projekt.
2. Warten, bis es bereit ist.
3. **SQL Editor → New query**. Nacheinander (in dieser Reihenfolge, jede Datei komplett einfügen und **Run** drücken):
   `0001_schema.sql`, `0002_functions.sql`, `0003_german_alts.sql`, `0004_roles_public_books.sql`, `0005_koins_shop.sql`, `0006_presence_messages_tags.sql`, `0007_league_quests_sprint_duels.sql`, `0008_chat.sql`, `0009_coins_pay_rules.sql`, `0010_sprint_coins_games_piano.sql`, `0011_alphamod_gambling_highscores.sql`, `0012_mod_rights_tags_gifts.sql`, `0013_per_staff_rights.sql`, `0014_shop_editor_board_presence.sql`, `0015_locks_gambling_stats_limits.sql`, `0016_accounts_copy_items.sql`, `0017_big_coins_wave.sql`
   (Die Dateien liegen im Ordner `supabase/migrations`. Alle sind wiederholbar – doppeltes Ausführen schadet nicht.)
4. **Project Settings → API**: Notiere die **Project URL** und den **Publishable key** (`sb_publishable_…`). Niemals den Secret-Key verwenden.

## 2. Zweites GitHub-Repository

1. Neues Repository, z. B. `Vokabeltrainer-test`, öffentlich (für kostenlose Pages).
2. Dieselben Dateien hochladen wie beim echten (ohne `.env`, `node_modules`, `dist`).
3. **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   - `VITE_SUPABASE_URL` = Project URL des **Test**-Projekts
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = Publishable key des **Test**-Projekts
5. Unter **Actions** den Workflow „Deploy to GitHub Pages“ starten (oder einen Commit machen). Danach läuft die Testseite unter `https://henrystar1.github.io/Vokabeltrainer-test/`.

## 3. Anmeldung in der Testversion erlauben

Im Test-Supabase: **Authentication → URL Configuration**
- **Site URL**: `https://henrystar1.github.io/Vokabeltrainer-test/`
- **Redirect URLs**: dieselbe Adresse mit `**` am Ende hinzufügen (`https://henrystar1.github.io/Vokabeltrainer-test/**`).

(Ohne das führen E-Mail-Links für Bestätigung und Passwort-Zurücksetzen auf die falsche Seite.) Optional: unter **Authentication → Providers → Email** „Confirm email“ ausschalten, dann geht die Registrierung zum Testen sofort.

## 4. Dich selbst zum Admin machen (Testdatenbank ist leer)

Registriere dich auf der Testseite. Dann im SQL Editor des Test-Projekts:

```sql
update public.profiles set role = 'admin'
 where id = (select id from auth.users where email = 'DEINE@EMAIL');
```

## 5. Arbeitsablauf für jedes neue Update

1. Update-Zip entpacken → Dateien ins **Test-Repository** hochladen.
2. Neue SQL-Datei(en) im **Test-Supabase** ausführen.
3. Testseite ausprobieren (nach dem Deploy ca. 1–2 Minuten; Seite ggf. mit Strg+F5 neu laden).
4. Wenn alles passt: dieselben Dateien ins **echte Repository** hochladen und dieselbe SQL im **echten Supabase** ausführen.

Hinweis: Die Testseite hat eigene Konten, eigene Coins und eigene Bücher – nichts davon vermischt sich mit der echten Seite.
