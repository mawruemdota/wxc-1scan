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
  username_not_allowed: 'That username is not on the approved player list. Your QR pass has been released.',
  already_claimed_today: 'This registered player username has already claimed a pass today. Your QR pass has been released.',
  expired: 'Your one-minute reservation expired. The pass is now available again.',
  not_session_owner: 'This browser does not own the reservation.',
  missing_session: 'Your browser session is missing. Open the QR code again.',
  invalid_request: 'Please check the details entered and try again.',
  server_error: 'The service is temporarily unavailable. Please try again.',
  forbidden: 'This request could not be verified. Reload the page and try again.',
  too_many_requests: 'Too many requests for this QR pass or browser session. Please wait before trying again.',
  not_claimed_yet: 'No confirmed claim was found for this browser yet. You can safely check again or retry your submission.'
};

type NoticeTone = 'reserved' | 'claimed' | 'error';

function noticeTone(reason: string): NoticeTone {
  if (reason === 'reserved' || reason === 'not_session_owner') return 'reserved';
  if (reason === 'claimed') return 'claimed';
  return 'error';
}

const noticeStyles: Record<NoticeTone, { container: string; icon: string; heading: string; body: string }> = {
  reserved: {
    container: 'border-orange-300 bg-orange-50',
    icon: 'bg-orange-100 text-orange-700 ring-orange-200',
    heading: 'text-orange-950',
    body: 'text-orange-900'
  },
  claimed: {
    container: 'border-emerald-300 bg-emerald-50',
    icon: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    heading: 'text-emerald-950',
    body: 'text-emerald-900'
  },
  error: {
    container: 'border-red-300 bg-red-50',
    icon: 'bg-red-100 text-red-700 ring-red-200',
    heading: 'text-red-950',
    body: 'text-red-900'
  }
};

function noticeHeading(reason: string, tone: NoticeTone) {
  if (reason === 'already_claimed_today') return <>Daily <strong className="font-black">player ID</strong> limit reached</>;
  if (tone === 'reserved') return <><strong className="font-black">Reserved</strong> — pass unavailable</>;
  if (tone === 'claimed') return <>Already <strong className="font-black">claimed</strong></>;
  if (reason === 'expired') return 'Reservation expired';
  if (reason === 'invalid_key') return 'Invalid QR code';
  if (reason === 'too_many_requests') return 'Request limit reached';
  return 'Unable to verify pass';
}

function noticeDetails(reason: string) {
  switch (reason) {
    case 'too_many_requests':
      return <>Too many attempts for this QR pass or browser session. Please wait before trying again.</>;
    case 'reserved':
      return <>Another visitor has <strong className="font-extrabold">reserved</strong> this QR pass. You can try again after their reservation expires.</>;
    case 'not_session_owner':
      return <>This pass is <strong className="font-extrabold">reserved</strong> by another browser session. Open it from the original browser or wait for the reservation to expire.</>;
    case 'claimed':
      return <>This QR pass has already been <strong className="font-extrabold">claimed</strong> and cannot be used again.</>;
    case 'already_claimed_today':
      return <>This <strong className="font-extrabold">registered player username</strong> has already claimed a pass today. Each player ID can claim once per Manila calendar day. This QR pass has been released.</>;
    default:
      return messages[reason] || 'This pass is not available.';
  }
}

function ScanNotice({ reason, retryAfter = 0, compact = false }: { reason: string; retryAfter?: number; compact?: boolean }) {
  const tone = noticeTone(reason);
  const style = noticeStyles[tone];
  return <div role="alert" className={'rounded-2xl border-2 text-left shadow-sm ' + (compact ? 'p-4 ' : 'p-5 sm:p-6 ') + style.container}>
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ' + style.icon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          {tone === 'claimed' ? <path d="M5 12.5 10 17l9-10" /> :
            tone === 'reserved' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> :
            <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4m0 3h.01" /></>}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={'text-lg font-extrabold leading-snug ' + style.heading}>{noticeHeading(reason, tone)}</h2>
        <p className={'mt-1.5 text-sm leading-6 ' + style.body}>{noticeDetails(reason)}</p>
        {reason === 'too_many_requests' && retryAfter > 0 &&
          <p className={'mt-2 text-sm font-semibold ' + style.body}>Try again in about {retryAfter} seconds.</p>}
      </div>
    </div>
  </div>;
}

