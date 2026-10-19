-- 0036: Design „Gasthaus“ (Schnitzel, Pommes, Spätzle) im Shop (Aussehen steckt in catalog.ts). Wiederholbar. Nach 0035 ausführen.
insert into public.shop_items (id, kind, name, price, sort, required_role) values
  ('theme_food', 'theme', 'Gasthaus', 250000, 260, null)
on conflict (id) do nothing;
