'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';

type State = 'locking' | 'ready' | 'submitting' | 'checking' | 'uncertain' | 'success' | 'rejected';
type ApiResult = {
  ok: boolean;
  reason: string;
  reserved_until?: string;
  server_now?: string;
  claimed_at?: string;
  claim_reference?: string;
  retry_after?: number;
};
const messages: Record<string, string> = {
  invalid_key: 'This QR code is invalid or does not exist.',
  claimed: 'This QR pass has already been claimed.',
  reserved: 'Another visitor reserved this pass first. Please try again after the reservation expires.',
  ip_claimed_today: 'This internet connection has already claimed a pass today.',
  ip_already_reserved: 'This internet connection already has another active reservation.',
  username_not_allowed: 'That username is not on the approved player list. Your QR pass has been released.',
  already_claimed_today: 'This username, email, or internet connection already claimed a pass today. Your QR pass has been released.',
  expired: 'Your five-minute reservation expired. The pass is now available again.',
  ip_changed: 'Your network IP address changed. Reconnect to your original network and try again before the timer expires.',
  not_session_owner: 'This browser does not own the reservation.',
  missing_session: 'Your browser session is missing. Open the QR code again.',
  invalid_request: 'Please check the details entered and try again.',
  server_error: 'The service is temporarily unavailable. Please try again.',
  forbidden: 'This request could not be verified. Reload the page and try again.',
  too_many_requests: 'Too many requests from this connection. Please wait before trying again.',
  not_claimed_yet: 'No confirmed claim was found for this browser yet. You can safely check again or retry your submission.'
};