export default function ClaimForm({ passKey }: { passKey: string }) {
  const lastKey = useRef<string | null>(null);
  const [state, setState] = useState<State>('locking');
  const [reason, setReason] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [until, setUntil] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [remaining, setRemaining] = useState(60);
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

  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
    <section className="panel w-full p-7 sm:p-9">
      <div className="mb-6 flex items-center gap-3"><span className="rounded-xl bg-ink px-3 py-2 text-2xl text-white">▦</span><div><p className="text-xs font-bold uppercase tracking-[.2em] text-pine">Pass verification</p><h1 className="text-2xl font-extrabold">1scan</h1></div></div>
      {state === 'locking' && <div role="status" className="py-16 text-center"><div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-pine"/><p className="font-semibold">Securing your pass…</p><p className="mt-2 text-sm text-slate-500">The first eligible browser request gets a one-minute reservation.</p></div>}
      {formVisible && <>
        <div className="mb-6 rounded-2xl bg-ink px-5 py-5 text-center text-white"><p className="text-xs font-semibold uppercase tracking-widest text-teal-200">Reservation expires in</p><div aria-live="off" className="mt-1 font-mono text-5xl font-bold tabular-nums">{timer}</div><p className="mt-2 text-xs text-teal-100">Refresh safely to resume in this browser.</p></div>
        {reason && <div className="mb-4"><ScanNotice reason={reason} retryAfter={retryAfter} compact /></div>}
        {['uncertain', 'checking'].includes(state) && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-950">Claim confirmation pending</p><p className="mt-1 text-sm text-amber-900">Your submission might already have succeeded. Checking the status will not create another claim.</p><button type="button" className="btn mt-3 w-full" onClick={() => void checkReceipt()} disabled={state === 'checking'}>{state === 'checking' ? 'Checking…' : 'Check claim status'}</button></div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Full name</span><input className="input" maxLength={120} autoComplete="name" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Your full name"/></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Registered username</span><input className="input" maxLength={64} autoCapitalize="none" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="Player username"/></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Email address</span><input className="input" maxLength={254} type="email" autoComplete="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com"/></label>
          <button className="btn w-full" disabled={state === 'submitting' || state === 'checking' || (state === 'ready' && remaining <= 0)}>{state === 'submitting' ? 'Verifying…' : state === 'uncertain' ? 'Retry submission safely' : 'Verify and claim pass'}</button>
        </form>
        <p className="mt-5 text-xs leading-5 text-slate-500">One claim per registered player username per Manila calendar day. Different players may use the same Wi-Fi network and email address.</p>
      </>}
      {state === 'success' && <div role="status" className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-5 py-9 text-center sm:px-7">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200"><svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17l9-10"/></svg></div>
        <h2 className="mt-5 text-2xl font-extrabold text-emerald-950">Pass <strong className="font-black">claimed</strong></h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">Your registration was verified and this QR code is now permanently used.</p>
        {claimReference && <p className="mt-4 font-mono text-lg font-bold text-emerald-950">{claimReference}</p>}
        {claimedAt && <p className="mt-3 text-sm text-emerald-800">Recorded: {new Date(claimedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)</p>}
        <p className="mt-5 text-xs text-emerald-800">Keep this browser session to view your receipt again for the next 24 hours.</p>
      </div>}
      {state === 'rejected' && <div className="py-4">
        <ScanNotice reason={reason} retryAfter={retryAfter} />
        {reason === 'too_many_requests' ? <button type="button" className="btn mt-5 w-full" onClick={() => void attemptLock()}>Try again</button> :
          <p className="mt-4 text-center text-xs leading-5 text-slate-500">If this pass was released, open the QR link again to retry.</p>}
      </div>}
    </section>
  </main>;
}
