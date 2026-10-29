# Übergabe: Vokabeltrainer (für einen neuen Claude-Chat)

Diese Datei fasst zusammen, wie wir arbeiten, was gebaut wurde und was offen ist. Lies danach `ARCHITEKTUR.md` (ausführliche technische Doku, am Ende die Abschnitte „Update 57“ bis „Update 70“) und `TESTVERSION.md` (Einrichtung der Testseite).

## Wer, was, wie
- Besitzer: Henry, Schüler. **Immer auf Deutsch antworten.** Kurz und verständlich, Henry deployt selbst.
- Projekt: Vokabeltrainer-Web-App (React 19, TypeScript strikt, Vite, Tailwind 3, Supabase mit RLS und RPC-Funktionen, Vitest). Hosting: GitHub Pages. Mit vielen Zusatzfunktionen: Coins und Shop, Duelle, Spiele, Mathe, Liga, 3D-Druck-Shop und vor allem das **Parkour** (Team-Parkour, Deathrun, Bots, Zuschauen).
- Deploy: geänderte Dateien im GitHub-Web hochladen und neue SQL-Dateien im **Supabase SQL Editor** ausführen (erst Testseite, dann echte Seite).
- Arbeitsweise: Code darf Claude ohne Rückfrage ändern. **Zip-Dateien nur nach Rückfrage** erstellen („Soll ich das als update NN zippen?“). Henry antwortet meist „ja“ oder „weiter“. Update-Zips enthalten nur die seit dem letzten Zip geänderten Dateien (`find … -newer vorheriges.zip`, ohne node_modules/dist).
- Vor jedem Zip: `npx tsc --noEmit`, Vitest (mit `VITE_SUPABASE_URL=https://x.supabase.co VITE_SUPABASE_ANON_KEY=x VITE_SUPABASE_PUBLISHABLE_KEY=x`, ca. 2 Minuten, im Hintergrund starten) und `npx vite build`. Es gibt keine ESLint-Konfiguration.
- Datenbanktests liefen mit PGlite (alle Migrationen in Reihenfolge einspielen, Funktionen als verschiedene Nutzer aufrufen). Diese Testskripte liegen nicht im Projekt; man kann sie neu schreiben. Migrationen müssen wiederholbar sein (`create or replace`, `if not exists`, Grant-Schleife am Ende, `security definer`, `set search_path = public`).
- Jede neue Migration muss auch an `supabase/ALLE_MIGRATIONEN_in_einem.sql` angehängt und in `TESTVERSION.md` (Liste der Dateien) ergänzt werden.

## Stand: ausgelieferte Updates
Updates 50–79 wurden geliefert (Update 77 ist das letzte: Bots klettern Türme, Gitarren-Auftritt, Rauch). SQL zusätzlich: 0057, 0058 (Update 77). SQL, die Henry für die letzten Updates braucht: 0053 (Update 66), 0054 (Update 68), 0055 (Update 69), 0056 (Update 70). Ob er sie alle eingespielt hat, ist nicht bestätigt.

Wichtige Themen der letzten Updates:
- **66 Lernen im Parkour:** Speedup-Angebote am rechten Bildschirmrand, Vokabel beantworten zum Freischalten (`parkourLearn.ts`, `LearnOverlay.tsx`, Tabelle `parkour_learn_off`), weniger Coins.
- **67 Bots:** Turm-Lücke an Tür/Wand, Bots warten am Start auf den ersten Menschen, Fahnen.
- **68 Mods mit Zuschauer-Recht und Hammer-Auftritt**, Herzen-Bug beim Zuschauer-Einstieg (Shop-Herzen nur einmal), Jetpack kürzer (12 s, 3,5 s Treibstoff), nur aktive Läufe in der Admin-Liste, unregelmäßige Verben geben Coins.
- **69 Auftritte:** Schwarzes Loch (Rakete schlägt ein, Sog beim Gehen), Hammer & Blitz, Klavier (fällt und zerbricht, beim Gehen fliegt man als Klavier davon). `lookFx.ts` (Tabelle `LOOKS`), `adminFx.ts`, `modFx.ts`, `pianoFx.ts`, `EntrancePreview.tsx`. Admin wählt alle drei im Shop, Mods nur vom Admin freigegebene (Hammer/Klavier, Tab „Mod-Rechte“). Zuschauer sehen sich gegenseitig als Geister (Broadcast-Event `g`). Migration 0055.
- **70 Bots und Teams:** Im offenen Deathrun dürfen auch Nicht-Mods Bots einstellen, wenn kein Mod/Admin da ist. Team-Parkour „Team gegen Team“: Blau links, Rot rechts, Pfeil je Person/Bot, Bots einzeln (Name · Können · Bot), Bots im eigenen Team oder gemischt (Teamkarte `b0…b7`). Zuschauer können Bots und eingestiegene Ex-Zuschauer verfolgen. Der Parkour-Shop ist jetzt ein Reiter im Shop (`/shop?tab=parkour`, `ParkourShopPanel.tsx`). Design „Berge“ hat eine Seilbahn (`Mountains.tsx`). Migration 0056.

## Parkour-Technik in Kürze
- Realtime-Kanal `parkour-<runId>` (Supabase Broadcast): Event `s` Spielerzustand, `b` Bots, `g` Zuschauer-Geister. Jeder Rechner simuliert seine Figur; Bots werden vom Rechner mit der kleinsten Nutzer-ID des Teams simuliert (`isMasterFor`), die anderen sehen sie per Event `b`.
- `ParkourGame.tsx` ist die große Datei (Spiel-Loop, Netzwerk, Zeichnen). `engine.ts` Physik, `bots.ts` Bot-KI, `botmix.ts` Bot-Mischung (Können 1–5, Code in `team_runs.bot_skill`), `levels.ts`/`generator.ts` Level.
- Auftritt eines Admins/Mods: `my_run_perks()` liefert `{spectate, look, allowed, entrance}`; `perks.ts` (`useRunPerks`).

## Offen / unsicher
1. **Bots in Teams (Update 70) sind nur per Typprüfung, Build und SQL-Test geprüft, nicht im echten Spiel.** Bitte auf der Testseite ausprobieren: Team gegen Team mit gemischten Bots, Bot-Team nur aus Bots, Zuschauer folgt Bot, Sieg/Niederlage-Anzeige. Mögliche Schwachstellen: Wechsel des steuernden Rechners, wenn jemand die Lobby verlässt; Bot-Team ohne Menschen.
2. Der alte Datenbanktest für „Nicht-Mods dürfen keine Bots“ ist durch Update 70 absichtlich überholt (nur im Test, nicht im Projekt).
3. Die Auftritts-Animationen wurden nur als Standbilder geprüft (Playwright-Screenshots), nicht live im Spiel. Das Klavier-Flügelbild sieht etwas grau aus.
4. Zuschauer-Geister (`g`) wurden nicht mit mehreren echten Geräten getestet.
5. Henry hat nicht bestätigt, ob alle SQL-Dateien 0053–0056 auf der echten Seite laufen.
6. Ideen, die Henry zuvor erwähnt oder die naheliegen: weitere Auftritte, mehr Design-Hintergrund-Animationen, Bots-Verhalten weiter verbessern (Fahnen, Türme).

## Schnellstart im neuen Chat
1. Zip entpacken, `npm install`, `npx tsc --noEmit`, `npx vitest run` mit den Umgebungsvariablen oben.
2. `ARCHITEKTUR.md` (Ende) und diese Datei lesen.
3. Henrys nächste Wünsche umsetzen, am Ende wie üblich fragen: „Soll ich das als update 71 zippen?“.
