import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('claim screen states only username-limited daily claims and keeps distinct status colors', () => {
 const ui=readFileSync('components/ClaimForm.tsx','utf8');
 assert.match(ui,/One claim per registered player username per Manila calendar day/);
 assert.match(ui,/Different players may use the same Wi-Fi/);
 assert.doesNotMatch(ui,/ip_claimed_today|ip_already_reserved|ip_changed/);
 for (const color of ['border-red-300 bg-red-50','border-orange-300 bg-orange-50','border-emerald-300 bg-emerald-50']) assert.ok(ui.includes(color));
});
test('admin exports no longer expose historical IP addresses',()=>{
 const ui=readFileSync('components/AdminDashboard.tsx','utf8');
 const api=readFileSync('app/api/admin/export/route.ts','utf8');
 assert.doesNotMatch(ui,/claimed_ip/);
 assert.doesNotMatch(api,/claimed_ip|IP Address/);
});
