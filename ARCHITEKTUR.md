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
- Leinen-Fix: Platte und Tür müssen zusammenpassen (Leine 17 Kacheln). Level 5 und 8 sowie das Zufalls-Stück „Turm“ hatten die Tür 18+ Kacheln von der Platte entfernt, so dass man nie durchkam. Jetzt: Turm-Platte, Tür, danach niedrige Säule mit Platte (höchstens 16 Kacheln zwischen den Platten). `reach.test.ts` prüft das für alle Level und mehrere Zufallslevel.

### 0047 – Parkour-Shop
- `parkour_profiles` (nur über RPC): gekaufte Extra-Herzen, besessene Farben/Hüte, ausgerüstete Farbe/Hut. RPCs `parkour_shop_get`, `parkour_shop_buy(item)` (`heart`, `color:<id>`, `hat:<id>`; Zahlung über `_grant_koins`, Grund `shop`), `parkour_equip(color, hat)`. Preise aus `app_settings` (`parkour_heart_price` × Anzahl, `parkour_heart_max`, `parkour_color_price`, `parkour_hat_price`, Premium ×3). `team_get` liefert je Person `pk_hearts/pk_color/pk_hat`; der Herzvorrat im Spiel ist `team_lives` + Extra-Herzen beider Personen. Katalog-IDs: `features/parkour/cosmetics.ts` (Test gleicht sie mit dem SQL ab). Seite `/parkour` (Menü „Parkour“ neben „Spiele“).
- Zusätzlich im Spiel: Schonfrist von 1,5 s nach Start/Neustart (Stacheln kosten dann kein Herz), Versions-Hash der Level in jeder Nachricht – bei Abweichung zeigt das Spiel „unterschiedliche Spiel-Versionen, Seite neu laden“. Admins: Vierfachsprung und Flugmodus (Taste F, W/S/A/D).

### 0048 – Parkour mit bis zu 5 Personen
- `team_run_extras` (run_id, user_id, state invited/joined/declined/left, paid): bis zu 3 weitere Mitspielende neben Host und Partner (nur Parkour). `team_create(..., p_extra uuid[])`, `team_my_invites/_respond/_leave/_start/_get/_parkour_finish` kennen sie. `team_get.people` enthält je Person `state`; im Spiel zählen nur Host und `joined`. Auszahlung an alle Beigetretenen. `team_parkour_board` liefert `group_size`.
- Spiel: keine Leine mehr (unendlich weit auseinander), Kamera folgt nur der eigenen Figur, Randpfeile zeigen Mitspielende außerhalb des Bildes, Ausgang öffnet, wenn alle aktiven (Nachricht jünger als 2,5 s) im Ausgang stehen. Herzvorrat: Grundherzen + 1 ab der dritten Person + Extra-Herzen aller (höchstens 20). Sendetakt 50/70/90 ms je nach Anzahl. Admin: Geistmodus (Taste G) fliegt durch Wände und Türen.

### 0049 – Deathrun
- `team_runs.kind` = `deathrun`; Tabelle `deathrun_results` (je Person Level, Checkpoints, Zeit, Stürze, Coins). `team_deathrun_finish` (Coins wie Parkour, Tageslimit `team_daily_cap`) meldet die Person; `_deathrun_close` beendet den Lauf, sobald jede beigetretene Person ein Ergebnis hat. `deathrun_board()` = beste Läufe einzelner Personen. `team_get` liefert `results`.
- Spiel (`ParkourGame`, `kind === deathrun`): eigene Herzen (`team_lives` + eigene Shop-Herzen), eigenes Level (Ziel erreicht = sofort nächstes Level), kein Folgen fremder Level, keine geteilten Checkpoints/Tode; Platten, Türen, Brücken und Räuberleiter wirken nur zwischen Personen im selben Level; wer allein im Level ist, für den sind alle Tore offen; ausgeschiedene Personen senden `el` und werden ausgeblendet. Beim Verlassen der Seite wird der Stand gemeldet.
- Bestenlisten (Team-Parkour und Deathrun) stehen jetzt auf der Seite Rangliste (Reiter „Parkour“, `pages/ParkourBoard.tsx`), nicht mehr unter Duell.

