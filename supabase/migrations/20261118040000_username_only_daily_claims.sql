-- Dedicated 1scan Supabase database ONLY; apply after 20261118030000.
-- Do not apply unprefixed migrations to shared 1xb.
alter table public.passes drop constraint valid_state;
alter table public.passes add constraint valid_state check (
 (status='unused' and session_token is null and reserved_ip is null and reserved_until is null
 and claimed_full_name is null and claimed_username is null and claimed_email is null and claimed_ip is null
 and claim_date is null and claimed_at is null)
 or
 (status='reserved' and session_token is not null and reserved_until is not null
 and claimed_full_name is null and claimed_username is null and claimed_email is null and claimed_ip is null
 and claim_date is null and claimed_at is null)
 or
 (status='claimed' and session_token is null and reserved_ip is null and reserved_until is null
 and claimed_full_name is not null and claimed_username is not null and claimed_email is not null
 and claim_date is not null and claimed_at is not null)
);
drop index if exists public.one_ip_per_day;
drop index if exists public.one_email_per_day;
drop index if exists public.passes_active_reservations;
create index if not exists passes_reserved_until on public.passes(reserved_until) where status='reserved';
create table if not exists public.public_token_rate_limits (
 endpoint text not null check (endpoint in ('lock','claim','receipt')),
 subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
 window_seconds integer not null check (window_seconds in (60,3600)),
 window_started timestamptz not null,
 attempts integer not null check (attempts>=1),
 primary key (endpoint,subject_hash,window_seconds)
);
alter table public.public_token_rate_limits enable row level security;
revoke all on table public.public_token_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on table public.public_token_rate_limits to service_role;

