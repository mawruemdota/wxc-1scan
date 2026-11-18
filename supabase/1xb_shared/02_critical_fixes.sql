-- 1scan shared-1xb isolation. Keeps existing unprefixed tables/functions unchanged.
-- CRITICAL FIXES: session-safe recovery and persistent API throttling.
-- Run AFTER 20261118000000_initial.sql. Safe for an existing database.
-- Receipts are available for claims made after this migration; older claims
-- did not retain ownership proof and cannot be reconstructed retroactively.
create table public.one_scan_claim_receipts (
  pass_id bigint primary key references public.one_scan_passes(id) on delete cascade,
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

-- Each (IP, endpoint, duration) gets a rolling anchored window. The UPSERT
-- row lock makes increments atomic even across many Vercel instances.
create table public.one_scan_public_api_rate_limits (
  endpoint text not null check (endpoint in ('lock','claim','receipt')),
  client_ip inet not null,
  window_seconds integer not null check (window_seconds in (60,3600)),
  window_started timestamptz not null,
  attempts integer not null check (attempts >= 1),
  primary key (endpoint,client_ip,window_seconds)
);

alter table public.one_scan_claim_receipts enable row level security;
alter table public.one_scan_public_api_rate_limits enable row level security;
revoke all on table public.one_scan_claim_receipts, public.one_scan_public_api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.one_scan_claim_receipts, public.one_scan_public_api_rate_limits to service_role;

-- 15 lock calls/min and 100/hour; 8 claim calls/min and 40/hour;
-- 30 receipt lookups/min and 200/hour, all per trusted public IP.
-- A call counted as denied still consumes the counter, preventing brute-force.
create function public.one_scan_public_request_allow(p_endpoint text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip inet;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_secs integer;
  v_limit integer;
  v_count integer;
  v_started timestamptz;
  v_retry integer;
begin
  if p_endpoint is null or p_endpoint not in ('lock','claim','receipt') then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  begin v_ip := p_ip::inet;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'reason','invalid_ip');
  end;
  if v_ip is null then return jsonb_build_object('ok',false,'reason','invalid_ip'); end if;

  foreach v_secs in array array[60,3600] loop
    v_limit := case
      when p_endpoint='lock' and v_secs=60 then 15
      when p_endpoint='lock' then 100
      when p_endpoint='claim' and v_secs=60 then 8
      when p_endpoint='claim' then 40
      when v_secs=60 then 30
      else 200 end;
    insert into public.one_scan_public_api_rate_limits(endpoint,client_ip,window_seconds,window_started,attempts)
      values (p_endpoint,v_ip,v_secs,v_now,1)
    on conflict(endpoint,client_ip,window_seconds) do update
      set window_started = case
        when public.one_scan_public_api_rate_limits.window_started + pg_catalog.make_interval(secs => v_secs) <= v_now
          then v_now else public.one_scan_public_api_rate_limits.window_started end,
      attempts = case
        when public.one_scan_public_api_rate_limits.window_started + pg_catalog.make_interval(secs => v_secs) <= v_now
          then 1 else least(public.one_scan_public_api_rate_limits.attempts + 1,1000000) end
    returning attempts,window_started into v_count,v_started;
    if v_count > v_limit then
      v_retry := greatest(1,pg_catalog.ceil(extract(epoch from
        (v_started + pg_catalog.make_interval(secs => v_secs) - v_now)))::integer);
      return jsonb_build_object('ok',false,'reason','too_many_requests','retry_after',v_retry);
    end if;
  end loop;
  return jsonb_build_object('ok',true,'reason','allowed');
end; $$;

create or replace function public.one_scan_lock_pass(p_key text, p_session text, p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.one_scan_passes%rowtype;
  v_ip inet;
  v_time timestamptz;
  v_today date;
  v_expiry timestamptz;
begin
  if p_key !~ '^[0-9a-f]{24}$' or p_session !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  begin v_ip := p_ip::inet;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'reason','invalid_ip');
  end;
  if v_ip is null then return jsonb_build_object('ok',false,'reason','invalid_ip'); end if;
  -- Serialize different passes competing for the same IP.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('one_scan_ip:' || v_ip::text,0));
  select * into v_pass from public.one_scan_passes where pass_key = p_key for update;
  v_time := pg_catalog.clock_timestamp();
  v_today := (v_time at time zone 'Asia/Manila')::date;
  if not found then return jsonb_build_object('ok',false,'reason','invalid_key'); end if;
  -- Only the original claimant's HttpOnly session can retrieve its receipt.
  if v_pass.status = 'claimed' then
    if exists (
      select 1 from public.one_scan_claim_receipts r
      where r.pass_id = v_pass.id
        and r.session_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session,'UTF8')),'hex')
    ) then
      return jsonb_build_object('ok',true,'reason','claimed_by_you',
        'claimed_at',v_pass.claimed_at,'claim_reference','FTS-' || pg_catalog.lpad(v_pass.id::text,8,'0'));
    end if;
    return jsonb_build_object('ok',false,'reason','claimed');
  end if;
  if v_pass.status = 'reserved' and v_pass.reserved_until > v_time then
    if v_pass.session_token = p_session and v_pass.reserved_ip = v_ip then
      return jsonb_build_object('ok',true,'reason','resumed','reserved_until',v_pass.reserved_until,'server_now',v_time);
    end if;
    return jsonb_build_object('ok',false,'reason','reserved');
  end if;
  if exists(select 1 from public.one_scan_passes where status='claimed' and claimed_ip=v_ip and claim_date=v_today) then
    return jsonb_build_object('ok',false,'reason','ip_claimed_today');
  end if;
  if exists(select 1 from public.one_scan_passes where status='reserved' and reserved_ip=v_ip and reserved_until > v_time and id<>v_pass.id) then
    return jsonb_build_object('ok',false,'reason','ip_already_reserved');
  end if;
  v_expiry := v_time + interval '5 minutes';
  update public.one_scan_passes set status='reserved', session_token=p_session, reserved_ip=v_ip, reserved_until=v_expiry
    where id=v_pass.id;
  return jsonb_build_object('ok',true,'reason','locked','reserved_until',v_expiry,'server_now',v_time);
