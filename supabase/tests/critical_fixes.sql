-- Run AFTER BOTH migrations on a dedicated test database only.
-- Transaction rolls back all test data. Errors indicate a broken critical fix.
begin;

do $$
begin
  if has_table_privilege('anon','public.claim_receipts','SELECT') or
     has_table_privilege('authenticated','public.public_api_rate_limits','SELECT') or
     has_function_privilege('anon','public.get_claim_receipt(text,text)','EXECUTE') or
     has_function_privilege('anon','public.public_request_allow(text,text)','EXECUTE') or
     has_function_privilege('authenticated','public.get_claim_receipt(text,text)','EXECUTE') then
    raise exception 'Critical-fix permission isolation failed';
  end if;
end; $$;

insert into public.allowed_players(username) values('criticaltestplayer') on conflict do nothing;
insert into public.passes(pass_key) values ('dddddddddddddddddddddddd');

do $$
declare
  v_result jsonb;
  v_token text := repeat('d',64);
  v_other text := repeat('c',64);
  v_timestamp text;
  v_reference text;
  v_ip text := '203.0.113.161';
  i integer;
begin
  v_result := public.lock_pass('dddddddddddddddddddddddd',v_token,v_ip);
  if v_result->>'reason' != 'locked' then raise exception 'Initial reservation: %',v_result; end if;
  v_result := public.lock_pass('dddddddddddddddddddddddd',v_other,v_ip);
  if v_result->>'reason' != 'reserved' then raise exception 'Same-IP session exclusion: %',v_result; end if;
  v_result := public.claim_pass('dddddddddddddddddddddddd',v_token,v_ip,
    'Test Claimant','criticaltestplayer','critical@example.org');
  if v_result->>'reason' != 'claimed' then raise exception 'Initial claim: %',v_result; end if;
  v_timestamp := v_result->>'claimed_at';
  v_reference := v_result->>'claim_reference';
  if v_reference is null then raise exception 'Missing claim reference'; end if;

  -- Repeated POSTs are idempotent, including after an IP change.
  v_result := public.claim_pass('dddddddddddddddddddddddd',v_token,'203.0.113.162',
    'Test Claimant','criticaltestplayer','critical@example.org');
  if v_result->>'reason' != 'already_claimed_by_you' or
     v_result->>'claimed_at' != v_timestamp or v_result->>'claim_reference' != v_reference then
    raise exception 'Idempotent claim recovery: %',v_result;
  end if;
  v_result := public.lock_pass('dddddddddddddddddddddddd',v_token,'203.0.113.162');
  if v_result->>'reason' != 'claimed_by_you' then raise exception 'Refresh recovery: %',v_result; end if;
  v_result := public.get_claim_receipt('dddddddddddddddddddddddd',v_token);
  if v_result->>'claim_reference' != v_reference then raise exception 'Read-only receipt: %',v_result; end if;
  v_result := public.get_claim_receipt('dddddddddddddddddddddddd',v_other);
  if v_result->>'reason' != 'not_claimed' then raise exception 'Receipt proof isolation: %',v_result; end if;
  v_result := public.lock_pass('dddddddddddddddddddddddd',v_other,'203.0.113.162');
  if v_result->>'reason' != 'claimed' then raise exception 'Other session cannot retrieve: %',v_result; end if;

  -- Lock endpoint: 15 successes per rolling minute, then 429-style denial.
  for i in 1..15 loop
    v_result := public.public_request_allow('lock','198.51.100.231');
    if not (v_result->>'ok')::boolean then raise exception 'Lock quota too low at %: %',i,v_result; end if;
  end loop;
  v_result := public.public_request_allow('lock','198.51.100.231');
  if v_result->>'reason' != 'too_many_requests' or (v_result->>'retry_after')::integer < 1 then
    raise exception 'Lock quota not enforced: %',v_result;
  end if;

  -- Claim endpoint: lower quota, independent from lock endpoint and other IPs.
  for i in 1..8 loop
    v_result := public.public_request_allow('claim','198.51.100.231');
    if not (v_result->>'ok')::boolean then raise exception 'Claim quota too low at %: %',i,v_result; end if;
  end loop;
  v_result := public.public_request_allow('claim','198.51.100.231');
  if v_result->>'reason' != 'too_many_requests' then raise exception 'Claim quota not enforced: %',v_result; end if;
  v_result := public.public_request_allow('lock','198.51.100.232');
  if v_result->>'reason' != 'allowed' then raise exception 'Quota leaked to other IP: %',v_result; end if;
end; $$;
rollback;