### 0050 – Offene Deathrun-Lobby, Bots, Wiedereinstieg, Zuschauer, Effekte
- `team_runs.is_open` (offene Lobby, nur Deathrun; Host = Partner = erste Person, `partner_state = 'left'`), `bots` (0–8) und `bot_skill` (1–3). `deathrun_open_join()` tritt der ältesten freien offenen Lobby bei, legt sonst eine an, und bringt Personen zurück in einen laufenden offenen Lauf. Bei 5 Personen startet der Lauf automatisch; `team_start` für offene Lobbys: Mods/Admins immer, sonst jede beigetretene Person, solange kein Mod/Admin beigetreten ist (`_run_staff_present`). Verlässt der Host eine offene Lobby, wird die nächste Person Host (`_team_promote`).
- `team_set_bots` (Mods/Admins, bei privaten Lobbys auch der Host). Bots läuft auf dem Rechner der Person mit der kleinsten Nutzer-ID im Lauf (`bots.ts`: vorausrechnende Läufer, alle Tore für sie offen, kein Coin-Lohn); die Stände gehen als Event `b` über denselben Kanal, ein Wechsel des Steuerrechners übernimmt den letzten Stand.
- `team_rejoin`: wer ausgestiegen oder rausgeflogen ist, kommt in einen laufenden Parkour/Deathrun zurück; Host-Wechsel statt Abbruch (`team_leave`); `team_get` hält laufende Läufe am Leben (`updated_at`). Der Spielstand (Level, Herzen, Zeit) liegt 15 Minuten in `localStorage` (`pkr:<lauf>:<nutzer>`).
- Netz im Spiel: Kanal wird bei Fehlern (CHANNEL_ERROR/TIMED_OUT/CLOSED), bei 6 s Funkstille, nach `online`/Sichtbarwerden neu aufgebaut; Nachrichten mit Laufnummer `n` je Sitzung `sid` (Veraltetes wird verworfen), Werte werden begrenzt, große Positionssprünge werden nicht weich nachgezogen, Stillstand sendet nur alle 350 ms.
- `admin_open_runs()` und `team_spectate()` (nur Admins): Übersicht aller offenen/laufenden Parkour- und Deathrun-Läufe (`/laeufe`) und unsichtbares Zuschauen (`/team/<id>?zuschauen=1`): Geist ohne Senden, ohne Herzen, folgt einer Person oder fliegt frei.
- Boden-Upgrades (`pickups.ts`, nur im Client, aus Lauf-ID und Level deterministisch): 3er-Sprung (20 s) und Jetpack (25 s, 5 s Schub, Sprungknopf in der Luft halten); Aura/Flamme sehen auch die anderen (`bf`).
- Kosmetik: Effekte (`fx.ts`: Notenstrahl, Schwarzes Loch, Blitze …), weitere Farben und Hüte; `parkour_profiles.fx`, `parkour_equip(color, hat, fx)`, `_pk_price` (Preise: `parkour_fx_price`, Premium ×3), `team_get.people[].pk_fx`.
- Joystick: setzt sich bei pointerup/cancel, verlorenem Pointer, Fensterfokus-Verlust, Tab-Wechsel und wenn kein Finger mehr auf dem Bildschirm ist zurück; Textmarkieren (`selectstart`), Kontextmenü und Lupe sind im Spiel gesperrt.

## Update 57: Bots als echte Mitspieler, Jetpack-Flugmodus, Loch unter dem Spieler
- Bots (`bots.ts`) bekommen einen `BotCtx` (Menschen/andere im Level): sie stehen auf Platten, bis Menschen durch sind, haben selbst feste Türen/Brücken und warten auf Menschen. Nach 14 s ohne Hilfe werden sie hinter das Tor gesetzt.
- In `ParkourGame.tsx` zählen Bots im selben Level für Platten (`pressedMap`) und als Kopf-Landefläche. Notausgang: steht ein Mensch 12 s vor einem Tor, das nur Bots hätten öffnen können, sind alle Tore 40 s offen.
- Jetpack = Flugmodus wie beim Admin für 20 s (Sprung = hoch, „Runter“-Knopf/S = runter, keine Stacheln, Wände bleiben fest). Kein Treibstoff mehr (`JET_FUEL` entfernt).
- `fx.ts`: Schwarzes Loch liegt flach unter den Füßen (Anker `cx`/`foot`).

