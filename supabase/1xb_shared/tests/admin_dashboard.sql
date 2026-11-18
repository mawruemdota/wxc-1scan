-- Run on a disposable / dedicated Supabase test database. Transaction rolls back.
begin;

do $$
declare r jsonb;
begin
  if pg_catalog.has_function_privilege('anon', 'public.one_scan_replace_allowed_players(text[])', 'EXECUTE') then
    raise exception 'anon must not be able to call replace_allowed_players';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.one_scan_replace_allowed_players(text[])', 'EXECUTE') then
    raise exception 'authenticated must not be able to call replace_allowed_players';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.one_scan_replace_allowed_players(text[])', 'EXECUTE') then
    raise exception 'service_role must be able to call replace_allowed_players';
  end if;
  r := public.one_scan_replace_allowed_players(array['  player_alpha  ', 'PLAYER_BETA', 'player_alpha']);
  if (r->>'ok')::boolean is not true or (r->>'imported')::integer <> 2 then
    raise exception 'Unexpected replace result: %', r;
  end if;
  if (select pg_catalog.count(*) from public.one_scan_allowed_players) <> 2 then
    raise exception 'Replacement did not contain exactly two usernames';
  end if;
  if not exists(select 1 from public.one_scan_allowed_players where username='player_alpha') then
    raise exception 'Canonicalization failed';
  end if;
  r := public.one_scan_replace_allowed_players(array[]::text[]);
  if r->>'reason' <> 'invalid_player_list' then raise exception 'Empty replacement should fail safely'; end if;
end $$;

rollback;
