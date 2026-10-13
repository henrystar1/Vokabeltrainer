# Edge Function „push“ – Mitteilungen aufs iPad (auch bei geschlossener App)

Die App schickt Mitteilungen über **Web Push**. Dafür brauchst du einmalig drei Dinge: ein Schlüsselpaar (VAPID), diese Edge Function und drei Zeilen in der Datenbank.

## 1. Schlüssel erzeugen (am PC, einmalig)

```
npx web-push generate-vapid-keys
```

Du bekommst einen **Public Key** und einen **Private Key**. Den privaten nie weitergeben.

## 2. Geheimnisse in Supabase eintragen

Supabase → *Edge Functions* → *Secrets* (oder `supabase secrets set …`):

| Name | Wert |
|---|---|
| `VAPID_PUBLIC_KEY` | der Public Key |
| `VAPID_PRIVATE_KEY` | der Private Key |
| `VAPID_SUBJECT` | `mailto:deine@mailadresse.de` |
| `PUSH_SECRET` | ein selbst ausgedachtes langes Passwort (z. B. 40 Zeichen) |

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` sind automatisch da.

## 3. Function veröffentlichen

```
supabase functions deploy push --no-verify-jwt
```

`--no-verify-jwt` ist nötig, weil die Datenbank die Function aufruft und nicht ein angemeldeter Nutzer. Geschützt ist sie durch `PUSH_SECRET`.

## 4. Datenbank: Migration 0025 ausführen, dann drei Werte eintragen

Im SQL-Editor (Adresse = deine Projekt-URL + `/functions/v1/push`):

```sql
insert into public.push_config (key, value) values
  ('url',        'https://DEIN-PROJEKT.supabase.co/functions/v1/push'),
  ('public_key', 'DER PUBLIC KEY'),
  ('secret',     'DASSELBE PASSWORT WIE PUSH_SECRET')
on conflict (key) do update set value = excluded.value;
```

Außerdem muss die Erweiterung **pg_net** an sein (Supabase → *Database* → *Extensions* → `pg_net`). Bei Supabase ist sie meistens schon aktiv.

## 5. Auf dem iPad

1. Die Seite in **Safari** öffnen, **Teilen** → **Zum Home-Bildschirm**. (iPadOS 16.4 oder neuer. Ohne diesen Schritt erlaubt Apple keine Push-Nachrichten.)
2. Die App **vom Home-Bildschirm** öffnen und anmelden.
3. *Einstellungen → Hinweise → „Auf diesem Gerät einschalten“*, Erlaubnis bestätigen.
4. *Test-Nachricht senden*, die App schließen. Nach wenigen Sekunden kommt die Mitteilung.

## Wann wird gesendet?

- jemand erwähnt dich mit `@Name` im Chat, oder flüstert dir zu
- eine Nachricht vom Team
- dein 3D-Druck ist fertig
- optional jede Chat-Nachricht (Schalter „Bei jeder neuen Chat-Nachricht“)

Es gelten die Schalter in den Einstellungen. Ist die App gerade offen (zuletzt vor weniger als 90 Sekunden aktiv), wird nichts gepusht, dann erscheint der kleine Hinweis am Rand.

## Fehlersuche

```sql
select * from public.push_log order by id desc limit 20;      -- was wurde angestoßen, mit Status
select * from public.admin_push_overview();                    -- als Admin in der App; zeigt, was fehlt
```

- Status `kein pg_net`: Erweiterung pg_net einschalten.
- Status `gesendet`, aber nichts kommt an: *Edge Functions → push → Logs* ansehen (falscher `PUSH_SECRET`? Schlüssel vertauscht?).
- Auf dem iPad kommt nichts: App wirklich vom Home-Bildschirm geöffnet? Mitteilungen für die App in den iPad-Einstellungen erlaubt? Fokus/„Nicht stören“ aus?
- Wenn du die Schlüssel änderst, müssen alle Geräte Push einmal aus- und wieder einschalten.