## Update 58/59: Bots kommen zurück, Meister-Bot, gemischte Bots, weniger Upgrades
- Bots bleiben auf der Platte, bis jeder Mensch ganz hinter dem Tor ist (nicht nur an der Tür). Steht ein Mensch noch 0,8 s vor einem Tor, das der Bot schon passiert hat, läuft der Bot zur nächsten Platte dieses Kanals zurück (`forgottenGate`, danach 30 s Pause gegen Hin-und-Her).
- Bots sprechen sich ab (`BotCtx.bots`, vom Steuerrechner in `ParkourGame` gefüllt): Hält schon ein Bot die Platte eines Tors oder ist unterwegs dorthin, stellt sich kein zweiter dazu, sondern geht weiter. Zusätzlich halten Bots Abstand: steht ein laufender Bot mit kleinerer Nummer auf derselben Stelle, wartet der andere kurz (mit Pause danach).
- Pläne enden bei der Landung (der Bot plant danach neu, statt blind weiterzuspringen). Checkpoints merkt sich ein Bot auch im Sprung.
- Können 4 = Meister: Bremsen in der Luft für schmale Inseln (`candidates` Modus 2/3). Können 3 und 4 benutzen außerdem **einprogrammierte Wege** (`routes.generated.ts`): bildgenau per Strahlsuche berechnet für alle Stachelabschnitte der handgebauten Level 7 und 8 (je Checkpoint und Startplatz 0–4). Am Checkpoint wird der Bot auf die Startstelle des Wegs gesetzt (wenige Pixel) und spielt den Weg ab. Wege durch Abschnitte mit Türen/Brücken gelten nur, wenn kein Mensch im Level ist (alle Tore offen).
- Gemischte Bots (`botmix.ts`): `team_runs.bot_skill` = 1–4 (alle gleich, alte Lobbys) oder ab 10 `10 + n1 + 9·n2 + 81·n3 + 729·n4`. Lobby: je Stärke ein Plus/Minus, zusammen höchstens 8.
- `0051_master_bot.sql`: Prüfregel `bot_skill` 1–7000 und `team_set_bots` ohne die alte Obergrenze 3.
- Boden-Upgrades deutlich seltener (erstes ab Spalte ~36, danach etwa alle 70–100 Spalten).
- Testlauf (`bots.test.ts`, Level 1–14): Profi und Meister schaffen 13–14 von 14, in Level 7 und 8 mit allen Herzen.

## Update 60: Bots achten aufeinander, Meister klettert wieder
- Der haltende Bot wartet auf der Platte auch auf andere Bots, die noch vor dem Tor sind (bis 30 Kacheln dahinter, höchstens 40 s). Sind Menschen oder andere Bots im Level, gelten die Tore für die Bots; alle Tore offen nur, wenn der Bot allein ist (`allOpen`). Der letzte Haltende kommt nach der Wartezeit hinter das Tor.
- Meister: Bremsplanung nur noch, wenn gar kein normaler Sprung geht (vorher wartete er an der Säule von Level 7 auf einen „besseren“ Plan, lief gegen die Wand, ging zurück und sprang in die Stacheln).

## Update 61: Bots auf beiden Seiten, Effizient-Bot, Zuschauen mitten im Lauf, Tore für Zuschauer
- Stehen zwei Bots auf Platten desselben Kanals auf verschiedenen Seiten eines Tors, bleibt der vordere stehen und wartet, bis der hintere durch das offene Tor ist (`holdWanted`: ein Halter weiter vorn hat Vorrang).
- Neues Können 5 „Effizient“ (zwischen Profi und Meister): Profi-Planung, einprogrammierte Wege (`routes.generated.ts`) und einfache Bremspläne, Bremspläne nur jedes 2. Bild, keine feine Suche. Testlauf Level 1–14 in ca. 2 s (Meister rechnet ein Mehrfaches). `botmix.ts`: Mischung als laufende Nummer (`10 + Index` in `MIXES`, alle Aufstellungen mit höchstens 8 Bots), passt in die vorhandene Spalte, **kein neues SQL**. Alte Codes aus Update 59 (Basis-9-Zahl) sind ungültig, Lobbys halten aber nur Minuten.
- Admins können mitten im Lauf „👻 Zuschauen“ drücken (`watchApi` in `ParkourGame`): Geist ohne Senden (die anderen sehen sie als ausgeschieden und ausgeblendet), Flug durch Wände und Tore; „Zurück ins Spiel“ setzt am Anfang des aktuellen Levels neu an.
- Zuschauer (auch der Seiten-Zuschauer `?zuschauen=1`) kommen jetzt durch das Ziel in das nächste Level, durch den linken Rand in das vorige und haben Knöpfe „◀ Level“ / „Level ▶“.