end; $$;

create or replace function public.one_scan_claim_pass(
  p_key text, p_session text, p_ip text, p_full_name text, p_username text, p_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.one_scan_passes%rowtype;
  v_ip inet;
  v_username text := lower(btrim(p_username));
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_full_name);
  v_time timestamptz;
  v_today date;
  v_lock text;
begin
  if p_key !~ '^[0-9a-f]{24}$' or p_session !~ '^[0-9a-f]{64}$'
     or char_length(v_username) not between 1 and 64
     or char_length(v_email) not between 3 and 254
     or char_length(v_name) not between 1 and 120
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  begin v_ip := p_ip::inet;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'reason','invalid_ip');
  end;
  if v_ip is null then return jsonb_build_object('ok',false,'reason','invalid_ip'); end if;
  -- Canonical ordering prevents circular waits for overlapping username/email/IP locks.
  for v_lock in
    select key from unnest(array['one_scan_ip:'||v_ip::text,'one_scan_username:'||v_username,'one_scan_email:'||v_email]) as t(key) order by key
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock,0));
  end loop;
  select * into v_pass from public.one_scan_passes where pass_key=p_key for update;
  v_time := pg_catalog.clock_timestamp();
  v_today := (v_time at time zone 'Asia/Manila')::date;
  if not found then return jsonb_build_object('ok',false,'reason','invalid_key'); end if;
  -- A duplicate POST after a lost network response must return the original
  -- receipt, without modifying the already-claimed pass or charging a second claim.
  if v_pass.status = 'claimed' then
    if exists (
      select 1 from public.one_scan_claim_receipts r
      where r.pass_id = v_pass.id
        and r.session_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session,'UTF8')),'hex')
    ) then
      return jsonb_build_object('ok',true,'reason','already_claimed_by_you',
        'claimed_at',v_pass.claimed_at,'claim_reference','FTS-' || pg_catalog.lpad(v_pass.id::text,8,'0'));
    end if;
    return jsonb_build_object('ok',false,'reason','claimed');
  end if;
  if v_pass.status <> 'reserved' or v_pass.session_token is distinct from p_session then
    return jsonb_build_object('ok',false,'reason','not_session_owner');
  end if;
  if v_pass.reserved_ip is distinct from v_ip then
    return jsonb_build_object('ok',false,'reason','ip_changed');
  end if;
  if v_time > v_pass.reserved_until then
    update public.one_scan_passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
    return jsonb_build_object('ok',false,'reason','expired');
  end if;
  if not exists(select 1 from public.one_scan_allowed_players where username=v_username) then
    update public.one_scan_passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
    return jsonb_build_object('ok',false,'reason','username_not_allowed');
  end if;
  if exists(select 1 from public.one_scan_passes where status='claimed' and claim_date=v_today and
    (claimed_username=v_username or lower(claimed_email)=v_email or claimed_ip=v_ip)) then
    update public.one_scan_passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
    return jsonb_build_object('ok',false,'reason','already_claimed_today');
  end if;
  begin
    update public.one_scan_passes set status='claimed', session_token=null, reserved_ip=null, reserved_until=null,
      claimed_full_name=v_name, claimed_username=v_username, claimed_email=v_email,
      claimed_ip=v_ip, claim_date=v_today, claimed_at=v_time where id=v_pass.id;
    -- The receipt is committed atomically with the claim. Keep only the SHA-256
    -- of the 256-bit HttpOnly session token; never return or store it in a receipt.
    insert into public.one_scan_claim_receipts(pass_id,session_hash)
      values (v_pass.id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session,'UTF8')),'hex'));
  exception when unique_violation then
    -- A hard-index collision must not strand the reservation.
    update public.one_scan_passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
    return jsonb_build_object('ok',false,'reason','already_claimed_today');
  end;
  return jsonb_build_object('ok',true,'reason','claimed','claimed_at',v_time,
    'claim_reference','FTS-' || pg_catalog.lpad(v_pass.id::text,8,'0'));
