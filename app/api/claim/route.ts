import { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';
import { PLAYER_COOKIE } from '@/lib/auth';
import { clientIp, exception, forbidden, json, validOrigin } from '@/lib/http';
import { enforcePublicRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return forbidden();
  try {
    const ip = clientIp(req);
    const rateLimited = await enforcePublicRateLimit('claim', ip);
    if (rateLimited) return rateLimited;

    const session = req.cookies.get(PLAYER_COOKIE)?.value;
    if (!session || !/^[a-f0-9]{64}$/.test(session))
      return json({ ok: false, reason: 'missing_session' }, 403);
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return json({ ok: false, reason: 'invalid_request' }, 400);
    const { key, fullName, username, email } = raw;
    if (typeof key !== 'string' || !/^[a-f0-9]{24}$/.test(key) ||
        typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.trim().length > 120 ||
        typeof username !== 'string' || username.trim().length < 1 || username.trim().length > 64 ||
        typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return json({ ok: false, reason: 'invalid_request' }, 400);

    // claim_pass returns the original receipt for a repeated submission from
    // the same session, even after the first success cleared its reservation.
    const { data, error } = await db().rpc('claim_pass', {
      p_key: key, p_session: session, p_ip: ip,
      p_full_name: fullName, p_username: username, p_email: email
    });
    if (error) throw error;
    const result = data as { ok: boolean; reason: string; claimed_at?: string; claim_reference?: string };
    return json(result, result.ok ? 200 : 409);
  } catch (error) { return exception(error); }
}
