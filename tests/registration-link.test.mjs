import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeRegistrationUrl } from '../lib/registration-url.ts';

test('registration URL validation accepts only public HTTP(S) links and clearing', () => {
  assert.equal(normalizeRegistrationUrl(''), '');
  assert.equal(normalizeRegistrationUrl('   '), '');
  assert.equal(normalizeRegistrationUrl('https://example.com/register?a=1'), 'https://example.com/register?a=1');
  assert.equal(normalizeRegistrationUrl('http://example.org'), 'http://example.org/');
  for (const candidate of ['javascript:alert(1)', 'data:text/html,hello', 'ftp://example.com', 'example.com/register',
    'https://user:password@example.com/', 'https://', 'https://example.com/\nunsafe', 'x'.repeat(2050), 12, null]) {
    assert.equal(normalizeRegistrationUrl(candidate), null, String(candidate));
  }
});

test('registration destination can be saved only by authenticated admin', () => {
  const route = readFileSync('app/api/registration/route.ts', 'utf8');
  assert.match(route, /validOrigin\(req\)/);
  assert.match(route, /await isAdmin\(\)/);
  assert.match(route, /one_scan_settings/);
  assert.match(route, /normalizeRegistrationUrl/);
});

test('missing username shows exact message and configurable CTA', () => {
  const form = readFileSync('components/ClaimForm.tsx', 'utf8');
  const admin = readFileSync('components/AdminDashboard.tsx', 'utf8');
  assert.match(form, /User not found in the current database/);
  assert.match(form, /reason === 'username_not_allowed'/);
  assert.match(form, /Register here/);
  assert.match(form, /noopener noreferrer/);
  assert.match(admin, /Save registration link/);
  assert.match(admin, /\/api\/registration/);
});