## Update 62: Wettlauf im Team-Parkour (Bots oder anderes Team), Bots im Deathrun beim Erstellen
- SQL `0052_versus.sql` (wiederholbar): Spalten `versus` (0 normal, 1 gegen Bots, 2 Team gegen Team), `team_map` (Person → 0 rot / 1 blau), `team_results`; `team_set_bots` gilt auch für Team-Parkour, `team_set_versus`, `team_parkour_finish` meldet bei Versus 2 je Team; Bestenliste nur für `versus = 0`.
- Lobby (`TeamRunRoom`): „Gegner“ Keiner / Bots / Anderes Team; bei Team gegen Team Rot/Blau pro Person (Standard abwechselnd). Bot-Mix wie im Deathrun, bei Versus 1 als „Bot-Team“.
- `ParkourGame`: Gegner liegen in `rivals` (Team gegen Team) bzw. als Bot-Team (alle Bots im selben Level, gemeinsame Herzen `bgh`, im Ausgang „geparkt“ bis alle durch sind). Gegner sind sichtbar (roter/blauer Ring), aber ohne Wirkung auf Platten, Tore und Herzen. Wer keine Herzen mehr hat, scheidet aus; Urteil in `checkVerdict`: das weiter gekommene Team gewinnt (bleibt ein Team übrig, muss es die Ebene des anderen übertreffen). Ergebnis lokal in `pkrvs:<id>:<me>` und (Versus 2) serverseitig in `team_results`.
- Wer allein im Team ist, geht allein durch Ziel und Tore (`soloTeam`).
- Bots: tote/wartende Bots und tote Menschen zählen für die Bots weiter (sie „vergessen“ niemanden mehr); Checkpoints werden auch ±1 Spalte neben dem Fahnenmast im Sprung registriert.
- `LiveDuel`: beim Anlegen eines Deathruns können Bots (Mix) gleich gewählt werden (`teamSetBots` direkt nach `teamCreate`).

## Update 63: Doppelbrücken-Bots, Bot-Texturen, Bots in der Deathrun-Rangliste, Admin springt aus dem Zuschauen ins Spiel
- `bots.ts`: Laufende Bots zählen in der Vorausberechnung nicht mehr als „hält die Platte“ (`simOthers`: nur Menschen und stehende Bots); das war der Grund, warum Bots immer wieder in eine Brücke sprangen, die gleich wieder weg war.
- Gibt es keinen sicheren Sprung, wohl aber bei offenen Toren, wartet der Bot vor dem Tor (`gateWait`) statt hineinzuspringen; vor einer Tür/Brücke läuft er zur Platte.
- Staffel an Brücken und Türen: der hintere Bot wartet auf der Platte; der vordere stellt sich danach auf die Platte hinter dem Tor (`takeoverGate`, Modus `goto` mit `take`), bis der hintere durch ist. Der hintere hält so lange, bis der vordere dort steht (Zeitfenster 10 Kacheln, max. 8 s). `BotInfo.take` meldet das den anderen Bots. Wer in `goto` ist, geht weiter, wenn schon jemand anderes die Platte hält.
- Tests: `duoSim.ts` + `duo.test.ts` lassen mehrere Bots zusammen Level laufen (Doppelbrücke mit 2 und 3 Bots, Level 1–14).
- `ParkourGame`: Jede Bot-Stärke hat Farbe und Muster (Punkte, Streifen, Schrägstreifen, Gitter, Pfeile). Der Stand der Bots wird in `pkbots:<id>` gemerkt und in der Ergebnisliste des Deathruns mit einsortiert (`TeamRunRoom` → `Results`).
- Admin „Hier mitspielen“: aus dem Zuschauen geht es genau an der Stelle des Geists ins Spiel (liegt sie in einer Wand oder in Stacheln, an der nächsten freien Stelle), mit 1,5 s Schonfrist.

## Update 64: Zuschauer steigt ins Spiel ein, Decke, Turm ohne Falle, Bots klettern auf Türme
- Admin im reinen Zuschauer-Modus (`?zuschauen=1`) bekommt „Hier mitspielen“ wie beim Zuschauen mitten im Lauf: Einstieg an der Stelle des Geists, als Gast (seine Stürze kosten dem Team keine Herzen, `dc` wird mit 0 gesendet).
- `engine.ts`: oben im Level ist eine Decke (`solidAt` für `ty < 0`, Flug klemmt bei y ≥ 0): man kommt weder durch Sprung noch Jetpack noch Flug über den Bildrand (vorher ließ sich so über Türen hinweg fliegen). Gilt auch für die Bots.
- `levels.ts` `tower`: Lücken zwischen den Stufen sind bis zur niedrigeren Stufe gefüllt; wer oben herunterfällt, landet auf einer Stufe und steckt nicht mehr in einer zu hohen Grube fest (betrifft Level 5, 8 und alle erzeugten Türme).
- `bots.ts`: Ein Bot, der zu einer Platte oben auf einem Turm zurück will (`goto`), läuft erst zum Fuß der Treppe (`viaDone`) und klettert dann hinauf, statt von der falschen Seite vergeblich an der Wand zu springen; das Tor öffnet sich so für den Menschen, ohne dass der Bot „weitergesetzt“ werden muss.

