-- SWAT-Panzerwagen: kaufbar im Autohaus (10 Sitze, sehr robust, fliegt, Q schießt bei Polizeijagd/Admin)
insert into public.cars (id, name, kind, color, price, top_kmh, sort) values
  ('swat', 'SWAT-Panzerwagen', 'swat', '#0b1220', 250000, 310, 90)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, color = excluded.color, price = excluded.price, top_kmh = excluded.top_kmh, sort = excluded.sort;
