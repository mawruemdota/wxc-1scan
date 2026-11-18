-- 1scan shared-1xb isolation. Keeps existing unprefixed tables/functions unchanged.
-- 1scan QR Pass: isolated tables and functions for the shared 1xb Supabase project.
-- All privileged functions are callable ONLY by the service_role via Next.js.
create table public.one_scan_allowed_players (
  username text primary key,
  created_at timestamptz not null default clock_timestamp(),
  constraint username_canonical check (username = lower(btrim(username)) and char_length(username) between 1 and 64)
);

create table public.one_scan_passes (
  id bigint generated always as identity primary key,
  pass_key text not null unique check (pass_key ~ '^[0-9a-f]{24}$'),
  status text not null default 'unused' check (status in ('unused','reserved','claimed')),
  session_token text,
  reserved_ip inet,
  reserved_until timestamptz,
  claimed_full_name text,
  claimed_username text,
  claimed_email text,
  claimed_ip inet,
  claim_date date,
  claimed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint valid_state check (
    (status = 'unused' and session_token is null and reserved_ip is null and reserved_until is null
      and claimed_full_name is null and claimed_username is null and claimed_email is null
      and claimed_ip is null and claim_date is null and claimed_at is null)
    or
    (status = 'reserved' and session_token is not null and reserved_ip is not null and reserved_until is not null
      and claimed_full_name is null and claimed_username is null and claimed_email is null
      and claimed_ip is null and claim_date is null and claimed_at is null)
    or
    (status = 'claimed' and session_token is null and reserved_ip is null and reserved_until is null
      and claimed_full_name is not null and claimed_username is not null and claimed_email is not null
      and claimed_ip is not null and claim_date is not null and claimed_at is not null)
  )
);

-- Hard safeguards for claim-day uniqueness, including concurrent submissions.
create unique index one_scan_one_username_per_day on public.one_scan_passes (claimed_username, claim_date) where status = 'claimed';
create unique index one_scan_one_email_per_day on public.one_scan_passes ((lower(claimed_email)), claim_date) where status = 'claimed';
create unique index one_scan_one_ip_per_day on public.one_scan_passes (claimed_ip, claim_date) where status = 'claimed';
create index one_scan_passes_active_reservations on public.one_scan_passes (reserved_ip, reserved_until) where status = 'reserved';
create index one_scan_passes_recent on public.one_scan_passes (created_at desc);

create table public.one_scan_admin_login_attempts (
  ip inet not null,
  bucket timestamptz not null,
  attempts integer not null default 0,
  primary key (ip, bucket)
);

alter table public.one_scan_allowed_players enable row level security;
alter table public.one_scan_passes enable row level security;
alter table public.one_scan_admin_login_attempts enable row level security;
-- No public RLS policies. Explicit grants remain server-side only.
revoke all on table public.one_scan_allowed_players, public.one_scan_passes, public.one_scan_admin_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.one_scan_allowed_players, public.one_scan_passes, public.one_scan_admin_login_attempts to service_role;
grant usage, select on sequence public.one_scan_passes_id_seq to service_role;

create function public.one_scan_lock_pass(p_key text, p_session text, p_ip text)
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
  if v_pass.status = 'claimed' then return jsonb_build_object('ok',false,'reason','claimed'); end if;
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

create function public.one_scan_claim_pass(
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
  exception when unique_violation then
    -- A hard-index collision must not strand the reservation.
    update public.one_scan_passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
    return jsonb_build_object('ok',false,'reason','already_claimed_today');
  end;
  return jsonb_build_object('ok',true,'reason','claimed','claimed_at',v_time);
end; $$;

-- Database-backed 15-minute window; enforces 8 admin login attempts / IP / window.
create function public.one_scan_admin_login_allow(p_ip text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_ip inet;
begin
  begin v_ip := p_ip::inet;
  exception when invalid_text_representation then return false;
  end;
  if v_ip is null then return false; end if;
  insert into public.one_scan_admin_login_attempts(ip,bucket,attempts)
    values(v_ip,pg_catalog.date_bin(interval '15 minutes',pg_catalog.clock_timestamp(), '2000-01-01 00:00:00+00'::timestamptz),1)
  on conflict(ip,bucket) do update set attempts=public.one_scan_admin_login_attempts.attempts+1
  returning attempts into v_count;
  return v_count <= 8;
end; $$;

revoke all on function public.one_scan_lock_pass(text,text,text) from public,anon,authenticated;
revoke all on function public.one_scan_claim_pass(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.one_scan_admin_login_allow(text) from public,anon,authenticated;
grant execute on function public.one_scan_lock_pass(text,text,text) to service_role;
grant execute on function public.one_scan_claim_pass(text,text,text,text,text,text) to service_role;
grant execute on function public.one_scan_admin_login_allow(text) to service_role;