## Update 65: Turm-Nische, Admin-Auftritt mit Schwarzem Loch
- `levels.ts` `tower`: die Lücken zwischen den Stufen sind wieder offen, unten liegen Stacheln (wer hineinfällt, startet am Checkpoint neu). Level 5: der Checkpoint hinter Turm b stand in der Nische zwischen Turm und Tür und sperrte zwei Spielende ein; er steht jetzt hinter der Tür (Spalte 63).
- `bots.ts`: Ein Bot in einer solchen Nische (Weg zur Turm-Platte, nach 8 s ohne Fortschritt) startet am Checkpoint neu (kein Herz), statt ewig an der Wand zu springen.
- `adminFx.ts` (neu): Admin-Figur als kleines Schwarzes Loch (Leuchten, Linsenbögen, Akkretionsscheibe hinten/vorn, Galaxie im Körper, Funkeln, leuchtender Name mit Sternen) und die Loch-Animationen `in`/`out`.
- `ParkourGame`: Admins werden so gezeichnet (auch von den anderen: Rolle `admin` in der Mitspielerliste bzw. `ad` im Zustand). Beim Einsteigen (zu Beginn, aus dem Zuschauen) öffnet sich ein Loch, der Admin fällt heraus (Nachricht `ev: 'in'`, alle sehen es). Beim Zuschauen öffnet sich ein Loch unter ihm, er fällt hinein und verschwindet mit ihm (`ev: 'out'`, 1,5 s gesperrt, dann Geist). Ein Gast-Admin (vorher nur Zuschauer) lädt Farbe, Hut, Effekt und Extra-Herzen aus dem Shop (`parkourShopGet`), sendet Name und Aussehen (`lk`) mit und erscheint mit seinem Namen statt „Du“.

## Update 66: Lernen im Parkour, weniger Coins
- Speedups (3er-Sprung, Jetpack) liegen nicht mehr auf dem Boden: Alle ca. 38 s erscheint am rechten Bildrand ein Angebot mit ablaufendem Balken (14 s). Tippen öffnet `LearnOverlay`: 1 Vokabel richtig beantworten, dann gilt der Speedup 20 s. Falsch oder abgelaufen = weg. Admins bekommen keine Angebote (sie fliegen/springen sowieso). `pickups.ts` bleibt nur noch für `PICKUP_INFO`.
- Zwischen den Leveln (Ausgang erreicht) müssen 2 Vokabeln richtig sein (falsche Antworten zeigen die Lösung, dann kommt eine neue Frage). Während einer offenen Frage steht die Figur still (`learnBusy`, Schritt wird übersprungen), die Verbindung läuft weiter.
- `parkourLearn.ts`: Pool = aktive Vokabeln (`getLearningPool(null, null)`); gibt es keine, Einträge von bis zu 3 öffentlichen Büchern (`listPublicBooks` + `getBookEntries`). Ist gar nichts erreichbar, wird nicht gefragt (blockiert nie). Fragen über `makeQuestion`, Antwortprüfung `isAnswerCorrect`.
- Admin-Schalter: Tabelle `parkour_learn_off`, RPCs `parkour_learn_off_list(uuid[])` (alle angemeldeten Personen) und `parkour_learn_set(user, off)` (nur Admin). In der Lobby (Parkour und Deathrun) zeigt `LearnToggles` Admins An/Aus je Person, auch für sich selbst. Das Spiel liest beim Start das eigene Flag.
- SQL `0053_parkour_learn.sql` (wiederholbar): Tabelle und RPCs wie oben; Coins gesenkt (Level 5, Checkpoint 1, Bonus 20, Endlos 3, nur wenn die Werte aktuell höher sind).

## Update 67: Bots – Turm-Lücke, Fahnen, Warten auf Menschen
- `bots.ts` Turm-Lücke: Ein Bot oben auf einem Turm springt nicht mehr in die Lücke zwischen Turm und Tür, solange niemand sonst die Platte hält (`ledgeT`, wartet bis zu 45 s; steht er auf der Platte, hält er sie offen). Dort kam man mit geschlossener Tür nicht mehr heraus. Außerdem zielte `goto` hinter der Tür fälschlich auf den Fuß der Turmtreppe (`via`), obwohl die nächste Platte der Pfeiler war; `via` gilt jetzt nur, wenn die nächste infrage kommende Platte selbst oben auf dem Turm liegt.
- Fahnen: `finishStep` zählt jede Fahne, die seit dem letzten Schritt überquert wurde (`px`), auch bei hohen Sprüngen darüber.
- `ParkourGame`: Bots bleiben am Start des nächsten Levels stehen, bis der erste Mensch (er lernt zwischen den Leveln noch) dort angekommen ist (`humanMax`); der Bot-Team-Wechsel (Versus mit Bots) wartet ebenso.
- Tests in `duo.test.ts`: Turm-Lücke (kein Bot im Loch bei weit entferntem Menschen) und Fahnen (nach dem Level ist die letzte Fahne gemerkt).

