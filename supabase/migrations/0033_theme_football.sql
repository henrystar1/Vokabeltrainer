-- 0033: Design „Fußball“ im Shop (Aussehen steckt in catalog.ts). Wiederholbar. Nach 0032 ausführen.
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_football', 'theme', 'Fußball', 250000, 250, null)
on conflict (id) do nothing;
