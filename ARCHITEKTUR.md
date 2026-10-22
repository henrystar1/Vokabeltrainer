# Vokabeltrainer – Architektur

## Tech-Stack
- Frontend: React 19 + TypeScript (strict), Vite, Tailwind CSS 3, React Router (BrowserRouter mit `basename`), lucide-react
- Backend: Supabase (Auth, PostgreSQL, Row Level Security, RPC-Funktionen)
- Tests: Vitest (gesamte Lernlogik als reine, testbare Funktionen)
- Hosting: GitHub Pages über GitHub Actions (`.github/workflows/deploy.yml`); `404.html` = Kopie von `index.html` als SPA-Fallback
- Im Frontend nur `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (öffentlich); niemals ein Secret-/service_role-Key.

## Projektstruktur
```
vokabeltrainer/
├─ ARCHITEKTUR.md
├─ .github/workflows/deploy.yml
├─ supabase/migrations/
│  ├─ 0001_schema.sql      Tabellen, RLS, Trigger, Views, Rangliste/Community-Funktionen
│  └─ 0002_functions.sql   RPC-Funktionen (Eingabe, Suche, Lernen, Statistik, Import/Export)
└─ src/
   ├─ main.tsx, App.tsx (Routen), index.css
   ├─ types/               Domain-Typen (Antworten der RPC-Funktionen)
   ├─ lib/                 supabaseClient, errors (deutsche Fehlertexte), useAsync, navigation
   ├─ services/            dünne Wrapper um Supabase/RPC (books, entry, search, learning, stats, exchange, settings)
   ├─ features/
   │  ├─ auth/             AuthProvider (Session, Anzeigename, Passwort-Reset)
   │  ├─ settings/         SettingsProvider + rules (Richtungen, Anzahl gerade bei 2 Richtungen)
   │  ├─ learning/         algorithm, answer, selection, questions, session (+ Tests)
   │  ├─ entry/            rows (Zeilenmodell der Eingabetabelle)
   │  ├─ books/            exportFormat (Validierung/Vorschau der Import-Datei)
   │  ├─ test/             range (Bereich nach Vokabel/Seite/Unit)
   │  └─ ocr/              nur Typen + Anbieter-Schnittstelle (nicht umgesetzt)
   ├─ components/          layout (Sidebar, MobileNav, AppShell, RequireAuth), ui, charts (SVG), quiz
   └─ pages/               Dashboard, Books, BookDetail, BookEntry, Search, Learn, Test, Stats, Leaderboard, Settings, ImportBook, auth/*
```

## Datenbanktabellen
| Tabelle | Zweck |
|---|---|
| languages | Erweiterbare Sprachliste (`en`, `fr`); neue Sprache = neue Zeile |
| profiles | 1:1 zu auth.users; eindeutiger Anzeigename (Trigger bei Registrierung) |
| user_settings | Lernrichtungen, Abfragen pro Runde (1–200), Groß-/Kleinschreibung, Lernsprache |
| books | Name, Sprache, Beschreibung, owner_id |
| units | Buch, Nummer, Name |
| pages | Buch, Seitenzahl, **unit_id** (Unit kann über mehrere Seiten gehen; eine Seite gehört zu genau einer Unit) |
| vocabulary | Deutsche Grundform je Buch (`german_key` normalisiert → Duplikate werden zusammengeführt) |
| vocabulary_placements | Vokabel → Seite + Position (dieselbe Vokabel kann auf mehreren Seiten stehen) |
| translations | Mehrere richtige Übersetzungen je Vokabel |
| user_vocabulary_progress | user + vocabulary + learning_level (1–5 in 0,5er-Schritten, CHECK) |
| learning_sessions / learning_answers | Runden und Einzelantworten (`is_repeat` = Wiederholungsrunde) |
| daily_stats | Tageswerte je Nutzer (Trigger-gepflegt; Basis für Statistik, Rangliste, Durchschnitte) |

## RPC-Funktionen (0002)
Alle laufen als *security invoker* – die RLS-Regeln bleiben aktiv. Große Ergebnisse kommen als `jsonb`, damit das PostgREST-Zeilenlimit nicht greift.
`save_vocab_entry` (Anlegen/Ändern/Zusammenführen), `delete_vocab_entry`, `move_page_to_unit`, `delete_page`, `delete_unit`, `get_book_summaries`, `get_book_outline`, `get_book_entries`, `get_page_entries`, `get_learning_pool`, `search_vocabulary`, `submit_session` (atomar: Sitzung + Antworten + Lernstände), `add_repeat_answers`, `get_my_stats`, `export_book`, `import_book`.
Rangliste und Community-Durchschnitt: `get_leaderboard`, `get_community_averages` (*security definer*, nur Anzeigename/Punkte bzw. aggregierte Werte, Durchschnitt erst ab 3 Lernenden).

## Sicherheit (RLS)
- Alle Tabellen mit RLS. Bücher/Units/Seiten/Vokabeln/Übersetzungen nur für den Besitzer.
- Fortschritt, Sessions, Antworten, Statistik: nur `user_id = auth.uid()`.
- Fremde Daten sind nur über die beiden aggregierenden Funktionen sichtbar.
- Export enthält ausschließlich Buchinhalte – keinen Fortschritt, keine Konten.

## Lernlogik
- Start Stufe 1, Bereich 1–5 in 0,5er-Schritten. Paarbewertung: beide richtig +1 · eine richtig +0,5 · beide falsch −1 (min. 1, max. 5).
- Nur eine aktive Richtung: richtig zählt wie „beide richtig“, falsch wie „beide falsch“.
- Auswahl gewichtet (Gewicht 2^(5−Stufe)), Stufe 5 ist nie fällig; gezogen ohne Zurücklegen (Efraimidis–Spirakis).
- Einstellung „Abfragen pro Runde“ (1–200); bei zwei Richtungen ist die Zahl gerade (N/2 Vokabeln, beide Richtungen, mit Mindestabstand).
- Rückrichtung: eine zufällige Übersetzung wird gezeigt; alle deutschen Wörter mit dieser Übersetzung gelten als richtig. Falsche Antworten zeigen alle akzeptierten Lösungen.
- Antwortvergleich: Unicode-Normalisierung, typografische Anführungszeichen, Leerzeichen, optional Groß-/Kleinschreibung – keine Tippfehlerkorrektur.
- „Fehler wiederholen“ ändert den Lernstand nicht (Antworten mit `is_repeat = true`, zählen nicht für Statistik).
- Test: Bereich nach Vokabelnummer/Seite/Unit, Reihenfolge wie im Buch, erst alle Vorwärts-, dann alle Rückwärtsfragen; Lernstand nur bei ausdrücklicher Option.

## Definitionen
- „Gelernt“ = Stufe ≥ 2 · Fortschritt % = Mittel von (Stufe−1)/4 · „Zu wiederholen“ = Stufe 1 mit bereits gemachten Fehlern.
- Rangliste: Punkte je Tag = 2 × richtige Antworten (max. 200) + 25 Aktivitätsbonus + bis 20 Genauigkeitsbonus (ab 20 Antworten). Tage nach Europe/Berlin.

## Austauschformat (Import/Export, Version 1)
```json
{ "format": "vokabeltrainer-book", "version": 1,
  "book": { "name": "…", "language": "en", "description": null },
  "units": [ { "number": 1, "name": null,
    "pages": [ { "number": 10, "vocabulary": [ { "german": "Haus", "translations": ["house"] } ] } ] } ] }
```
Der Import zeigt zuerst eine Vorschau (Zählwerte, Beispiele, Fehler) und legt ein neues Buch an; dieselben Regeln prüft die Datenbank erneut.

## OCR (vorbereitet, nicht umgesetzt)
`src/features/ocr`: `OcrProvider`-Schnittstelle (Bild → erkannte Zeilen mit optionaler Sicherheit) und ein Platzhalter-Anbieter. Geplanter Ablauf: Foto → Erkennung → Prüfansicht → Speichern über `save_vocab_entry`. Es gibt keine Oberfläche dafür.

## Phasenplan
1 Gerüst + UI · 2 Supabase/Auth · 3 Bücher/Units/Seiten · 4 Vokabeleingabe · 5 Suche · 6 Lernmodus · 7 Algorithmus · 8 Test · 9 Statistik · 10 Rangliste · 11 Import/Export · 12 OCR-Vorbereitung – alle bis auf die OCR-Umsetzung selbst sind implementiert.

## Erweiterung: Französisch zuerst, mehrere Lösungen, Foto-Einlesung

- **Migration `0003_german_alts.sql`** (nach 0002 ausführen): `vocabulary.german_alts text[]`. Deutsch hat damit ein Hauptwort plus beliebig viele Alternativen; Fremdsprache hatte schon mehrere Übersetzungen. Eindeutigkeit bleibt über das deutsche Hauptwort.
- **Reihenfolge**: Eingabetabelle Fremdsprache links, Deutsch rechts. Abfrage: zuerst Fremdsprache → Deutsch, danach Deutsch → Fremdsprache. Jede Lösung beider Seiten wird akzeptiert.
- **Akzent-Leiste** (`components/ui/AccentBar.tsx`): é è ç à … für Französisch-Bücher, in Eingabe, Foto-Prüfung und Abfrage (Deutsch → Französisch).
- **Foto-Einlesung** (`features/ocr`, `components/ocr/ScanModal.tsx`): läuft komplett im Browser mit tesseract.js (kostenlos, kein API-Schlüssel). Sprachdaten liegen in `public/tessdata`. Bild wird nur im Speicher verarbeitet, nie hochgeladen. Ablauf: Beleuchtung glätten → OCR → Spalten/Zeilen (`layout.ts`) → Unité/Seite erkennen, blaue Kästen und Beispielsätze auslassen → Prüfansicht → Speichern.

## Erweiterung: Rollen, öffentliche Bücher, Prüfanfragen (Migration 0004)

**Rollen** (`profiles.role`): `user`, `mod`, `admin`. Admin wird nur per SQL gesetzt (Supabase SQL Editor):

```sql
update public.profiles set role = 'admin'
 where id = (select id from auth.users where email = 'deine@mail.de');
```

Rolle und Sperre lassen sich vom Client nicht ändern (Spaltenrechte + Trigger). Admins ernennen Mods in *Verwaltung → Benutzer*.

| | Nutzer | Mod | Admin |
|---|---|---|---|
| Eigene Bücher anlegen/bearbeiten | ✓ | ✓ | ✓ |
| Online-Bücher lesen, verwenden, lernen | ✓ | ✓ | ✓ |
| Vokabeln melden („Prüfung anfordern“) | ✓ | ✓ | ✓ |
| Eigene Bücher veröffentlichen | – | ✓ | ✓ |
| Vokabeln öffentlicher Bücher ändern, Prüfanfragen bearbeiten | – | ✓ | ✓ |
| Öffentliches Buch zurücknehmen | – | nur eigene | alle |
| Öffentliches Buch löschen, Nutzer sperren/zurücksetzen/löschen, Speicher einsehen, Mods ernennen | – | – | ✓ |

**Öffentliche Bücher**: `books.is_public`. Gelesen werden dürfen eigene und öffentliche Bücher (`can_read_book`), geändert werden dürfen eigene private Bücher oder – bei öffentlichen – nur Mods/Admins (`can_edit_book`; `owns_book` zeigt darauf, damit alle bisherigen Funktionen mitziehen). „Verwenden“ legt einen Eintrag in `book_library` an; Lernpool, Suche, Statistik und „Meine Bücher“ beziehen sich auf die Bibliothek (eigene Bücher + verwendete Online-Bücher). Der Lernfortschritt bleibt pro Nutzer (`user_vocabulary_progress`).

**Prüfanfragen**: `review_requests` (Momentaufnahme der Vokabel + Nachricht, Status offen/erledigt/abgelehnt). Gestellt über `request_review`, gelesen/bearbeitet nur von Mods/Admins (`list_review_requests`, `resolve_review_request`). Eine offene Anfrage je Nutzer und Vokabel, höchstens 50 offene je Nutzer.

**Sperren**: `profiles.blocked` + `auth.users.banned_until`. Eine restriktive RLS-Policy (`blocked_guard`) sperrt gesperrte Nutzer sofort bei allen Tabellen aus; die App zeigt „Konto gesperrt“.

**Speicheranzeige** (`admin_list_users`): Schätzung aus Textlängen + Zeilenaufwand; Inhalte fremder Nutzer sind nicht einsehbar.

**Buchsprache** ändern: Bearbeiten-Dialog im Buch (Spalte `books.language`).

**Foto-Einlesung für Englisch**: `public/tessdata/eng.traineddata`; `createTesseractEngine(language)` lädt Fremdsprache + Deutsch. Der Layout-Parser ist am französischen Buch geeicht, für englische Bücher noch ungetestet.

## Erweiterung: Koins, Shop, Themes, Feedback, Aktivierung (Migration 0005)

**Einspielen:** `supabase/migrations/0005_koins_shop.sql` nach 0001–0004 im Supabase-SQL-Editor ausführen (wiederholbar).

### Koin-Wirtschaft
- Alle Zahlen stehen in `app_settings` und sind im Admin-Tab „Koins & Shop“ änderbar (Standardpreis Buch 200, Lernen 1 Koin je neu gelernter Vokabel aus einem **Online-Buch**, höchstens 30 pro Tag, Fehlermeldung 10, Code 500, Tagesbonus Mod 1 / Admin 10).
- Koins bewegen sich nur über `_grant_koins` (Wallet + Ledger in einer Transaktion, Guthaben nie negativ). Die Tabellen sind für Clients nur lesbar (RLS: nur eigene Zeilen).
- Quellen: Codes (`admin_create_codes` → `redeem_code`, Code wird beim Einlösen gelöscht, Rate-Limit 5 Fehlversuche / 10 Min.), Lernen (Trigger auf `user_vocabulary_progress`, nur einmal pro Vokabel und nur Online-Bücher → kein Farmen durch Wiederholen oder eigene Bücher), bestätigte Prüfanfragen (`resolve_review_request`, Häkchen „Belohnen“), Feedback (bis 50), Tagesbonus (`claim_daily_bonus`, beim Laden der App für Mods/Admins), Admin-Geschenke.
- Ausgaben: Online-Bücher (`add_to_library` = Kauf, einmalig; Staff/Besitzer/Preis 0 kostenlos), Shop-Artikel (`buy_item`).

### Aktive Vokabeln
- `user_active_vocab`: pro Nutzer, welche Vokabeln lernbar sind. Eigene Bücher: automatisch (Trigger). Online-Bücher: nur über `set_vocab_active` (ganzes Buch, Unit oder Seite) → neue Vokabeln eines Online-Buchs erscheinen erst nach Aktivierung. Lernpool und Statistik filtern auf aktive Vokabeln. Der Test über einen Seiten-/Unit-Bereich nutzt weiterhin alle Einträge im gewählten Bereich.

### Shop und Designs
- DB kennt nur `shop_items` (ID, Art, Name, Preis, aktiv) und `user_items`; gewählte Artikel stehen in `profiles.avatar_id/color_id/effect_id/theme_id` (nur über `equip_item`/`unequip_item` setzbar, nur gekaufte).
- Das Aussehen steht im Client-Katalog `src/features/shop/catalog.ts` (Schlüssel = Artikel-ID); `catalog.test.ts` prüft, dass jeder Artikel der Migration im Katalog vorkommt.
- Designs: Tailwind-Farben `space-*` und `accent-*` sind CSS-Variablen (`--s950…--s600`, `--c-cyan/violet/blue`, Triplets). `ThemeApplier` setzt sie aus `profile.theme_id`; `StarField` zeigt die passende Dekoration (Sterne, Blasen, Blüten, Konfetti, Glühwürmchen, Code-Regen, Funken). Effekte für Namen sind CSS-Klassen `fx-*` in `index.css`.
- `PlayerTag`/`Avatar`/`StyledName` zeigen Profilbild, Namensfarbe und Effekt in Rangliste, Seitenleiste und Profil. `get_leaderboard` liefert die Kosmetik-IDs mit.

### Oberfläche
- Neue Seiten: `/shop`, `/profil` (Guthaben, Code einlösen, Verlauf), `/feedback`. Admin-Tabs: Feedback (Mods+Admin), Koins & Shop (nur Admin: Codes, Geschenke, Zahlen, Shop-Preise).
- Lern-/Testrunde: `QuizRunner` schaltet über `useFocusMode` Seitenleiste und Navigation aus; Abbruch nur über das „X“ (mit Rückfrage), `beforeunload` schützt vor versehentlichem Schließen/Neuladen. Abgebrochene Runden werden nicht gewertet.

## Erweiterung: Online-Anzeige, Nachrichten, Tags, animierte Profilbilder (Migration 0006)

**Einspielen:** `supabase/migrations/0006_presence_messages_tags.sql` nach 0001–0005 im SQL-Editor ausführen (wiederholbar).

- **Online-Anzeige:** `profiles.last_seen_at`; `PresenceProvider` ruft jede Minute `heartbeat()` auf (nur bei sichtbarem Tab). `admin_list_online()` (nur Admin) liefert, wer in den letzten 3 Minuten aktiv war → Admin-Tab „Online & Nachrichten“.
- **Nachrichten:** `user_messages` (nur eigene lesbar), `admin_send_message(p_user | null = alle)`, `get_unread_messages`, `mark_messages_read`. Der Client zeigt ungelesene Nachrichten als Fenster, bis sie bestätigt werden. Gesperrte Nutzer bekommen keine Rundnachricht.
- **Tags:** `shop_items.kind = 'tag'` (Unterstützer … Koin-König, 1.500–50.000 Koins), `profiles.tag_id`. Mod/Admin-Tag wird automatisch aus der Rolle angezeigt (`ROLE_TAGS`). Die Rangliste liefert `role`, `tag_id`, `theme_id`; ein farbiger Rahmen um den Namen nutzt die Hauptfarbe des gewählten Designs (`themeFrameColor`).
- **Staff-Effekte:** `shop_items.required_role` (`mod`/`admin`), Preis 0, nicht kaufbar; `get_shop` zeigt sie nur berechtigten Rollen, `equip_item` prüft die Rolle, ein Trigger entfernt den Effekt bei Degradierung.
- **Animierte Profilbilder:** reine CSS-Animationen (`features/shop/avatars.css`, `AnimatedAvatar.tsx`): Plasma, Inferno, Frostkern, Sturm, Galaxie, Portal, Supernova, Schwarzes Loch (10.000 Koins). Neue Bilder = neue ID in der Migration + Eintrag in `ANIMATED_AVATARS` + CSS; `catalog.test.ts` prüft, dass jede Artikel-ID der Migrationen im Katalog vorkommt.
- **Live-Koins:** `koin_wallets` ist (falls vorhanden) in der Publication `supabase_realtime`; `WalletProvider` hört per Realtime auf das eigene Guthaben, pollt zusätzlich alle 45 s und beim Zurückkehren zum Tab und zeigt bei einem Plus „+N Koins“.
- **Aktivieren:** `activate_next_page` (nächste Seite mit inaktiven Vokabeln), `activate_up_to` (alles bis Unit/Seite). `ActivationPanel` im Buch (Fortschrittsbalken, „Nächste Seite“, „Bis hierhin“, Seiten farbig nach Zustand) und Schnellbutton auf der Lernen-Seite.

## Migration 0007 – Liga, Quests, Sprint, Fehler-Training, Duelle

Nach 0006 im Supabase-SQL-Editor ausführen (wiederholbar).

- **Fehler-Training**: `get_mistake_pool(book)` liefert Vokabeln, die in den letzten 30 Tagen falsch waren (Stufe < 5, meiste Fehler zuerst). Client: Umschalter auf der Lernen-Seite, `buildMistakeQuestions`.
- **Sprint** (`/sprint`): 60 s, `QuizRunner` mit `timeLimitSeconds`. `submit_sprint` speichert das Wochenbestergebnis (max. 30/Tag), `get_sprint_board` die Bestenliste.
- **Quests & Streak** (`/quests`): `get_quests`, `claim_quest` (Koins, Grund `quest`, einmal pro Tag und Quest), `get_streak`. Belohnungen in `app_settings` (`quest_reward_*`).
- **Wochenliga** (Tab „Liga“ in der Rangliste): 5 Stufen (Bronze–Diamant), eine Gruppe je Stufe. `_league_rollover()` läuft lazy beim ersten Aufruf nach Wochenwechsel (Advisory Lock): Top 3 steigen auf, Inaktive bzw. die letzten 3 (ab 8 Teilnehmern) steigen ab, Koins für Top 3 (`league_reward_*`), Nachricht an jeden.
- **Duelle / Zusammenlernen** (`/duell`): `search_players`, `create_duel` (beide brauchen ≥ 5 gemeinsame aktive Online-Vokabeln), `list_duels`, `get_duel`, `submit_duel` (Gewinner: mehr richtig, sonst schneller; Koins `duel_reward`, begrenzt durch `duel_daily_cap`), `cancel_duel`. Asynchron, nicht live. Der Client meldet sein Ergebnis selbst – Manipulation ist nicht ausgeschlossen.
- **iOS-Icon**: `apple-touch-icon.png`, `icon-192/512.png`, `manifest.webmanifest`, Links in `index.html` mit `%BASE_URL%`.

## Migration 0008 – Gesamt-Chat

`chat_messages` ohne direkten Tabellenzugriff; `get_chat(limit)`, `post_chat(body)` (1–500 Zeichen, mind. 1 s Abstand, max. 20/Minute, keine identische Nachricht innerhalb 30 s), `delete_chat_message(id)` nur Mods/Admins; Gesperrte können weder lesen noch schreiben. Client: Seite `/chat`, Polling alle 4 s nur bei sichtbarem Tab (kein Realtime nötig).

## Migration 0009 – Coins verschicken, Regeln, Schwarzes-Loch-Set

- **!pay** (im Chat): `post_chat` erkennt `!pay @Anzeigename 100` (Groß-/Kleinschreibung egal, @ optional). Prüft Empfänger (nicht gesperrt, nicht man selbst), Betrag (1 bis `pay_max`), Tageslimit `pay_daily_cap` und Guthaben; bucht über `_grant_koins` (`pay_out`/`pay_in`), schreibt eine Chat-Zeile der Art `pay` und eine Nachricht an den Empfänger.
- **Einstellbare Regeln**: `app_settings.mod_editable`; `staff_set_setting` (Mods nur für markierte Zahlen, Admins für alle). Die Ranglistenpunkte kommen aus `_day_points()` mit `points_per_answer`, `points_daily_cap`, `points_active_day`, `points_accuracy_bonus`, `points_accuracy_min`; `get_leaderboard` und `_week_points` (Liga) nutzen sie. Admin-Seite: Tab „Regeln“.
- **Coins statt Koins**: nur der sichtbare Text (UI, Migrationstexte); Tabellen/Funktionen heißen weiter `koin_*`. Symbol: 💵 (`CoinIcon`).
- **Shop**: Avatare Lavalampe, Matrix, Aurora, Sonnenfinsternis; Namensfarbe „Ereignishorizont“ und Effekt „Wirbel“ (`fx-vortex`) passend zum Schwarzen Loch. Das Schwarze Loch ist neu animiert (12 s: Lichtstreifen am Rand → Wirbelarme → Loch mit Akkretionsscheibe → Zusammenfall), reine CSS/SVG-Animation.
- **Sprint**: Buchauswahl; ohne Auswahl zählen alle aktiven Vokabeln aller Sprachen (vorher nur die Lernsprache).

## Migration 0010 – Sprint-Coins, Bot-Spiele, Klavier

- **Sprint**: `submit_sprint` liefert jetzt `{best, earned}` und zahlt 1 Coin je `sprint_coin_every` richtige Antworten, höchstens `sprint_coin_cap` pro Tag (Grund `sprint`).
- **Bot-Spiele** (`/spiele`: Snake, Tetris, Block Blast): `start_game` bucht den Eintritt (`game_fee`) und würfelt das Ziel des Bots (25–100 % von `bot_snake`/`bot_tetris`/`bot_blast`, von Mods einstellbar). `finish_game` wertet: Punkte werden auf das zeitlich Mögliche gekappt (Snake 2/s, Tetris 50/s, Blast 60/s), Sieg nur bei mehr Punkten als der Bot, Gewinn `game_reward`, begrenzt durch `game_daily_cap`. Der Client meldet die Punkte selbst – der Schutz ist eine Obergrenze, kein Beweis. Logik rein in `src/features/games/*.ts` (getestet), Oberflächen als Komponenten.
- **Chat**: „schreibt …“ und sofortiges Nachladen laufen über Supabase Broadcast (Kanal `vokabeltrainer-chat`), ohne Datenbank; Polling alle 4 s bleibt als Rückfall.
- **Optik**: Schwarzes Loch (16 s: zwei gegenläufige Randstreifen, Wirbel, Loch mit geradem Ring und Lichtbögen, lange Haltephase), Klavier-Profilbild (`avatar_piano`), Namens-Effekte „Wirbel“ (eigenes Glühelement, wird nicht abgeschnitten) und „Klaviertasten“ (`effect_piano`, Buchstaben als Tasten).

## 0011 – Alphamod, Gambling, Highscores, Chat-Erweiterungen

- **Rollen:** neue Rolle `alphamod` (Rang 2, goldener „MOD“-Tag). Nur Alphamods und Admins ändern Werte (`staff_set_setting`, Tab „Regeln“); normale Mods verwalten nur Bücher/Prüfanfragen. Ernennung per `admin_set_role`.
- **Ranglistenpunkte ±:** Tabelle `points_adjustments`, `admin_adjust_points`; fließen in `get_leaderboard` und `_week_points` (Liga) ein.
- **Chat:** `!whisper @Name Text` (Spalte `recipient_id`, serverseitig gefiltert), roter Punkt über `chat_reads`/`chat_unread_count` (`ChatProvider`), endgültiges Löschen (eigene, erhaltene Flüsternachrichten, DMs über `delete_my_messages`), Stummschalten `staff_timeout_message` (Mods 1 Min., Alphamod/Admin bis `timeout_max`). Chat-Performance: Gruppierung, `content-visibility`, ältere Beiträge mit pausierten Animationen.
- **Gambling:** `gambling_play`, Chancen/Faktoren/Höchsteinsatz als Einstellungen.
- **Spiele:** kein Bot mehr; Highscores aller Nutzer (`get_game_board`), +`game_record_reward` Coins für neuen Rekord. Neu: Crossy Road, Flappy Bird. Touch-Steuerung auf allen Geräten.
- **Lernen:** Quest-Ziele (`quest_goal_*`) und Wartezeiten (`learn_gap_l1..l4`, Minuten; `get_learning_pool` liefert `last_at`) einstellbar; Multiple Choice, Konjugieren (FR) und le/la-Quiz über `submit_choice` (`daily_stats.choice_correct`, eigene Punkte-/Coin-Grenzen).
- **Shop:** gekaufte, aber entfernte Artikel bleiben sichtbar/auswählbar (`get_shop.active`). Neue Artikel: Radfahrer, Frosch (Avatar + Namen-Effekt).
- **UI:** Modal per Portal (Bestätigungen erscheinen im Sichtfeld), gruppiertes Menü, Einstellungen mit Reitern + Passwort ändern.

## 0012 – Mod-Rechte, Artikel schenken, Tags ausblendbar

- **Mod-Rechte** (nur Admin stellt sie ein, Tab „Mod-Rechte“): Einstellungen `mod_books_all` (alle Online-Bücher ja/nein), `mod_set_all` (alle Zahlen), `mod_shop_prices`, `mod_timeout_max` (Minuten, mind. 1) sowie Tabelle `mod_book_access` (ausgewählte Bücher) und `app_settings.mod_editable` (ausgewählte Zahlen). Alphamods und Admins dürfen immer alles.
- Server: `_staff_can(perm)`, `get_my_permissions()`, neu definiert `can_edit_book`, `staff_set_setting` (Schlüssel `mod_*` nur Admin), `admin_set_item` (Mods nur mit Recht), `staff_timeout_message` (Mods höchstens `mod_timeout_max`); neu `admin_list_public_books`, `admin_set_mod_book`, `admin_set_mod_editable`.
- **Artikel schenken**: `admin_grant_item(user, item, equip)` – kostenlos, optional gleich angezogen, Nachricht an den Nutzer.
- **Tags ausblenden**: `profiles.tags_hidden`, `set_tags_hidden()`. Die Ausgabefunktionen (`get_leaderboard`, `get_chat`, `get_game_board`, `get_sprint_board`, `get_league`, `search_players`, `list_duels`) werden in der Migration per `pg_get_functiondef` umgeschrieben: `role`/`tag_id` werden bei `tags_hidden` zu `user`/`null`.
- Verwaltung: zweistufige Navigation (Moderation · Nutzer · Regeln & Wirtschaft); alle Zahlen stehen in `pages/admin/ruleDefs.ts` (Zahlen-Tab und Mod-Rechte nutzen dieselbe Liste).
- Client: le/la-Quiz nutzt nur Wörter aus den eigenen Französisch-Büchern (`features/french/gender.ts`), Chat-@-Vorschläge, Block Blast mit Portal und einrastendem Teil, Flappy Bird per Tipp auf den ganzen Bildschirm, „Crossy Road“, Melden aus der Suche (`components/books/ReportModal.tsx`), Wartezeit je Lernstufe in der Statistik.

## 0013 – Rechte je Mod/Alphamod

- Tabellen `staff_rights` (Modus für Bücher/Zahlen: `none`/`selected`/`all`, `shop`, `timeout_max`; `null` = Standard aus 0012), `staff_book_access`, `staff_setting_access`.
- `can_edit_book`, `staff_set_setting`, `admin_set_item`, `staff_timeout_message` und `get_my_permissions` prüfen zuerst die eigene Einstellung der Person, sonst den Standard. Ein Alphamod hat nur noch den Tag; Admins dürfen immer alles. Stummschaltung aufheben dürfen alle Mods.
- Admin-Funktionen: `admin_list_staff`, `admin_get_staff_rights`, `admin_set_staff_rights`, `admin_set_staff_book`, `admin_set_staff_setting`, `admin_reset_staff_rights`. UI: Tab „Einzelne Mods“ (`pages/admin/StaffRightsTab.tsx`), der Standard liegt unter „Standard-Rechte“.

## 0014 – Shop-Editor, Schwarzes Brett, Wer ist da, Coin-Rangliste

- **Eigene Shop-Artikel**: `shop_items.custom/style/svg`. Anlegen/Ändern `admin_save_item`, Löschen `admin_delete_item` (nur eigene), alle Nutzer laden sie mit `get_custom_items()` (Store `features/shop/custom.ts`, `useCustomVersion()`). Profilbild = SVG (als `<img>`, serverseitig und im Editor geprüft: keine Skripte, Ereignisse, Links, fremden Bilder, ≤ 30 000 Zeichen; `_svg_is_safe`). Farben, Effekte, Tags, Designs sind strukturierte Angaben (`style` jsonb), nur gültige Hex-Werte kommen ins CSS (`safeHex`). Designs: Hintergrund + 3 Akzente → Palette (`customTheme`), Knopf-Effekt `fx` = `shine`/`rainbow` über `html[data-fx]` und die Klasse `btn-fx`.
- **KI-Prompt** für Profilbilder liegt in `components/shop/ItemEditor.tsx` (`AI_PROMPT`).
- **Artikel entziehen**: `admin_list_user_items`, `admin_revoke_item` (legt auch ab). Das Profil wird beim Zurückkehren zur Seite und alle 60 s neu geladen, damit Geschenke sofort sichtbar sind.
- Neue eingebaute Designs (Lava, Eis, Cyber, Königlich, Minze, Vaporwave, Glanz und Regenbogen je 100 000 Coins) und kurze Tags (GG, HOT, VIP, OG, ★, PRO, MVP, ELITE).
- **Gambling**: `gambling_feed` + `get_gambling_feed()` (Gewinne und Jackpots, 7 Tage); im Admin-Tab „Zahlen“ steht der Rückfluss je 1000 Coins live (`GamblingValue` in `RulesTab.tsx`).
- **Schwarzes Brett**: `board_posts`, `get_board`, `admin_save_board_post`, `admin_delete_board_post`, Seite `/brett`.
- **Wer ist da?**: `get_presence()` (online = letzte 3 Min.), `profiles.hide_presence` + `set_hide_presence`, Seite `/online`.
- **Coin-Rangliste**: `get_coin_leaderboard()`, `get_my_coin_rank()`, Reiter „Coins“ in der Rangliste.

## 0015 – Sperren, Gambling-Bilanz, höhere Limits

- `feature_locks` (Schlüssel games, gambling, sprint, duels, chat, shop, quests): `off_until` plus Regeln `[{days:[1..7], from, to}]` (Berliner Zeit, from=to = ganzer Tag, from>to über Mitternacht). `_feature_locked_raw/_feature_locked` (Admins nie gesperrt), `_feature_guard(key)` wird per Funktions-Umschreibung in `start_game`, `create_duel`, `submit_sprint`, `post_chat`, `buy_item`, `claim_quest` eingehängt (und direkt in `gambling_play`). `get_locked_features()` für alle, `admin_get_feature_locks`, `admin_set_feature_lock`.
- Client: `features/locks/LocksProvider` (Abfrage jede Minute), Menüeinträge mit `lock`-Feld verschwinden (`navGroupsFor(isStaff, locked)`), `Gate` in `App.tsx` für direkte Aufrufe, Admin-Tab „Sperren“ (`pages/admin/LocksTab.tsx`).
- `gambling_stats` (Spiele, gesetzt, gewonnen, bester Gewinn; aus dem Ledger vorbefüllt), `gambling_feed` enthält jetzt auch Verluste (3 Tage), `get_gambling_board()`; Seiten: Rangliste → „Gambling“, Gambling-Seite (Bilanz Top 10, Verluste grau).
- Limits: Shop-Preise ≤ 1 Mrd., `admin_grant_koins` ≤ 1 Mrd. pro Buchung (Guthaben max. 2 Mrd.).
- `components/admin/ManageUser.tsx` („Verwalten“-Schraubenschlüssel in Coin-/Gambling-Rangliste und Wer-ist-da): Coins ±, Artikel schenken/entziehen, Punkte ±. Preis ändern direkt auf den Shop-Karten (Admin / Mods mit Shop-Recht).
- Schnell-Tag im `ItemEditor` (Text + Farbe → Verlauf und Schriftfarbe automatisch). Chat: `!`-Befehlsvorschläge (Tab/Tippen).
- `PresenceProvider`: Nachrichten alle 7 s abgeholt, Anzeige zurückgestellt auf Sprint/Spiele/Gambling/Duell/Lernseiten.
- Testversion: siehe `TESTVERSION.md`.

## 0016 – Konten anlegen, Abschreiben, Panik-Modus, neue Artikel

- `admin_create_user`, `admin_create_users` (bis 60 Zeilen), `admin_set_password`: schreiben direkt in `auth.users`/`auth.identities` (bestätigt, Kennwort per `extensions.crypt`), Profil entsteht über den bestehenden Trigger. Nur gegen PGlite-Attrappen getestet – in echtem Supabase zuerst in der Testversion ausprobieren. UI: Verwaltung → Nutzer → „Konten anlegen“, Kennwort setzen im „Verwalten“-Fenster (`ManageUser`).
- `claim_copy_reward(book, unit, count)`: `copy_rewards`, Einstellungen `copy_reward` (5) und `copy_daily_max` (5); je Buch/Unit und Tag einmal, mindestens 5 Wörter. Seite `/abschreiben` (`pages/Copy.tsx`): „Alles sichtbar“ oder „Erst Deutsch, dann aufdecken“ (Gekonnt/Nochmal), mischen, umgekehrt.
- Panik-Modus (`features/panic`): nur lokal (`localStorage vt_panic`), roter Knopf/Esc auf `/spiele` und `/gambling`; blendet Spiele, Gambling, Chat, Shop aus (Menü über `LocksProvider`, Seiten leiten per `Gate` auf `/` um); Rückgängig in den Einstellungen.
- Neue Artikel: `effect_zocker` („Reicher Zocker“, Dollar-Regen, `.fx-zocker`; Vorlage `dollar` auch im Editor) und `theme_chroma` („Farbwechsel“, `fx: 'hue'`, Palette wandert per `ThemeApplier` durch den Farbkreis).

## 0017 – Riesige Guthaben, Admin-!pay, Wave

- `koin_wallets.balance` und `koin_ledger.amount` sind `bigint`; `_grant_koins(uuid, bigint, …)` liefert bigint, Obergrenze 9 · 10¹⁵. Funktionen mit Guthaben-Rückgabe (`get_wallet`, `buy_item`, `claim_quest`, `redeem_code`, `gambling_play`, `start_game`, `finish_game`, `get_coin_leaderboard`, `admin_list_users`) werden per Umschreiben (pg_get_functiondef + replace) auf bigint gebracht. Shop-Preise bleiben `integer` (≤ 1 Mrd.).
- `admin_grant_koins(uuid, bigint, text)`: bis 1 Billiarde je Buchung (auch Minus). `_parse_coins` (k, m/mio, mrd, b/bio = 10¹², nur für Admins), `_fmt_coins` (Punkte-Schreibweise). `post_chat`: Admin-`!pay` erzeugt die Coins neu (kein Abzug, keine Tages-/Höchstgrenze, höchstens 1 Billiarde); normale Nutzer unverändert (nur Ziffern, `pay_max`/`pay_daily_cap`).
- Client: `lib/coins.ts` (`parseCoins`, `shortCoins`, `MAX_GRANT`), Kurzanzeige im `KoinBadge` ab 1 Mrd., Eingabefelder in „Verwalten“ und „Coins schenken“ verstehen k/m/mrd/b.
- Spiel „Wave“ (`features/games/wave.ts`, `WaveGame.tsx`): Spitze fliegt im 45°-Winkel, Halten = hoch, Loslassen = runter; Stacheln (Dreiecke) von Decke und Boden, Öffnung wird enger, Tempo steigt; Punkte = passierte Stachel-Paare. Server: `game_runs`-Check, `start_game`/`get_game_board`/`finish_game` (Rate 2/s) kennen `wave`.

## 0018 – 3D-Druck-Shop
- Tabellen `print_settings` (alle Preiswerte, vom Admin änderbar), `print_colors`, `print_products`, `print_bans`, `print_orders`. Alle nur über RPC erreichbar (RLS an, keine Grants).
- Preis wird nur serverseitig berechnet (`_print_calc`): STL-Volumen × Filament + Strom + Maschine + Grundgebühr + Marge, Mindestpreis, Beschleunigt-Aufschlag, einmaliger Coin-Rabatt je Bestellung (`discount_coins` → `discount_percent`).
- Status: angefragt → preis_vorgeschlagen → in_bearbeitung → druckt → lieferbereit → geliefert (plus abgelehnt/storniert). Fortschritt wird aus Druckminuten und Serverzeit berechnet (`orderProgress`, 10–90 % beim Druck). Erweiterungspunkt für Klipper/Timelapse: `progress_override`.
- Storage-Bucket `print-files` (privat) mit Policies; Dateien nur Besitzer/Admin.
- Spam-Schutz: Sperren, max. offene Anfragen, Bestellungen pro Tag, max. Menge/Volumen.
- Verdienst-Ziel („Pro-Abo“) zählt Umsatz übergebener Bestellungen, bleibt beim Löschen erhalten (`goal_offset_eur`).
- Client: `/druckshop` (lazy, three.js in eigenem Chunk), Admin-Gruppe „3D-Druck“.

## 0019 – Brett für Mods, Fehler-Wiederholung, Lern-Coins
- Schwarzes Brett: `is_staff()` statt Admin.
- `user_settings.repeat_until_correct`: Learn.tsx wiederholt falsche Fragen in Runden, bis alle stimmen; Lernstand bleibt unverändert, Wiederholungsantworten werden nur einmal gespeichert.
- Trigger `award_answer_koins`: 1 Coin je `learn_coin_every` richtige Antworten (nur Lernen, Online-Bücher, keine Wiederholung), Tageslimit `learn_coin_cap`.

## 0020 – Kleine Hinweise (Benachrichtigungen)
- `user_settings`: `notify_mentions` (an), `notify_chat` (aus), `notify_print` (an), `notify_online` (`off|staff|all`, Standard aus).
- `notify_poll(chat_after, since)` liefert neue Ereignisse als JSON: Chat-Nachrichten (nach Einstellung gefiltert: @-Erwähnung oder Flüstern an mich, bzw. alle), fertige Druckaufträge (`print_orders.ready_at`, per Trigger gesetzt) und wer online kommt (`profiles.online_since`, von `heartbeat` gesetzt; `hide_presence` wird respektiert). Ohne `chat_after` nur Startwerte, damit beim Öffnen kein Nachrichten-Schwall kommt.
- `_print_notify` unterdrückt die „Fertig“-Meldung als großes Fenster, wenn der kleine Hinweis aktiv ist.
- Client: `NotifyProvider` (in `AppShell`) fragt alle 8 s ab und zeigt Hinweise oben rechts (ohne Fokus, auch beim Lernen/Spielen); im Chat selbst keine Hinweise für normale Nachrichten. `lib/mentions.ts` markiert `@Name`-Nachrichten im Chat gelb (gleiche Wortgrenzen-Regel wie die Datenbank).
- Ergänzung 0020: `profiles.activity/activity_at` (von `heartbeat(p_activity)` gesetzt; Kennung wird auf a–z/_ bereinigt, max. 20 Zeichen), `admin_user_status()` (nur Admin: online + Tätigkeit), `admin_list_messages_to(user)`, `user_settings.notify_dm` (`window|edge`). Client: `lib/activity.ts` leitet die Tätigkeit aus der Seite ab; `PresenceProvider` meldet sie beim Seitenwechsel; bei `edge` zeigt `NotifyProvider` Team-Nachrichten als Hinweis, der bis zum Wegklicken bleibt (dann `mark_messages_read`).
- Verwaltung „Nutzer → Benutzer“: Personenliste (Suche, Filter Online/Team/Gesperrt, Online-Punkt, Tätigkeit); Antippen öffnet `PersonSheet` (Status, Nachricht, Zahlen, Coins/Punkte/Artikel/Bücher, Rolle, Konto). Die Online-Liste öffnet dasselbe Fenster.

## 0021 – Vokabeltrainer + und KI
- Tabellen (alle nur per RPC, RLS an): `plus_settings` (Preis, Laufzeit, Coin-Tag, KI-Grenzen, Modellpreise), `plus_requests`, `plus_sales` (paid/gift/coins, Cent), `goal_entries` (manuelle ± Buchungen), `ai_status` (no_key/ok/empty/error), `ai_usage` (Tokens, Kosten in Mikro-Euro), `ai_grammar_sets`, `ai_vocab_sentences` (Cache je Vokabel/Stufe), `ai_results` (gespeicherte Blätter/Tests, je Art höchstens 100). Spalten: `profiles.plus_until/plus_trial_used`, `shop_items.plus_only`.
- Plus: `_plus_active` (Admins immer), `_plus_sync` (legt Plus-Artikel ab, wenn Plus endet), `_plus_apply_perks` (setzt das „+“-Tag, wenn noch keins gewählt ist). `buy_item` bleibt unverändert (Plus-Artikel haben Preis 0 und sind über `get_shop`/`equip_item` nur mit Plus nutzbar).
- Verdienst-Balken: `_goal_total_cents()` = übergebener Druck + Plus-Verkäufe + manuelle Buchungen − KI-Kosten; `goal_offset_eur` gilt weiter. Admin kann Vergaben rückgängig machen (`admin_plus_undo_sale`, bei Coin-Tagen mit Rückerstattung) und manuell ± buchen.
- KI: Edge Function `supabase/functions/ai` (Deno). Schlüssel nur als Secret `OPENAI_API_KEY`. Aktionen `grammar`, `sentences`, `check` (nur Admin). Die Datenbankfunktionen `ai_begin`, `ai_set_status`, `ai_record_usage`, `ai_save_*` sind nur für `service_role` freigegeben. Grenzen: pro Person und Tag/Monat, insgesamt pro Monat. Antworten von OpenAI werden streng geprüft (`lib.ts`, getestet); Themen werden bereinigt und gelten nur als Stichwort.
- Client: `PlusProvider` (`usePlus`), Menüpunkt „Grammatik“ (farbig mit Schloss ohne Plus), `PlusDialog`, `pages/Grammar.tsx`, `components/sheet/*` (Papier-Blatt mit Lücken, Bewertung mit `lib/gaps.ts`, Noten in `lib/grade.ts`), Test-Blatt in `pages/Test.tsx`, Admin-Gruppe „Plus“, `PlusSection` im Personen-Fenster.

## 0022 – Höchstguthaben und automatische Belohnungen
- `_grant_koins` kürzt positive Belohnungen (Liga, Quests, Lernen, Duelle, Sprint …) auf den freien Platz unter 9 Billiarden oder lässt sie entfallen, statt einen Fehler zu werfen. Vorher brach `_league_rollover` ab, sobald ein Top-3-Platz fast am Limit war, und die ganze Liga lud nicht mehr. Strikt (mit Fehler) bleiben Reasons `admin`, `pay_in`, `print_refund`, `plus_refund`.

## 0023 – 3D-Druck ausschaltbar, Coin-Sperre pro Person
- `feature_locks` kennt jetzt den Schlüssel `print` (Verwaltung → Regeln & Wirtschaft → Sperren). `print_get_info`, `print_quote`, `print_create_order` haben `_feature_guard('print')`; Menüpunkt und Seite verschwinden über `NavItem.lock` und `Gate`. Bestehende Aufträge bleiben für Admin und Kunden einsehbar.
- Coin-Sperre: `profiles.coins_locked_at/coins_lock_note`. `_grant_koins` verweigert Abbuchungen gesperrter Personen außer `gambling_bet`, `game_fee`, `admin` (Shop, Bücher, Überweisung/!pay, 3D-Druck-Rabatt, Plus gesperrt); Gutschriften laufen weiter. RPCs `admin_set_coin_lock` (Admins nicht sperrbar, Nachricht an die Person), `admin_coin_locks`, `coin_lock_status`. UI: `CoinLockSection` im Personen-Fenster, Hinweis im Shop.

## 0024 – Plus nur mit Coins, Vorteile
- Stufen (`_plus_tiers`): 1 Tag 100, 1 Woche 600, 1 Monat 3000, 3 Monate 8000, für immer 100000 Coins. Preise stehen in `plus_settings` (Verwaltung → Plus → Preise & Verdienst). `plus_buy(stufe)` bucht über `_grant_koins(…,'plus_buy',…)`; der Verkauf steht mit `kind='coins'` in `plus_sales`. Rückgängig macht die Coins zurück (`plus_refund`).
- Plus-Vorteile: Coins ×1,5 und Ranglistenpunkte ×1,5 (zentral in `_grant_koins` und `_week_points`, Gambling-Gewinne ausgenommen), höhere Gambling-Gewinnchance (`plus_gamble_boost_percent`, in `gambling_play` eingefügt), `plus_make_due` (Stufe 5 → 4), `plus_revive(run)` (Wiederbeleben im Spiel, höchstens `plus_revive_max` pro Runde), zusätzliche Quests.
- Quests in Stufen (`get_quests`/`claim_quest`): pro Familie (answers, perfect, sprint, duel, plus_answers, plus_games) erscheint nach dem Einsammeln die nächste, größere Stufe. Quest-ID = `familie_stufe`.
- Neue Plus-Artikel: Profilbilder Supernova, Portal, Aurora-Kugel, Spiralgalaxie (animiert, `avatars.css`), Effekte Blitzschlag und Hologramm, Farben Lava, Galaxie, Hologramm, Designs Nebel und Cyber.
- Spiele: `Games.tsx` fragt bei Game over mit Plus nach dem Wiederbeleben; der Punktestand läuft mit Versatz weiter. Plus-Grafik: `features/games/plusfx.ts` (Schimmer, Funkeln, Vignette) und `.plus-game` in `index.css`.

## 0025 – Push-Nachrichten (Web Push)
- Tabellen `push_subscriptions` (Geräte), `push_config` (url, public_key, secret), `push_log` (Protokoll). Kein direkter Zugriff, nur über Funktionen.
- `_push_send` ruft per `pg_net` die Edge Function `push` auf (Header `x-push-secret`). Fehler werden protokolliert und blockieren nie die auslösende Aktion. Fehlt pg_net, steht `kein pg_net` im Protokoll.
- Auslöser: `chat_messages` (Erwähnung/Flüstern/optional alles), `user_messages` (Team-Nachricht), `print_orders` (lieferbereit). Es gelten die Schalter aus 0020. Wer in den letzten 90 s aktiv war, bekommt keinen Push (der Rand-Hinweis übernimmt).
- Client: `public/sw.js` (Service Worker), `src/lib/serviceWorker.ts`, `src/services/push.ts`, `src/features/push/PushSettings.tsx` (Einstellungen → Hinweise). Einrichtung: `supabase/functions/push/README.md`.

## Mathe (nur Client, keine Migration)
- `src/features/math/problems.ts`: Aufgaben-Generator für + − × ÷ in 5 Stufen (Division immer ohne Rest, Minus erst ab Stufe 5 negativ), `parseAnswer` liest Eingaben tolerant. Tests in `problems.test.ts`.
- `src/pages/Math.tsx` (Route `/mathe`, Menü „Lernen“): Rechenarten und Stufe wählen, 10/20/30 Aufgaben, Auswertung mit Zeit und Fehlerliste. Die Auswahl merkt sich der Browser. Es gibt keine Coins.

## 0026 – Push auch bei offener App, Push bei „kommt online“
- `_push_idle` liefert immer true (früher: kein Push, wenn die Person in den letzten 90 s aktiv war).
- Trigger `profiles_push_online` (auf `online_since`): Push je nach `notify_online` (alle oder nur Mods/Admins), nicht an sich selbst, nicht bei versteckter Anwesenheit, höchstens alle 10 Minuten pro Person.

## 0027 – Mathe mit Coins/Punkten, Admin-Liga, Korrektur Wochenpunkte
- Mathe: `daily_stats.math_correct`, `submit_math(correct, total, seconds)` (Einstellungen `math_*`, Mindestzeit `math_min_seconds` gegen Schummeln, Coins mit Grund `math`). Punkte fließen in `_week_points` und `get_leaderboard`.
- Korrektur: `_week_points` (in 0024 versehentlich fest verdrahtet) rechnet wieder mit den Einstellungen, Multiple-Choice-, Mathe-Punkten und Admin-Anpassungen; Plus ×1,5 gilt nur für erspielte Punkte (`_plus_points_factor`), auch in der Rangliste.
- `admin_get_league(tier)`: Admins sehen jede Liga (auch fremde). UI: Stufen-Knöpfe in `LeagueView`.
- `components/admin/PageRules.tsx`: aufklappbarer Admin-Bereich unter Lernen, Test, Multiple Choice und Mathe, mit Erklärung und direkt änderbaren Werten.
- Antwortvergleich (`features/learning/answer.ts`): „to“ am Anfang und Bindestriche egal, Schrägstrich-Alternativen (`qc/qn`), Kürzel (qc, qn, sth, sb, etw., jdn. …) und Klammern optional.

## Crashkurs („Noch nichts gelernt“)
Seite `/crashkurs` (`pages/Cram.tsx`), Logik in `features/cram/cram.ts` (+Tests), Karteikarte `features/cram/FlipCard.tsx` (CSS-3D-Flip in `index.css`).
Ablauf: Merken → Karteikarten → Abfrage (falsche kommen nach 3 Wörtern wieder) → schwere Wörter als Karten → Test (10 Wörter, Note per `gradeFromScore`).
Der Stand liegt nach jedem Schritt in localStorage (`cram-session:<userId>`), kein Fokusmodus: Menü und Chat (Fenster per Knopf) bleiben erreichbar. Kein Server/Migration nötig.
Außerdem: eigene Seite `/karteikarten` (`pages/Flashcards.tsx`, nutzt `FlipCard`), Melden-Knopf (`features/cram/ReportBtn.tsx`, öffnet `ReportModal`) in Crashkurs und Karteikarten; „Hab ich gewusst“ (max. 3 pro Crashkurs) in `cram.ts`.

## 0028 – Latein & Spanisch
`languages` bekommt `la`/`es` (Bücher, Suche, Einstellungen lesen die Tabelle). Grammatik: `Lang` in `services/ai.ts` und `supabase/functions/ai/lib.ts`, Themen je Sprache in `TOPICS`, Check-Constraint von `ai_grammar_sets` erweitert. Sonderzeichenleiste je Sprache (`AccentBar lang=…`, `accentsFor()` in `AccentBar.tsx`). **Edge Function `ai` muss neu deployt werden.**

### 0028 Teil 2 (Update 28)
- **Sprint-Zeit kaufen:** `buy_sprint_time(n)` (Einstellungen `sprint_extra_cost` = 100 Coins/Sekunde, `sprint_extra_max` = 30), bezahlt erst beim Start (`pages/Sprint.tsx`).
- **Liga:** alle Nutzer sind Mitglied (Nachtrag + Trigger `profiles_league_member`); `get_league` zeigt alle Mitglieder der eigenen Stufe, auch mit 0 Punkten (Anzeige „–“).
- **Spiele:** `g2048`, `memory`, `bricks`, `mole` (`features/games/*`); `start_game`/`finish_game`/`get_game_board` werden per Text-Patch erweitert (wie bei Wave), Punkte-Obergrenzen je Sekunde im `case` von `finish_game`.
- **Sticker:** Chat-Text `:sticker:<id>:` (`features/chat/stickers.tsx`, selbst gezeichnete SVGs), keine DB-Änderung.
- **Antworten:** Leerzeichen dürfen fehlen (`answer.ts`). **Melden-Knopf** im `QuizRunner` (`reportable`, Lernen und Test). **Tastatur/Scroll:** `lib/keepFocusVisible.ts` (aus `AppShell`) + `preventScroll` beim Fokussieren.

## 0029 – Veröffentlichtes Buch aus „Meine Bücher“ entfernen
Tabelle `book_library_hidden`; `in_library` blendet ein veröffentlichtes Buch des Besitzers aus, wenn dort ein Eintrag steht. `remove_from_library` (Besitzer: verstecken, andere: Bibliothekseintrag löschen) und `add_to_library` (holt es zurück). Beim Zurücknehmen der Veröffentlichung werden die Einträge gelöscht. Das Buch bleibt online und im Reiter „Online“.

## 0030 – Dauerhafte Sprint-Zeit, Spiel „Hüpfer“
- `sprint_upgrades` + `get_sprint_bonus()`; `buy_sprint_time(n)` kauft dauerhaft (100 Coins/s, insgesamt höchstens `sprint_extra_max` = 30 s). Sprint dauert 60 s + Bonus.
- Bricks: feste Steine (2 Treffer, erst angeknackst; `isTough` in `features/games/bricks.ts`).
- Plattformer `jump` (`features/games/jump.ts`, `JumpGame.tsx`, Joystick `joystick.tsx`): Punkte = Strecke/50 + 5 je Münze, Obergrenze 14 Punkte/s im `finish_game`.

## Update 31 – Sprachmenü, irreguläre Verben, neues Hüpfer-Design (keine SQL-Änderung)
- Menü „Lernen“ ist nach Sprache sortiert: `LangPicker` (Englisch, Französisch oben; Spanisch, Latein darunter) setzt `learn_language`; darunter stehen die Einträge der gewählten Sprache (`NavItem.langs`, `navGroupsFor(isStaff, locked, language)`). Sprachunabhängig (unten): Bücher, Suche, Mathe.
- Seite `/unregelmaessig` (`pages/Irregular.tsx`, `features/irregular/irregular.ts`): Englisch Simple Past/Past Participle (~95 Verben, Varianten wie learnt/learned), Französisch Présent je/nous/ils, Participe passé, Futur (22 unregelmäßige Verben), mit Wortliste.
- `JumpGame.tsx`: nur Optik neu (Nachthimmel, Mond, Sterne, Wolken, 3 Parallax-Hügel, Gras-Plattformen, drehende Münzen, Figur mit Augen/Squash, Partikel, Anzeige). Physik in `jump.ts` unverändert.

## 0031 – Duell-Unentschieden, Coreball/Klicker/CPS, Design „Schwarzes Loch“
- `submit_duel` (gepatcht): gleich viele richtige Antworten = Unentschieden (Zeit entscheidet nicht mehr); beide bekommen `duel_reward / 2` (Tageslimit je Person).
- Neue Spiele (`game_runs`-Check, `start_game`/`get_game_board`/`finish_game` gepatcht; Punktegrenzen je Sekunde: coreball 6, clicker 2, cps 3):
  - `coreball` (`coreball.ts`, `CoreballGame.tsx`): Kugeln auf drehenden Kern schießen, `levelConfig(level)` = mehr Kugeln/schneller/Richtungswechsel ab 3/Pendeln ab 6. Score = gesetzte Kugeln.
  - `clicker` (`clicker.ts`, `ClickerGame.tsx`): 30 s, 0,1 Punkte je Klick, gewertet nur gerade ganze Zahlen (`2*floor(clicks/20)`).
  - `cps` (`cps.ts`, `CpsGame.tsx`): 10 s, Score = meiste Klicks in einer Sekunde.
- Design `theme_blackhole` (Shop 250 000 Coins, in 0031 eingetragen; Aussehen in `catalog.ts`, `fx: 'hole'`, `decor: 'blackhole'`): `components/ui/BlackHole.tsx` – `BlackHoleBackdrop` (Horizont, Photonenring, Scheibe, einfallende Sterne) hinter der Seite, `BlackHoleBeams` (Lichtfunken spiralen von zufälligen Menüpunkten ins Loch, über der Seite, `pointer-events:none`). CSS in `index.css`: Verlaufs-Knöpfe `[data-fx='hole']`, `.bh-ring` (Rangliste/Profil, `PlayerTag framed`) und `.bh-bubble` (Chat-Blase): rotierender doppelter Rahmen blau auf weiß. `prefers-reduced-motion` schaltet Animationen aus.

## 0032 – Faire Spiele, Gambling-Erweiterung, Schwarzes Brett mit Autor, Design „Berge“
- **Fairness:** `finish_game` zählt Läufe mit Wiederbelebung (`game_runs.revives > 0`) nicht mehr für Rekord/Belohnung. Memory (`memory.ts`): nur vermeidbare Fehlversuche kosten Herzen, fehlerfreie Runde heilt. Maulwurf (`mole.ts`): Plateau-Tempo, 3 Leben, Bomben, goldene Maulwürfe, 12er-Serie heilt – ohne Zeitlimit. Klicker und CPS-Test sind entfernt (Clients; die Spiel-IDs bleiben in der DB harmlos).
- **Gambling:** `gambling_roulette(jsonb)`, `gambling_dice`, `gambling_wheel` (alle mit `_feature_guard('gambling')`, Einsatzgrenzen, `_gamble_settle`). Oberfläche in `features/gambling/` (Roulette, Dice, Wheel, Slots) mit Tab-Leiste in `pages/Gambling.tsx`.
- **Schwarzes Brett:** `board_posts.created_by/updated_by`; `get_board()` liefert Autor- und Bearbeitername, `admin_save_board_post` setzt sie. `Board.tsx` zeigt „von … · bearbeitet von …“.
- **Wer ist da:** `get_presence()` liefert `hidden`; Admins sehen auch Versteckte (Badge „versteckt“).
- **Design `theme_mountain`** (Shop 250 000 Coins; `fx: 'alps'`, `decor: 'mountains'`): `components/ui/Mountains.tsx` (Canvas: Himmel, Sonnenstrahlen, 5 Bergketten mit Schneekappen, Nebel). CSS `[data-fx='alps']`, `.mt-bubble` (Gipfel über der Chat-Blase; Zeile mit `.mt-row` wegen `content-visibility`), `.mt-ring`.
- **Verläufe:** Wechselnde Verläufe (`fx-rainbow`, `tag-gold`, `bh-flow`, `mt-flow`) laufen hin und her in einem 200 %-Bild – so wandert keine Kachelkante („Strich“) mehr durch.
- Avatar-Emojis liegen auf einer Farbscheibe mit Glanz (`PlayerTag.tsx`), Plus-Vorteile nutzen Lucide-Icons.

## 0033 – Design „Fußball“
- `theme_football` (Shop 250 000 Coins, in 0033 eingetragen; `fx: 'pitch'`, `decor: 'football'`): `components/ui/Football.tsx` – Canvas mit Nachthimmel, Tribüne mit Kamerablitzen, Rasen mit Mähstreifen (einmal vorgerendert), flackernden Flutlichtkegeln und einem hüpfenden, rollenden Ball. CSS `[data-fx='pitch']` (Rasen-Verlaufsknöpfe), `.fb-bubble` (Nachricht als Tor: Pfosten, Latte, Netz; ein Ball fliegt per `::before` im Bogen hinein, Netz wackelt; Zeile mit `.fb-row` wegen `content-visibility`) und `.fb-ring` (Grasstreifen-Rahmen, Ball umkreist per `offset-path`).

## 0034 – Hausvorteil bei Würfeln, Roulette, Glücksrad
- Einstellung `gambling_rtp_permille` (Standard 900 = 90 % Rückzahlung, begrenzt auf 500–950; Admin unter Regeln › Gambling). Würfeln: Auszahlung = Einsatz × rtp / (10 × Chance), Chance höchstens 75 % (vorher 90 %, sah wie sicherer Gewinn aus). Roulette: Auszahlung je Feld × rtp / 973. Glücksrad: × rtp / 975. Der Client (`Dice.tsx`) liest die Quote aus `app_settings`.

## 0035 – Lernpool nur aus eigener Bibliothek
- `get_learning_pool` filtert wieder auf `in_library(book)` (wenn kein Buch gewählt ist) und `is_active_vocab`. Die Version aus 0011 hatte beides verloren, dadurch kamen in Multiple Choice, Lernen, Test, Sprint und Fehler-Training auch Vokabeln aus öffentlichen Büchern, die man nicht verwendet.

## 0036 – Design „Gasthaus“ und blaue Berge
- `theme_food` (Shop 250 000 Coins, in 0036 eingetragen; `fx: 'tavern'`, `decor: 'food'`): `components/ui/Food.tsx` – Canvas mit Karo-Tischdecke und fallenden, selbst gezeichneten Speisen (Schnitzel, Pommes in Tüte, Spätzle in Schüssel, Brezel, Bratwurst, Zitrone; keine Emojis). CSS `[data-fx='tavern']` (goldene Krusten-Verläufe), `.fd-bubble` (Karo-Rand, oben ragen Pommes heraus; Zeile `.fd-row`), `.fd-ring` (Karo-Ring). Die Karomuster sind exakt periodisch, die Animation läuft nahtlos.
- `theme_mountain` ist jetzt komplett blau (Himmel, Strahlen, Berge, Akzente in `[data-fx='alps']`).

## 0037 – Hintergrundfarbe der Emoji-Profilbilder
- `profiles.avatar_bg` (#rrggbb oder null), gesetzt über `set_avatar_bg(text)`, gelesen über `get_avatar_bgs()` (Anzeigename → Farbe). Anzeigenamen sind eindeutig, deshalb lädt der Client die Liste einmal (`features/shop/avatarBg.ts`, wie die eigenen Shop-Artikel, Auffrischung alle 60 s) und `Avatar` schlägt per Name nach – die vielen Chat-/Ranglisten-Funktionen blieben unverändert. Auswahl in Einstellungen › Profil (Vorgaben, eigene Farbe, Zurücksetzen), nur wenn ein Emoji-Profilbild getragen wird. Ohne eigene Farbe gilt die Standard-Scheibe (Farbton aus der Avatar-ID).

- Schwarzes Loch: Die Lichtstrahlen (`BlackHoleBeams`) liegen jetzt hinter dem Seiteninhalt (`-z-[9]` statt `z-[35]`) und pausieren, solange ein Eingabefeld den Fokus hat – vorher flogen sie quer über Chat-Eingabe und Texte.
- Einblend-Animation `animate-rise` nutzt `backwards` statt `both`: Vorher blieb am Seiteninhalt dauerhaft `transform: translateY(0)` hängen; auf Apple-Geräten kann das den blinkenden Textcursor („Strich hinter dem letzten Buchstaben“) in Eingabefeldern springen lassen. Jetzt gibt es nach der Animation keinen Transform mehr.

### 0038/0039 – Gambling verschärft, Black Jack
- 0038: Würfeln höchstens 50 % Chance, Standard-Gewinnquote 85 %. Glücksrad zahlt exakt den Faktor des Felds (Layout bringt ~87,5 % zurück).
- 0039: Black Jack. Tabelle `blackjack_hands` (eine offene Runde pro Nutzer, für Clients gesperrt) hält Deck und Karten. RPCs `blackjack_start`, `blackjack_action('hit'|'stand'|'double')`, `blackjack_current`. Einsatz wird beim Start abgebucht, Auszahlung (inkl. Einsatz) am Ende; die verdeckte Geberkarte wird erst bei Rundenende gesendet. Regeln: 1 Deck pro Runde, Geber zieht bis 17 inkl. weichem 17, Black Jack 6:5, Verdoppeln nur mit 2 Karten, kein Teilen. Neustart mit offener Runde = Verlust der alten Runde. Frontend: `features/gambling/Blackjack.tsx`, `cards.ts`.

### 0040 – Gambling-Einstellungen, Hausschutz, höhere Einsätze
- Höchsteinsatz Standard 10.000 (nur wenn noch 200 gesetzt war). Einsatzfeld mit Schnellwahl bis 100.000, Roulette-Chips bis 5.000.
- Jede Wahrscheinlichkeit einzeln im Admin-Bereich: `gambling_rtp_dice`, `gambling_dice_max_chance`, `gambling_rtp_roulette`, `gambling_wheel_w0/w05/w1/w2/w3/w4` (Gewichte je Faktor, Rad zahlt exakt den Feld-Faktor), `gambling_bj_blackjack_x10` (12 = 6:5), `gambling_bj_dealer_hits_soft17`, dazu Automat wie bisher. `gambling_rtp_permille` wird nicht mehr benutzt.
- Hausschutz `_house_squeeze()`: summiert Einsatz/Auszahlung der letzten 3 Tage aus `gambling_feed`. Liegt der Hausgewinn unter `gambling_guard_target_permille` (Standard 50 ‰) und wurden mindestens `gambling_guard_min_wagered` Coins eingesetzt, wird ein Gewinn mit Wahrscheinlichkeit min(`gambling_guard_max_permille`, Abstand zum Ziel) durch eine Niete ersetzt (Würfeln: Wurf, Rad: Feld, Roulette: neue Zahl, Automat: Walzen, Black Jack: Deck wird neu gemischt). Für Spieler unsichtbar. `gambling_guard_max_permille` = 0 schaltet ihn aus.
- Frontend: `WalletProvider.hold()/release(n)` hält Guthaben-Änderungen und die „+N Coins“-Meldung zurück, bis die Animation fertig ist (vorher sprang die Meldung per Realtime schon beim Drehen auf). Haken „Animationen überspringen“ (`features/gambling/skipAnim.ts`, im Browser gemerkt) gilt für alle Spiele.
- Black Jack neu gestaltet (Sechseck-Tisch, Kartenrücken, Austeilen/Aufdecken animiert).

### 0041 – Riesige Einsätze und Gewinne
- Einsätze/Auszahlungen/Feed/Bilanz rechnen mit bigint (vorher integer, ~2,1 Mrd. Grenze). Zwischenrechnungen mit numeric. Regel `gambling_all_in` (Standard 1): jeder darf bis zum ganzen Guthaben setzen, sonst gilt `gambling_max_bet`.
- Das Höchstguthaben bleibt 9 Billiarden (9·10^15), weil JavaScript darüber Zahlen nicht mehr exakt darstellt; Gewinne über dem Limit werden gekürzt gutgeschrieben (`_grant_koins`).
- Frontend: `lib/compact.ts` (Kurzschreibweise für Chips/Schnellwahl bis 1 Brd.), Einsatz-Obergrenze = max(Höchsteinsatz, Guthaben).

### 0042 – Live-Duell, Online-Anzeige, Namen ändern
- Live-Duell (bis 4 Spieler): Tabellen `live_duels`, `live_duel_players` (für Clients gesperrt), RPCs `live_create/live_my_invites/live_respond/live_leave/live_start/live_get/live_progress/live_finish`. Host lädt 1–3 Personen ein (bekommen zusätzlich eine Nachricht, damit Push ankommt), Fragen aus Vokabeln, die ALLE Beigetretenen aktiv haben, Start nach 4 s Countdown (Serverzeit aus `live_get.now`), Fortschritt jede Sekunde per Polling, Rangfolge (richtig, dann Zeit), Sieger bekommt `live_duel_reward` (zählt zum `duel_daily_cap`). Hängende Runden werden nach q_count·60+120 s abgeschlossen.
- Frontend: `pages/LiveDuel.tsx` (Einladen), `pages/LiveDuelRoom.tsx` (Lobby → Countdown → Rennen mit `features/duel/RaceTrack.tsx` → Podium), `features/duel/LiveInviteWatcher.tsx` (Einladungskarte, fragt alle 5 s). Routen `/live-duell`, `/live-duell/:id`.
- Online-Fenster 75 s statt 3 min (SQL ersetzt `interval '3 minutes'` in allen Funktionen mit `last_seen_at` automatisch); die App meldet sich alle 30 s. „Zuletzt gesehen“ zählt minutengenau. Admins sehen in „Wer ist da?“ zusätzlich die Tätigkeit (`admin_user_status`).
- `admin_rename_user` (Admin ändert Anzeigenamen, Name eindeutig); UI im Personen-Fenster.
- Mitteilungen: `features/push/PushPrompt.tsx` meldet das Gerät still an, wenn die Erlaubnis schon vorliegt, sonst kommt alle 3 Tage ein Hinweis zum Einschalten (iPad: Hinweis zum Home-Bildschirm). Die Schalter für @, Team-Nachrichten und Hinweise sind schon standardmäßig an.

### 0043 – Klassen-Battle (bis 20 Spieler)
- Erweitert das Live-Duell: `live_duels.book_id/max_players/code`. `live_create(p_invitees, p_count, p_book)` mit Buch = Klassen-Battle (bis 20 Spieler, 4-stelliger Code, Fragen aus allen Vokabeln des Buchs, egal ob aktiv); `live_join_code(code)` zum Beitreten, `live_respond` prüft die Platzzahl. Frontend: Reiter „Live-Duell · bis 4“ / „Klassen-Battle · bis 20“ in `pages/LiveDuel.tsx`, Code-Karte und kleinere Plätze in `LiveDuelRoom`.
- `RaceTrack`: ab 5 Spielern kompakt (die Besten + du, mit Platz). Das Profilbild-Element hat bewusst keinen `key`: sonst startet animierte Profilbilder (Schwarzes Loch) bei jeder Antwort ihre 16-s-Animation neu und wirken leer.

### 0044 – Siegprämien, offene Klassen-Battles, Team-Parkour
- Einstellungen (Admin → Zahlen, Bereich Coins): `live_duel_reward`, `live_class_reward_1/2/3`, `team_reward`, `team_parkour_reward`, `team_lives`, `team_daily_cap`. `_live_finalize` zahlt über `_live_pay` (Tageslimit `duel_daily_cap`); `live_get` liefert `rewards` für die Lobby-Anzeige.
- Offene Klassen-Battles: `live_open_classes()` und `live_join_open(id)`; Liste in `pages/LiveDuel.tsx` (Reiter Klassen-Battle), Aktualisierung alle 4 s.
- Team-Spiele für 2 Personen: Tabelle `team_runs` mit `kind` = `parkour` oder `quiz`; RPCs `team_create/_my_invites/_respond/_start/_get/_leave`, für Quiz `team_report`, für Parkour `team_parkour_finish` (frühestens 60 s nach Start, zahlt `team_parkour_reward` an beide, Limit `team_daily_cap`, Grund `team`).
- **Team-Parkour** (`features/parkour/`): `levels.ts` (Kachelkarten per Builder: Block, Stacheln, Checkpoint, Ausgang, Druckplatten a/b/c, Türen A/B/C, Brücken x/y/z), `engine.ts` (reine Physik: Laufen, Sprung mit Koyote-Zeit und Puffer, Doppelsprung (ein Luftsprung; Stachelgruben und Brücken sind deshalb 12 Kacheln breit, die Reichweite liegt unter 11), Räuberleiter = auf dem Kopf des Partners landen, Leine max. 17 Kacheln, Tod durch Stacheln/Abgrund/Einklemmen), `ParkourGame.tsx` (Canvas, Joystick + Sprungknopf, Tastatur). Jeder simuliert nur sich selbst; Positionen gehen alle 50 ms über einen Supabase-Realtime-Broadcast-Kanal `parkour-<id>`. Platten, Türen und Brücken berechnet jeder Client aus beiden Positionen. Level wechselt, wenn beide im Ausgang stehen; nach Level 3 meldet jeder `team_parkour_finish` (idempotent). Realtime muss im Supabase-Projekt aktiv sein (Broadcast braucht keine Tabelle).
- Quiz-Variante (`pages/TeamRunRoom.tsx`, `features/team/TeamTrack.tsx`): pro Hindernis eine Frage je Person, weiter nur wenn beide richtig, falsche Antwort kostet ein gemeinsames Leben.
- Lobby/Countdown/Ergebnis für beide Arten in `pages/TeamRunRoom.tsx`, Route `/team/:id`, Einladungen über `LiveInviteWatcher`.
- Animierte Profilbilder (`.av`) sind jetzt `inline-block`: in Block-Containern (Lobby, Rennstrecke) hatten sie sonst keine Größe (unsichtbar oder riesig).
- Spanisch: `isAnswerCorrect` ignoriert Akzente, ñ, ü sowie ¿ ¡ ? !, wenn die Lernsprache Spanisch ist (`setAnswerLanguage` aus `SettingsProvider`).

### 0045 – Team-Parkour: 8 Level, Herzen, Coins nach Fortschritt, Duo-Bestenliste
- 8 Level in `features/parkour/levels.ts` (Builder-Makros `chain`, `bridgeGap`, `tower`): 1–3 Einstieg, 4 schmale Plattformen, 5 Türme mit Platten oben, 6 Doppelbrücke, 7 Stachelfelder, 8 Finale mit allem.
- Gemeinsame Herzen (`team_lives`, Standard 3): jeder Sturz eines der beiden kostet eins (jeder zählt die Tode des Partners aus dem Broadcast mit), ein geschafftes Level bringt eins zurück, bei 0 ist der Lauf verloren. Das Frontend meldet dann `team_parkour_finish(p_id, p_millis, p_deaths, p_levels, p_cps)`.
- Neustart-Knopf (Taste R, ohne Herzverlust, 1,5 s Pause): Respawn an einem erreichten Checkpoint, der im Bild ist (der nächste); sonst beim Partner (wenn dieser am Boden steht), sonst beim letzten Checkpoint. Gilt auch nach einem Sturz.
- Coins: `parkour_coins_level` je Level, `parkour_coins_cp` je erreichtem Checkpoint, `parkour_coins_bonus` für alle 8 Level, jeweils für beide; Mindestdauer 12 s je gemeldetem Level; Tageslimit `team_daily_cap`.
- `team_parkour_board()`: bester Lauf je Duo (Level, Checkpoints, Zeit), Top 20; Anzeige im Reiter „Team-Parkour“ in `pages/LiveDuel.tsx`.

### 0046 – Team-Parkour endlos
- `features/parkour/generator.ts`: nach den 8 handgebauten Leveln erzeugt `generateLevel(seed, n)` zufällige Level. Seed = Lauf-ID + Levelnummer (`rng` = mulberry32), daher haben beide Spieler dasselbe Level, ohne dass etwas übertragen wird. `levelFor(seed, n)` wählt handgebaut oder zufällig.
- Schwierigkeit d = n − 7: mehr Abschnitte (5 + d, höchstens 18), breitere Stachelfelder (bis 6), mehr und schmalere Plattformen mit größeren Lücken, ab d 2 Türme, ab d 3 Doppelbrücken. Alles bleibt in Sprungreichweite (Doppelsprung ≈ 7 Kacheln weit, 5 hoch); Tests in `generator.test.ts` prüfen Gültigkeit (Ausgang, Platten-Paare, Spawn frei) für viele Seeds.
- Der Lauf endet nur durch aufgebrauchte Herzen. `team_parkour_finish` erlaubt bis zu 500 Level; ab Level 9 gibt es `parkour_coins_endless` Extra-Coins je Level. Status `won` ab Level 8.

### Parkour-Fix: Herzen nur durch Stacheln
- `parse()` setzt in jeder Schlucht (Zeile 10 und 11 leer) unten Stacheln. `stepBody` liefert `dead` nur bei Stacheln (kostet ein Herz, auch für den Partner); Einklemmen in Türen und Herausfallen aus der Welt liefern `lost` = Neustart ohne Herzverlust. Respawn prüft per `spotIsSafe`, dass man nicht in Block/Stacheln startet. Keine SQL-Änderung.
- Fix: Partner-Position (Leine, Platten, Räuberleiter, Respawn, Kamera) zählt nur, wenn er im selben Level ist (`remote.lv === lv`). Vorher wurde, wer zuerst ins nächste Level kam, an die alte Partner-Position gebunden, in die Wand geschoben und verlor beim Start ein Herz.
- Admins springen im Parkour vierfach (`Input.airJumps` = 3, sonst 1; `useAuth().isAdmin`). Level 4 hat zusätzlich einen Checkpoint vor der Säule (Spalte 80). `reach.test.ts` sucht per Zustandssuche allein (alle Platten gedrückt) einen Weg zum Ausgang und prüft so die Sprung-Geometrie aller 8 Level.