CREATE OR REPLACE FUNCTION public.claim_pass(p_key text, p_session text, p_ip text, p_full_name text, p_username text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_pass public.passes%rowtype;
 v_username text:=lower(btrim(p_username));
 v_email text:=lower(btrim(p_email));
 v_name text:=btrim(p_full_name);
 v_time timestamptz;
 v_today date;
begin
 -- p_ip remains only for RPC compatibility and is never used or stored.
 if p_key is null or p_session is null or p_username is null or p_email is null or p_full_name is null
 or p_key!~'^[a-f0-9]{24}$' or p_session!~'^[a-f0-9]{64}$'
 or char_length(v_username) not between 1 and 64
 or char_length(v_email) not between 3 and 254
 or char_length(v_name) not between 1 and 120
 or v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('username:'||v_username,0));
 select * into v_pass from public.passes where pass_key=p_key for update;
 v_time:=clock_timestamp();
 v_today:=(v_time at time zone 'Asia/Manila')::date;
 if not found then return jsonb_build_object('ok',false,'reason','invalid_key'); end if;
 if v_pass.status='claimed' then
   if exists(select 1 from public.claim_receipts r where r.pass_id=v_pass.id
    and r.session_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex')) then
     return jsonb_build_object('ok',true,'reason','already_claimed_by_you','claimed_at',v_pass.claimed_at,
       'claim_reference','FTS-'||lpad(v_pass.id::text,8,'0')); end if;
   return jsonb_build_object('ok',false,'reason','claimed');
 end if;
 if v_pass.status<>'reserved' or v_pass.session_token is distinct from p_session then
   return jsonb_build_object('ok',false,'reason','not_session_owner'); end if;
 if v_time>v_pass.reserved_until then
   update public.passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
   return jsonb_build_object('ok',false,'reason','expired'); end if;
 if not exists(select 1 from public.allowed_players where username=v_username) then
   update public.passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
   return jsonb_build_object('ok',false,'reason','username_not_allowed'); end if;
 if exists(select 1 from public.passes where status='claimed' and claim_date=v_today
   and claimed_username=v_username) then
   update public.passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
   return jsonb_build_object('ok',false,'reason','already_claimed_today'); end if;
 begin
   update public.passes set status='claimed',session_token=null,reserved_ip=null,reserved_until=null,
     claimed_full_name=v_name,claimed_username=v_username,claimed_email=v_email,claimed_ip=null,
     claim_date=v_today,claimed_at=v_time where id=v_pass.id;
   insert into public.claim_receipts(pass_id,session_hash) values
     (v_pass.id,encode(sha256(convert_to(p_session,'UTF8')),'hex'));
 exception when unique_violation then
   update public.passes set status='unused',session_token=null,reserved_ip=null,reserved_until=null where id=v_pass.id;
   return jsonb_build_object('ok',false,'reason','already_claimed_today');
 end;
 return jsonb_build_object('ok',true,'reason','claimed','claimed_at',v_time,
   'claim_reference','FTS-'||lpad(v_pass.id::text,8,'0'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.lock_pass(p_key text, p_session text, p_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pass public.passes%rowtype; v_time timestamptz; v_expiry timestamptz;
begin
 -- p_ip remains only for RPC compatibility and is never used or stored.
 if p_key is null or p_session is null or p_key!~'^[a-f0-9]{24}$' or p_session!~'^[a-f0-9]{64}$' then
   return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 select * into v_pass from public.passes where pass_key=p_key for update;
 v_time:=clock_timestamp();
 if not found then return jsonb_build_object('ok',false,'reason','invalid_key'); end if;
 if v_pass.status='claimed' then
   if exists(select 1 from public.claim_receipts r where r.pass_id=v_pass.id
     and r.session_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex')) then
     return jsonb_build_object('ok',true,'reason','claimed_by_you','claimed_at',v_pass.claimed_at,
       'claim_reference','FTS-'||lpad(v_pass.id::text,8,'0')); end if;
   return jsonb_build_object('ok',false,'reason','claimed');
 end if;
 if v_pass.status='reserved' and v_pass.reserved_until>v_time then
   if v_pass.session_token=p_session then
      return jsonb_build_object('ok',true,'reason','resumed','reserved_until',v_pass.reserved_until,'server_now',v_time);
   end if;
   return jsonb_build_object('ok',false,'reason','reserved');
 end if;
 v_expiry:=v_time+interval '1 minute';
 update public.passes set status='reserved',session_token=p_session,reserved_ip=null,reserved_until=v_expiry
 where id=v_pass.id;
 return jsonb_build_object('ok',true,'reason','locked','reserved_until',v_expiry,'server_now',v_time);
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_request_allow_token(p_endpoint text, p_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_hash text;
 v_now timestamptz:=clock_timestamp();
 v_secs integer;
 v_limit integer;
 v_count integer;
 v_started timestamptz;
 v_retry integer;
begin
 if p_endpoint is null or p_endpoint not in ('lock','claim','receipt') or p_subject is null or
    (p_endpoint='lock' and p_subject!~'^[a-f0-9]{24}$') or
    (p_endpoint<>'lock' and p_subject!~'^[a-f0-9]{64}$') then
   return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 v_hash:=encode(sha256(convert_to(p_subject,'UTF8')),'hex');
 foreach v_secs in array array[60,3600] loop
   v_limit:=case when p_endpoint='lock' and v_secs=60 then 15
     when p_endpoint='lock' then 100
     when p_endpoint='claim' and v_secs=60 then 8
     when p_endpoint='claim' then 40
     when v_secs=60 then 30 else 200 end;
   insert into public.public_token_rate_limits(endpoint,subject_hash,window_seconds,window_started,attempts)
     values(p_endpoint,v_hash,v_secs,v_now,1)
   on conflict(endpoint,subject_hash,window_seconds) do update
     set window_started=case
       when public.public_token_rate_limits.window_started+make_interval(secs=>v_secs)<=v_now
       then v_now else public.public_token_rate_limits.window_started end,
     attempts=case
       when public.public_token_rate_limits.window_started+make_interval(secs=>v_secs)<=v_now
       then 1 else least(public.public_token_rate_limits.attempts+1,1000000) end
   returning attempts,window_started into v_count,v_started;
   if v_count>v_limit then
     v_retry:=greatest(1,ceil(extract(epoch from
       (v_started+make_interval(secs=>v_secs)-v_now)))::integer);
     return jsonb_build_object('ok',false,'reason','too_many_requests','retry_after',v_retry);
   end if;
 end loop;
 return jsonb_build_object('ok',true,'reason','allowed');
end;
$function$;

revoke all on function public.lock_pass(text,text,text) from public,anon,authenticated;
revoke all on function public.claim_pass(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.public_request_allow_token(text,text) from public,anon,authenticated;
grant execute on function public.lock_pass(text,text,text) to service_role;
grant execute on function public.claim_pass(text,text,text,text,text,text) to service_role;
grant execute on function public.public_request_allow_token(text,text) to service_role;
