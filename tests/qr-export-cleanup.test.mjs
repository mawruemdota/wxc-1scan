import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { passFilter, isPassStatus } from '../lib/admin-query.ts';

const read = path => readFileSync(path, 'utf8');

test('filter choices and export route support all, available, reserved, claimed', () => {
  for (const status of ['all','unused','reserved','claimed']) assert.equal(isPassStatus(status), true);
  assert.equal(isPassStatus('arbitrary'), false);
  assert.equal(passFilter('all','','2026-11-18T08:00:00Z'),null);
  assert.match(passFilter('claimed','','2026-11-18T08:00:00Z'),/status.eq.claimed/);
  assert.match(passFilter('unused','','2026-11-18T08:00:00Z'),/reserved_until.lte/);
  const exportRoute=read('app/api/admin/export/route.ts');
  assert.match(exportRoute,/isPassStatus\(status\)/);
  assert.match(exportRoute,/passFilter\(status, search, serverNow\)/);
  assert.match(exportRoute,/if \(filter\) counter = counter.or\(filter\)/);
  assert.match(exportRoute,/if \(filter\) query = query.or\(filter\)/);
  assert.match(exportRoute,/csvRow\(headers\)/);
  assert.doesNotMatch(exportRoute,/claimed_ip|session_token/);
  assert.match(exportRoute,/await isAdmin\(\)/);
});

test('clear endpoint cannot delete without admin authentication and confirmation',()=>{
  const api=read('app/api/admin/cleanup/route.ts');
  const modal=read('components/AdminDashboard.tsx');
  assert.match(api,/await isAdmin\(\)/);
  assert.match(api,/validOrigin\(req\)/);
  assert.match(api,/p.confirmation !== 'CLEAR ALL QR RESULTS'/);
  assert.match(api,/p.acknowledged !== true/);
  assert.match(api,/one_scan_clear_all_passes/);
  assert.match(modal,/Clear all QR results/);
  assert.match(modal,/Export all QR results \(backup CSV\)/);
  assert.match(modal,/cleanupPhrase !== 'CLEAR ALL QR RESULTS'/);
  assert.match(modal,/activeReservations/);
});

test('cleanup SQL cannot delete allowed players or registration settings',()=>{
  const sql=read('supabase/1xb_shared/07_admin_results_cleanup.sql');
  assert.match(sql,/delete from public.one_scan_passes/i);
  assert.doesNotMatch(sql,/delete from public.one_scan_allowed_players/i);
  assert.doesNotMatch(sql,/delete from public.one_scan_settings/i);
  assert.match(sql,/share row exclusive mode/i);
});
