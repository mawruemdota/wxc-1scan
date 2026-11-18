-- Regression test: execute only in a rollback-only transaction on 1xb.
begin;
insert into public.one_scan_allowed_players(username) values('one_scan_smoke_id_a'),('one_scan_smoke_id_b') on conflict do nothing;
insert into public.one_scan_passes(id,pass_key) overriding system value values
 (-9551000001,'be0000000000000000000001'),
 (-9551000002,'be0000000000000000000002'),
 (-9551000003,'be0000000000000000000003');
do $$
declare a jsonb; s1 text:=repeat('a',64);s2 text:=repeat('b',64);s3 text:=repeat('c',64);
begin
 a:=public.one_scan_lock_pass('be0000000000000000000001',s1,'same-public-ip');
 if a->>'reason'<>'locked' then raise exception 'First lock %',a; end if;
 a:=public.one_scan_lock_pass('be0000000000000000000002',s2,'same-public-ip');
 if a->>'reason'<>'locked' then raise exception 'Same-IP second reservation %',a; end if;
 a:=public.one_scan_claim_pass('be0000000000000000000001',s1,'same-public-ip','A','one_scan_smoke_id_a','same@example.org');
 if a->>'reason'<>'claimed' then raise exception 'First claim %',a; end if;
 a:=public.one_scan_claim_pass('be0000000000000000000002',s2,'same-public-ip','B','one_scan_smoke_id_b','same@example.org');
 if a->>'reason'<>'claimed' then raise exception 'Shared IP/email blocked %',a; end if;
 a:=public.one_scan_lock_pass('be0000000000000000000003',s3,'');
 if a->>'reason'<>'locked' then raise exception 'Third lock %',a; end if;
 a:=public.one_scan_claim_pass('be0000000000000000000003',s3,'','A','ONE_SCAN_SMOKE_ID_A','other@example.org');
 if a->>'reason'<>'already_claimed_today' then raise exception 'Repeated username not blocked %',a; end if;
 a:=public.one_scan_lock_pass('be0000000000000000000001',s3,'');
 if a->>'reason'<>'claimed' then raise exception 'Claimed QR reusable %',a; end if;
 if exists(select 1 from public.one_scan_passes where id in (-9551000001,-9551000002) and claimed_ip is not null) then raise exception 'IP still being logged'; end if;
end; $$;
rollback;
