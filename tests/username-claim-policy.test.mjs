import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(path,'utf8');

test('scan API routes throttle by QR or browser session, without client IP', () => {
  const routes = [
    ['app/api/lock/route.ts', "'lock', key"],
    ['app/api/claim/route.ts', "'claim', session"],
    ['app/api/receipt/route.ts', "'receipt', session"]
  ];
  for (const [path, call] of routes) {
    const source = read(path);
    assert.doesNotMatch(source, /clientIp\(req\)/);
    assert.ok(source.includes('enforcePublicRateLimit(' + call + ')'));
  }
  assert.match(read('lib/rate-limit.ts'), /one_scan_public_request_allow_token/);
  assert.doesNotMatch(read('lib/rate-limit.ts'), /p_ip:/);
});