## Update 68: Mods mit Zuschauer-Recht und Hammer, nur aktive Läufe, Herzen-Bug, Jetpack, Verben-Coins
- SQL `0054_mod_spectate_irregular.sql` (wiederholbar): `staff_rights.spectate` (Mod darf Läufe ansehen und als Gast einsteigen) und `staff_rights.look` (`none`/`hammer`); `can_spectate()` (Admin oder Mod mit Recht), `_staff_look(uid)` (`blackhole` für Admins, `hammer` für Mods mit Hammer), `my_run_perks()`; `admin_get/set_staff_rights` kennen die neuen Felder (Verwaltung → Mod-Einzelrechte: „Parkour: Zuschauen und Auftritt“); `team_spectate`/`admin_open_runs` prüfen `can_spectate()`; `team_get.people[].pk_look`.
- Nur wirklich aktive Läufe in der Übersicht: `_team_get` schreibt den Herzschlag (`updated_at`) für Mitspielende alle 20 s (auch in der Lobby), nie für Zuschauer; `admin_open_runs` zeigt nur Läufe mit Herzschlag der letzten 3 Minuten (vorher 30/40 Minuten, und Zuschauer hielten leere Läufe am Leben).
- `features/parkour/perks.ts` (`useRunPerks`): Zuschauer-Recht und Auftritt für die Seiten (`Parkour` Link, `AdminRuns`) und das Spiel (`ParkourGame` wartet auf die Antwort, dann `ParkourGameInner`). Admin-Kräfte (Flug, Geist, 4 Sprünge, keine Angebote) bleiben nur für Admins; Mods mit Recht bekommen nur „Zuschauen“ und „Hier mitspielen“.
- `modFx.ts`: Hammer-Auftritt der Mods (Hammer fällt, großer Blitz mit Flackern, Druckwelle, Funken, dann erscheint die Figur; beim Verlassen trifft der Hammer die Figur). Figur: Stahl mit goldenem Rand, Blitz-Zeichen, kleinem Hammer, ⚡-Name. Andere sehen es über `hm` im Zustand bzw. `pk_look`; `appearT`/`appearAt` verstecken die Figur bis zum Einschlag. Admins behalten das Schwarze Loch (`adminFx.ts`).
- Herzen-Bug: Shop-Herzen eines Gasts (Zuschauer, der einsteigt) gibt es nur beim ersten Einstieg (`guestHeartsGiven`); Hin- und Herwechseln füllt weder die Herzen auf noch erhöht es den Vorrat.
- Jetpack wieder wie am Anfang: 12 s Dauer, Sprungknopf in der Luft halten = Schub (`engine` `jet`), insgesamt 3,5 s Treibstoff (`JET_FUEL`); kein Flugmodus und kein „Runter“-Knopf mehr.
- Unregelmäßige Verben: `submit_irregular(correct, total)` zahlt 1 Coin je `irregular_coin_every` (5) richtige Antworten, höchstens `irregular_coin_cap` (15) pro Tag (Grund `irregular`); `ChoiceResult` (`irregular`) ruft es zusätzlich zu `submit_choice` auf; Werte in Verwaltung → Zahlen und unter der Seite (nur Admins).

## Update 69: Auftritte (Schwarzes Loch, Hammer, Klavier) und Zuschauer-Geister

- Migration `0055_entrances.sql`: `staff_rights.looks text[]` (vom Admin freigegebene Auftritte `hammer`/`piano`), `parkour_profiles.entrance` (`blackhole|hammer|piano|none`), `_allowed_looks`, `_staff_look`, `my_run_perks()` liefert `{spectate, look, allowed, entrance}`, `parkour_set_entrance(p_look)`. Admins dürfen alle drei, Mods nur freigegebene (Admin-Tab „Mod-Rechte“: Checkboxen Hammer/Klavier, `p_looks`).
- `lookTypes.ts` (`Look`, `HoleAnim`), `lookFx.ts` (`LOOKS`-Tabelle: Dauer, Erscheinzeitpunkt, `anim/back/body/label` je Look), `adminFx.ts` (Schwarzes Loch weit oben, Rakete rast herab und explodiert; Abgang mit Sog, Spaghettisierung und Kollaps), `modFx.ts` (Hammer), `pianoFx.ts` (Klavier fällt und zerbricht in Trümmer; beim Gehen wird die Figur zum Klavier mit Flügeln und fliegt davon).
- `ParkourGame`: alles über `LOOKS[look]`; Nutzdaten tragen `kd: Look` statt `ad/hm`; `appearT` gilt für alle Looks.
- Zuschauer sehen sich: eigener Broadcast-Event `g` (Position, Level, Name; 110 ms bewegt, 450 ms still). Nur Zuschauende zeichnen die Geister (halbtransparent, „👻 Name“); Spielende ignorieren das Event, Spielzustand wird nie berührt.
- Shop (`Parkour.tsx`): Abschnitt „Auftritt“ mit Live-Vorschau (`EntrancePreview`) für alle erlaubten Looks, Auswahl über `parkourSetEntrance`.