export default function ClaimForm({ passKey }: { passKey: string }) {
  const lastKey = useRef<string | null>(null);
  const [state, setState] = useState<State>('locking');
  const [reason, setReason] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [until, setUntil] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [remaining, setRemaining] = useState(300);
  const [form, setForm] = useState({ fullName: '', username: '', email: '' });
  const [claimedAt, setClaimedAt] = useState('');
  const [claimReference, setClaimReference] = useState('');

  function showReceipt(result: ApiResult) {
    setClaimedAt(result.claimed_at || '');
    setClaimReference(result.claim_reference || '');
    setReason('');
    setState('success');
  }

  async function attemptLock() {
    if (!/^[a-f0-9]{24}$/.test(passKey)) { setReason('invalid_key'); setState('rejected'); return; }
    setReason('');
    setState('locking');
    try {
      const response = await fetch('/api/lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: passKey }), cache: 'no-store'
      });
      const result = await response.json() as ApiResult;
      if (lastKey.current !== passKey) return;
      if (!result.ok) {
        setReason(result.reason || 'server_error');
        setRetryAfter(result.retry_after || 0);
        setState('rejected');
        return;
      }
      if (result.reason === 'claimed_by_you') { showReceipt(result); return; }
      if (!result.reserved_until || !result.server_now) {
        setReason('server_error'); setState('rejected'); return;
      }
      setClockOffset(Date.parse(result.server_now) - Date.now());
      setUntil(Date.parse(result.reserved_until));
      setRemaining(Math.max(0, Math.ceil((Date.parse(result.reserved_until) - Date.parse(result.server_now)) / 1000)));
      setState('ready');
    } catch {
      if (lastKey.current !== passKey) return;
      setReason('server_error'); setState('rejected');
    }
  }

  useEffect(() => {
    // Avoid StrictMode duplicate scans, but allow client-side navigation to
    // another QR key without rendering the previous pass's receipt or timer.
    if (lastKey.current === passKey) return;
    lastKey.current = passKey;
    setForm({ fullName: '', username: '', email: '' });
    setClaimedAt('');
    setClaimReference('');
    void attemptLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passKey]);

  useEffect(() => {
    if (!['ready', 'submitting', 'checking', 'uncertain'].includes(state)) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((until - (Date.now() + clockOffset)) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [state, until, clockOffset]);

  useEffect(() => {
    // An uncertain submission may already be committed. Keep recovery available
    // even after the reservation timer reaches zero.
    if (state === 'ready' && remaining <= 0) { setReason('expired'); setState('rejected'); }
  }, [state, remaining]);

  async function checkReceipt() {
    setState('checking');
    try {
      const response = await fetch(`/api/receipt?key=${encodeURIComponent(passKey)}`, { cache: 'no-store' });
      const result = await response.json() as ApiResult;
      if (lastKey.current !== passKey) return;
      if (result.ok) { showReceipt(result); return; }
      setReason(result.reason === 'too_many_requests' ? 'too_many_requests' : 'not_claimed_yet');
      setRetryAfter(result.retry_after || 0);
      setState('uncertain');
    } catch {
      if (lastKey.current !== passKey) return;
      setReason('server_error');
      setState('uncertain');
    }
  }

  async function submitClaim() {
    if (state !== 'ready' && state !== 'uncertain') return;
    // When the outcome is uncertain, an idempotent retry is safe even after
    // the clock expires; the server will return an existing receipt if claimed.
    if (state === 'ready' && remaining <= 0) return;
    setReason('');
    setState('submitting');
    try {
      const response = await fetch('/api/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: passKey, ...form }), cache: 'no-store'
      });
      const result = await response.json() as ApiResult;
      if (lastKey.current !== passKey) return;
      if (result.ok) { showReceipt(result); return; }
      if (result.reason === 'server_error') { await checkReceipt(); return; }
      setReason(result.reason || 'server_error');
      setRetryAfter(result.retry_after || 0);
      if (['invalid_request', 'ip_changed', 'too_many_requests'].includes(result.reason)) setState('ready');
      else setState('rejected');
    } catch {
      if (lastKey.current !== passKey) return;
      // An HTTP response can be lost AFTER the database committed the claim.
      // Ask the read-only receipt endpoint before telling the user it failed.
      await checkReceipt();
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitClaim();
  }

  const timer = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const formVisible = ['ready', 'submitting', 'checking', 'uncertain'].includes(state);
  const errorText = messages[reason] || 'This pass is not available.';

  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
    <section className="panel w-full p-7 sm:p-9">
      <div className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-ink px-3 py-2 text-2xl text-white">▦</span><div><p className="text-xs font-bold uppercase tracking-[.2em] text-pine">Pass verification</p><h1 className="text-2xl font-extrabold">1scan</h1></div></div>
      {state === 'locking' && <div role="status" className="py-16 text-center"><div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-pine"/><p className="font-semibold">Securing your pass…</p><p className="mt-2 text-sm text-slate-500">The first eligible browser request gets a five-minute reservation.</p></div>}
      {formVisible && <>
        <div className="mb-6 rounded-2xl bg-ink px-5 py-5 text-center text-white"><p className="text-xs font-semibold uppercase tracking-widest text-teal-200">Reservation expires in</p><div aria-live="off" className="mt-1 font-mono text-5xl font-bold tabular-nums">{timer}</div><p className="mt-2 text-xs text-teal-100">Refresh safely to resume in this browser.</p></div>
        {reason && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{errorText}{reason === 'too_many_requests' && retryAfter > 0 ? ` Try again in about ${retryAfter} seconds.` : ''}</p>}
        {['uncertain', 'checking'].includes(state) && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-950">Claim confirmation pending</p><p className="mt-1 text-sm text-amber-900">Your submission might already have succeeded. Checking the status will not create another claim.</p><button type="button" className="btn mt-3 w-full" onClick={() => void checkReceipt()} disabled={state === 'checking'}>{state === 'checking' ? 'Checking…' : 'Check claim status'}</button></div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Full name</span><input className="input" maxLength={120} autoComplete="name" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Your full name"/></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Registered username</span><input className="input" maxLength={64} autoCapitalize="none" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="Player username"/></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Email address</span><input className="input" maxLength={254} type="email" autoComplete="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com"/></label>
          <button className="btn w-full" disabled={state === 'submitting' || state === 'checking' || (state === 'ready' && remaining <= 0)}>{state === 'submitting' ? 'Verifying…' : state === 'uncertain' ? 'Retry submission safely' : 'Verify and claim pass'}</button>
        </form>
        <p className="mt-5 text-xs leading-5 text-slate-500">One claim per username, email address, and public IP per Manila calendar day. Shared Wi-Fi may prevent multiple claims.</p>
      </>}
      {state === 'success' && <div role="status" className="py-12 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-800">✓</div><h2 className="mt-5 text-2xl font-extrabold">Pass claimed</h2><p className="mt-2 text-slate-600">Your registration was verified and this QR code is now permanently used.</p>{claimReference && <p className="mt-4 font-mono text-lg font-bold text-ink">{claimReference}</p>}{claimedAt && <p className="mt-3 text-sm text-slate-500">Recorded: {new Date(claimedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)</p>}<p className="mt-5 text-xs text-slate-500">Keep this browser session to view your receipt again for the next 24 hours.</p></div>}
      {state === 'rejected' && <div role="alert" className="py-12 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl font-bold text-amber-800">!</div><h2 className="mt-5 text-2xl font-extrabold">Cannot claim this pass</h2><p className="mt-3 text-slate-600">{errorText}{reason === 'too_many_requests' && retryAfter > 0 ? ` Try again in about ${retryAfter} seconds.` : ''}</p>{reason === 'too_many_requests' ? <button type="button" className="btn mt-6 w-full" onClick={() => void attemptLock()}>Try again</button> : <p className="mt-5 text-xs text-slate-500">If this pass was released, open the QR link again to retry.</p>}</div>}
    </section>
  </main>;
}
