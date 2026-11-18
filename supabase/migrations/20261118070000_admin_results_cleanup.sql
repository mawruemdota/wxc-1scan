-- Fresh dedicated database example ONLY. Never apply this to the shared 1xb project.
CREATE OR REPLACE FUNCTION public.cleanup_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_total bigint;
  v_claimed bigint;
  v_active bigint;
  v_max_id bigint;
  v_receipts bigint;
begin
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where status='claimed'),
         pg_catalog.count(*) filter (where status='reserved' and reserved_until>v_now),
         coalesce(pg_catalog.max(id), 0)
  into v_total,v_claimed,v_active,v_max_id
  from public.passes;
  select pg_catalog.count(*) into v_receipts from public.claim_receipts;
  return pg_catalog.jsonb_build_object(
    'ok',true,'total',v_total,'claimed',v_claimed,
    'activeReservations',v_active,'receipts',v_receipts,
    'maxId',v_max_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_all_passes(p_expected_total bigint, p_expected_claimed bigint, p_expected_max_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_total bigint;
  v_claimed bigint;
  v_active bigint;
  v_max_id bigint;
  v_receipts bigint;
  v_deleted bigint;
begin
  if p_expected_total is null or p_expected_claimed is null or p_expected_max_id is null or
     p_expected_total < 0 or p_expected_claimed < 0 or p_expected_max_id < 0 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','invalid_confirmation');
  end if;

  -- Block concurrent QR generation/reservation/claims for an atomic count and delete.
  lock table public.passes in share row exclusive mode;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where status='claimed'),
         pg_catalog.count(*) filter (where status='reserved' and reserved_until>v_now),
         coalesce(pg_catalog.max(id),0)
  into v_total,v_claimed,v_active,v_max_id
  from public.passes;
  if v_active>0 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','active_reservations','activeReservations',v_active);
  end if;
  if v_total=0 then
    return pg_catalog.jsonb_build_object('ok',false,'reason','nothing_to_clear');
  end if;
  if p_expected_total<>v_total or p_expected_claimed<>v_claimed or p_expected_max_id<>v_max_id then
    return pg_catalog.jsonb_build_object('ok',false,'reason','results_changed',
      'total',v_total,'claimed',v_claimed,'maxId',v_max_id);
  end if;

  select pg_catalog.count(*) into v_receipts from public.claim_receipts;
  -- Important: this also erases the claim history enforcing one claim per
  -- registered username per Manila day. All existing QR links become invalid.
  delete from public.passes;
  get diagnostics v_deleted = row_count;
  return pg_catalog.jsonb_build_object(
    'ok',true,'deleted',v_deleted,'receiptsDeleted',v_receipts);
end;
$function$;

revoke all on function public.cleanup_preview() from public,anon,authenticated;
revoke all on function public.clear_all_passes(bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.cleanup_preview() to service_role;
grant execute on function public.clear_all_passes(bigint,bigint,bigint) to service_role;