## Update 70: Bots für alle, Bots in Teams, Parkour-Shop im Shop, Seilbahn

- Migration `0056_bot_teams.sql`: `_can_set_bots` (Mods/Admins, Host einer privaten Lobby, im offenen Deathrun jede Person der Lobby, solange kein Mod/Admin drin ist; `_team_get.can_manage` nutzt das), `team_set_bots(p_id, p_bots, p_skill, p_map)` (Bots und Teamkarte in einem Schritt), `team_set_versus` behält Bots bei „Team gegen Team“. Bots stehen in `team_map` unter `b0`…`b7` (0 rot, 1 blau).
- Team-Lobby (`TeamRunRoom`): bei „Anderes Team“ zwei Spalten, Blau links, Rot rechts, Pfeil je Person und Bot, Bots einzeln („Name · Können · Bot“), „+ Bot“ je Team (`BotAdder`). `botmix.ts`: `lobbyBots`, `rebuildBots` (Bots werden nach Können sortiert, Teams bleiben erhalten).
- `ParkourGame`: `botTeam(i)`, je Team steuert ein Rechner die Bots (`isMasterFor`, `syncBots`); Bots halten nur Platten für ihr eigenes Team (`botPts`), Bots des anderen Teams zählen im Wettlauf-Urteil und in der Anzeige (`checkVerdict`). Zuschauer-Geister können Bots (`bot<i>`) und eingestiegene Ex-Zuschauer verfolgen (`targets`).
- Parkour-Shop: `features/parkour/ParkourShopPanel.tsx`, erreichbar als Reiter „Parkour“ im Shop (`/shop?tab=parkour`); die Parkour-Seite verlinkt dorthin.
- Design „Berge“ (`components/ui/Mountains.tsx`): Seilbahn mit Stationen, Stützen, zwei Seilen und je drei Gondeln auf dem Weg hinauf und hinunter (`drawCableCar`).

## Update 71
- Lobby (`TeamRunRoom.tsx`): `versus` und `team_map` gehören in den Vergleichsschlüssel des Pollings, damit Teamwechsel (Pfeile) ohne Neuladen erscheinen.
- Sprungpad: Zeichen `J` (`Builder.pad`), `engine.ts` (`PAD_V`, `onPad`, `Body.pad`), Zeichnung in `ParkourGame.tsx`. Generator: Stücke `pad` (Mauer) und `padchain` (Plattform mit Platte); jedes zufällige Level hat mindestens ein Pad. Handgebaute Level 1–8 unverändert. Test: `pad.test.ts`. Keine SQL.
- Update 72 (Pads schwerer): `Builder.sky` (Höhen-Jump&Run: Plattformreihe ab dem Pad, `pit` = Stacheln darunter). Level 1–6 haben jetzt Pads mit steigender Schwierigkeit (Mauer, Stachelmauer, Plattformreihe ohne/mit Stacheln, zwei Stachelmauern hintereinander; die Pad-Plattform mit Tür gibt es nur im Zufallsgenerator, weil zwei Bots daran in Level 5 hängen blieben); Level 7/8 unverändert (feste Bot-Wege). Generator: Stücke `sky`, mehr/breitere Stachelfelder, mehr/weiter auseinanderliegende Plattformen, bis zu 30 Abschnitte, keine Deckelung der Schwierigkeit bei den „Einser-Blöcken“. Welt bleibt 12 Kacheln hoch (Pad reicht bis knapp unter die Decke).

