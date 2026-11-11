-- 0086: Weitere limitierte Artikel (je 4 Stück). Wiederholbar.
insert into public.shop_items (id, kind, name, price, sort, active, limited, source) values
  ('tag_ltd_frost',     'tag',   'Frost',               5000, 9104, true, 4, 'shop'),
  ('tag_ltd_royal',     'tag',   'Krone',               9000, 9105, true, 4, 'both'),
  ('tag_ltd_neon',      'tag',   'Neon',                7000, 9106, true, 4, 'advent'),
  ('theme_ltd_sakura',  'theme', 'Kirschblüten Deluxe', 11000, 9107, true, 4, 'shop'),
  ('theme_ltd_lava',    'theme', 'Lava',                10000, 9108, true, 4, 'both'),
  ('theme_ltd_matrix',  'theme', 'Matrix',              9000, 9109, true, 4, 'advent')
on conflict (id) do update set name = excluded.name, limited = excluded.limited, source = excluded.source, price = excluded.price;
