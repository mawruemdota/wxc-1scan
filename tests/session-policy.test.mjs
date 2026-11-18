import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPersistPlayerSession } from '../lib/session-policy.ts';

test('winning lock establishes a session; failed competing lock never overwrites it', () => {
  const winner = { ok: true, reason: 'locked' };
  const loser = { ok: false, reason: 'ip_already_reserved' };
  let browserCookie;
  const applyResponse = (response, proposedToken) => {
    if (shouldPersistPlayerSession(response)) browserCookie = proposedToken;
  };
  applyResponse(winner, 'session-A');
  applyResponse(loser, 'session-B');
  assert.equal(browserCookie, 'session-A');
  assert.equal(shouldPersistPlayerSession({ ok: false, reason: 'reserved' }), false);
});

test('same-session resume refreshes cookie; claimed receipt cannot mint a new session', () => {
  assert.equal(shouldPersistPlayerSession({ ok: true, reason: 'resumed' }), true);
  assert.equal(shouldPersistPlayerSession({ ok: true, reason: 'claimed_by_you' }), false);
  assert.equal(shouldPersistPlayerSession({ ok: false, reason: 'too_many_requests' }), false);
});