## Update 74
- Versionsanzeige: `src/version.ts` (`APP_UPDATE`, bei jedem Update-Zip um 1 erhöhen), `components/ui/VersionTag.tsx`; steht unten in `AppShell` und fest unten auf den Anmelde-Seiten.
- Welt nach oben: `Level.up` (Zeilen über Zeile 0, `tileAt(lv, x, y)`), Level mit `up` haben keine Decke mehr. Kamera: `camY` in `ParkourGame` folgt in solchen Leveln senkrecht (Spieler in der Mitte, unten am Boden angeschlagen). Netzwerk-y-Grenze von −800 auf −100000.
- Pad-Turm: `Builder.padTower(x, n, w, gap, pit)`: Pad → Etappe 1 nach rechts (Zeile 3) → Pad → Etappe 2 nach links (5 Zeilen höher) → Pad → Etappe 3 nach rechts → hohe Mauer. Ohne Pads unüberwindbar (Test `tower.test.ts`). Level 3, 4, 6 haben je einen (n = 1, 2, 3), Generator-Stück `sky` (wächst mit der Schwierigkeit).
- Doppelfahne `Builder.cp2` vor jedem Turm. Bots: `Level.skips` (Bots warten vor dem Turm und stehen danach hinter der Mauer, `botStep`).
- Generator: Plattformen steigen höchstens eine Zeile je Schritt (sonst nicht mehr machbar), Lücken wachsen bis 5 ab Schwierigkeit 12. `reach.test.ts` verfolgt zusätzlich die höchsten Zustände.
- Update 76: Pads über dem Bildrand wurden nicht erkannt (`onPad` nutzt jetzt `tileAt`); Etappen des Pad-Turms 6 Zeilen auseinander (Pads sind Pflicht, Test „jedes Pad ist nötig“). Tests schneller: `reachable` liegt in `reach.ts` (vorher lief `reach.test.ts` durch den Import in drei Dateien mehrfach), weniger und kleinere Suchläufe, Plattformlücken höchstens 4.
- Update 77: Bots springen den Pad-Turm hinauf (`Level.skips[].path`: Wegpunkte, Bogen je Stück, `botStep`) statt davor zu warten. Generator: keine dritte Fahne vor einem Turm (vorige Fahne weicht der Doppelfahne).
- Update 77 (Auftritte): neuer Auftritt „Gitarre“ (`guitarFx.ts`, Look `guitar`; Scheinwerfer, Gitarre stürzt und bleibt stecken, Klangwellen; Gehen: Gitarren-Windmühle und nach oben davonrocken). SQL: Migration `0057_look_guitar.sql` (Constraint, `_allowed_looks`, `admin_set_staff_rights`). Schwarzes Loch: `HoleAnim.top` (Oberkante des Bildes, wird in `ParkourGame` je Frame gesetzt), das Loch hängt in hohen Ebenen über der Figur; Explosion mit echtem Rauch (`explosionSmoke`, `BH_IN` 3,8 s), dichtere Rauchspur der Rakete. Test `lookFx.test.ts` zeichnet alle Auftritte in/out auch bei y = −900.

- Update 77 (Ergänzung): Vokabelfragen im Parkour pro Person ausschaltbar: Verwaltung → Benutzer → Person → Verwalten → Tab „Parkour“ (`parkourLearnSet`). `ParkourGame` liest den Schalter alle 15 s und beim Tab-Wechsel neu (Fehler behalten den letzten Stand).

- Update 78: Realtime-Nachrichten gesenkt (Supabase-Free-Kontingent 2,2 Mio./Monat war überschritten): Sendeabstand Position 90–130 ms (vorher 50–100), Ruhe-Heartbeat 600 ms, Zuschauer 200 ms, Bots 170 ms; Nachzieh-Glättung der Figuren etwas weicher. Ein Umbau auf PeerJS (WebRTC) wurde erwogen, aber wegen Schulnetzen/TURN nicht gemacht.

- Update 79: (1) Mehr Sprünge pro Person: Tabelle `parkour_jumps`, RPCs `parkour_jumps_list/set` (Migration 0058), Verwaltung → Person → Verwalten → Parkour; `ParkourGame` nimmt `max(Standard, Sprünge-1)` Luftsprünge und liest den Wert alle 15 s. (2) Tageslimit für Realtime-Nachrichten: Spielende zählen gesendete + empfangene Broadcasts (so zählt Supabase) und melden sie alle 15 s per `parkour_usage_add` (Tabelle `parkour_usage`, Tag nach Berliner Zeit). Einstellung `parkour_msg_limit_k` (Tausend/Tag, Standard 60, 0 = aus) unter Verwaltung → Regeln. Ist es erreicht, trennt `ParkourGame` den Kanal und zeigt eine Sperre bis Mitternacht. Fehler beim Melden sperren nicht (fail-open). Grenze: Sperre nur clientseitig, Starten in der Lobby ist nicht serverseitig blockiert.
