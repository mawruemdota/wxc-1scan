-- Run AFTER migration on a dedicated TEST database (transaction rolls back).
-- Expected: no raised exceptions, final row contains one claimed pass.
begin;
do $$
begin
  if has_table_privilege('anon','public.one_scan_passes','SELECT') or
     has_table_privilege('authenticated','public.one_scan_passes','SELECT') or
     has_function_privilege('anon','public.one_scan_lock_pass(text,text,text)','EXECUTE') or
     has_function_privilege('authenticated','public.one_scan_claim_pass(text,text,text,text,text,text)','EXECUTE') then
    raise exception 'Public privilege isolation failed';
  end if;
end; $$;
insert into public.one_scan_allowed_players(username) values('testplayer'),('secondplayer') on conflict do nothing;
insert into public.one_scan_passes(pass_key) values
 ('aaaaaaaaaaaaaaaaaaaaaaaa'),('bbbbbbbbbbbbbbbbbbbbbbbb'),('cccccccccccccccccccccccc');

do $$
declare
  v_result jsonb;
  v_token text := repeat('f',64);
  v_token2 text := repeat('e',64);
begin
  v_result := public.one_scan_lock_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token,'203.0.113.10');
  if v_result->>'reason' != 'locked' then raise exception 'initial lock failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token,'203.0.113.10');
  if v_result->>'reason' != 'resumed' then raise exception 'same session resume failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token2,'203.0.113.11');
  if v_result->>'reason' != 'reserved' then raise exception 'exclusivity failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('bbbbbbbbbbbbbbbbbbbbbbbb',v_token,'203.0.113.10');
  if v_result->>'reason' != 'ip_already_reserved' then raise exception 'IP hoarding prevention failed: %',v_result; end if;
  v_result := public.one_scan_claim_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token,'203.0.113.10','Test Person','wrongname','tester@example.org');
  if v_result->>'reason' != 'username_not_allowed' then raise exception 'invalid username release failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token2,'203.0.113.11');
  if v_result->>'reason' != 'locked' then raise exception 'relock after release failed: %',v_result; end if;
  v_result := public.one_scan_claim_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token2,'203.0.113.11','Test Person','TestPlayer','Tester@Example.Org');
  if v_result->>'reason' != 'claimed' then raise exception 'valid claim failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('aaaaaaaaaaaaaaaaaaaaaaaa',v_token,'203.0.113.10');
  if v_result->>'reason' != 'claimed' then raise exception 'permanent used state failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('bbbbbbbbbbbbbbbbbbbbbbbb',v_token,'203.0.113.11');
  if v_result->>'reason' != 'ip_claimed_today' then raise exception 'daily IP prevention failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('bbbbbbbbbbbbbbbbbbbbbbbb',v_token,'203.0.113.12');
  if v_result->>'reason' != 'locked' then raise exception 'second lock failed: %',v_result; end if;
  v_result := public.one_scan_claim_pass('bbbbbbbbbbbbbbbbbbbbbbbb',v_token,'203.0.113.12','Other Person','TESTPLAYER','new@example.org');
  if v_result->>'reason' != 'already_claimed_today' then raise exception 'daily username duplicate failed: %',v_result; end if;
  v_result := public.one_scan_lock_pass('cccccccccccccccccccccccc',v_token,'203.0.113.13');
  if v_result->>'reason' != 'locked' then raise exception 'third lock failed: %',v_result; end if;
  v_result := public.one_scan_claim_pass('cccccccccccccccccccccccc',v_token,'203.0.113.13','Other Person','secondplayer','TESTER@example.org');
  if v_result->>'reason' != 'already_claimed_today' then raise exception 'daily email duplicate failed: %',v_result; end if;
end; $$;
rollback;