end; $$;

-- Read-only receipt recovery. No name/email/IP is exposed to unverified
-- sessions. Its proof is the claimant's original 256-bit HttpOnly cookie.
create function public.one_scan_get_claim_receipt(p_key text, p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.one_scan_passes%rowtype;
begin
  if p_key is null or p_session is null or
     p_key !~ '^[0-9a-f]{24}$' or p_session !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  select p.* into v_pass from public.one_scan_passes p
    join public.one_scan_claim_receipts r on r.pass_id=p.id
   where p.pass_key=p_key and p.status='claimed'
     and r.session_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session,'UTF8')),'hex');
  if not found then return jsonb_build_object('ok',false,'reason','not_claimed'); end if;
  return jsonb_build_object('ok',true,'reason','claimed_by_you',
    'claimed_at',v_pass.claimed_at,'claim_reference','FTS-' || pg_catalog.lpad(v_pass.id::text,8,'0'));
end; $$;

revoke all on function public.one_scan_lock_pass(text,text,text) from public,anon,authenticated;
revoke all on function public.one_scan_claim_pass(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.one_scan_get_claim_receipt(text,text) from public,anon,authenticated;
revoke all on function public.one_scan_public_request_allow(text,text) from public,anon,authenticated;
grant execute on function public.one_scan_lock_pass(text,text,text) to service_role;
grant execute on function public.one_scan_claim_pass(text,text,text,text,text,text) to service_role;
grant execute on function public.one_scan_get_claim_receipt(text,text) to service_role;
grant execute on function public.one_scan_public_request_allow(text,text) to service_role;
