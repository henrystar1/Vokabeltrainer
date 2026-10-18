-- 0035: Lernpool nur aus Büchern der eigenen Bibliothek und nur aktive Vokabeln (Multiple Choice, Lernen, Test,
-- Sprint, Fehler-Training). Seit 0011 fehlten diese beiden Filter, dadurch kamen auch Vokabeln aus öffentlichen
-- Büchern, die man gar nicht verwendet. Wiederholbar. Nach 0034 ausführen.

create or replace function public.get_learning_pool(p_language text default null, p_book_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'vocabulary_id', v.id,
      'book_id', v.book_id,
      'german', v.german,
      'german_alts', to_jsonb(v.german_alts),
      'translations', coalesce((
         select jsonb_agg(t.translation order by t.sort_order, t.created_at)
           from public.translations t where t.vocabulary_id = v.id), '[]'::jsonb),
      'level', coalesce(pr.learning_level, 1)::float8,
      'last_at', pr.last_answered_at
    )), '[]'::jsonb)
  from public.vocabulary v
  join public.books b on b.id = v.book_id
  left join public.user_vocabulary_progress pr
    on pr.vocabulary_id = v.id and pr.user_id = (select auth.uid())
  where ((p_book_id is null and public.in_library(v.book_id)) or v.book_id = p_book_id)
    and public.is_active_vocab(v.id)
    and (p_language is null or b.language = p_language);
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_learning_pool'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
