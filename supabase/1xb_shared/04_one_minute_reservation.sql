-- One-minute reservation update for 1scan on shared 1xb. Applied on 2026-11-18.
-- Existing 1xb functions and daily claim / API rate-limit rules remain unchanged.
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
  v_expiry := v_time + interval '1 minute';
  update public.one_scan_passes set status='reserved', session_token=p_session, reserved_ip=v_ip, reserved_until=v_expiry
    where id=v_pass.id;
  return jsonb_build_object('ok',true,'reason','locked','reserved_until',v_expiry,'server_now',v_time);
end; $$;;

-- Existing active passes (if any) were shortened from five minutes to one minute.
update public.one_scan_passes
set reserved_until = reserved_until - interval '4 minutes'
where status = 'reserved' and reserved_until > pg_catalog.clock_timestamp();
