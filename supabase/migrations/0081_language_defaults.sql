-- 0081: Pro Sprache merken: Anzahl der Vokabeln pro Runde und Richtung (Einstellungen → Lernen). Wiederholbar.
alter table public.user_settings add column if not exists language_defaults jsonb not null default '{}'::jsonb;
