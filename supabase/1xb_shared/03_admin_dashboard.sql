-- 1scan shared-1xb isolation. Keeps existing unprefixed tables/functions unchanged.
-- Admin Dashboard: transactional replacement of the eligible-username list.
-- Apply AFTER the initial and critical-fixes migrations to a dedicated project.
create function public.one_scan_replace_allowed_players(p_usernames text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_names text[];
  v_added integer;
  v_removed integer;
begin
  if p_usernames is null or pg_catalog.cardinality(p_usernames) not between 1 and 10000 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_player_list');
  end if;
  if exists (select 1 from pg_catalog.unnest(p_usernames) as u(name)
    where name is null or pg_catalog.char_length(pg_catalog.btrim(name)) not between 1 and 64) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_username');
  end if;
  select pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(name)))
    into v_names from pg_catalog.unnest(p_usernames) as u(name);
  if v_names is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid_player_list');
  end if;
  -- Serialize full replacement against concurrent username imports.
  lock table public.one_scan_allowed_players in share row exclusive mode;
  select pg_catalog.count(*) into v_added
  from pg_catalog.unnest(v_names) as u(name)
  where not exists (select 1 from public.one_scan_allowed_players p where p.username=u.name);
  select pg_catalog.count(*) into v_removed from public.one_scan_allowed_players p
  where not (p.username = any(v_names));
  insert into public.one_scan_allowed_players(username)
    select name from pg_catalog.unnest(v_names) as u(name)
    on conflict(username) do nothing;
  delete from public.one_scan_allowed_players p where not (p.username = any(v_names));
  return pg_catalog.jsonb_build_object('ok', true, 'imported', pg_catalog.cardinality(v_names),
    'added', v_added, 'removed', v_removed);
end; $$;

revoke all on function public.one_scan_replace_allowed_players(text[]) from public, anon, authenticated;
grant execute on function public.one_scan_replace_allowed_players(text[]) to service_role;
