import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');

test('1scan branding appears on public pages and admin dashboard', () => {
  for (const path of ['app/page.tsx', 'app/layout.tsx', 'components/ClaimForm.tsx', 'components/AdminDashboard.tsx']) {
    const content = read(path);
    assert.match(content, /1scan/);
    assert.doesNotMatch(content, /first[\s-]*to[\s-]*scan/i);
  }
});

test('1scan prefixes exported asset filenames and package name', () => {
  assert.match(read('components/AdminDashboard.tsx'), /1scan-qr-pass-\$\{pass\.id\}/);
  assert.match(read('app/api/admin/export/route.ts'), /1scan-claims-\$\{date\}/);
  assert.equal(JSON.parse(read('package.json')).name, '1scan');
});
