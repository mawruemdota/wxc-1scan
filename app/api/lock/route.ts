import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/supabase';
import { exception, forbidden, json, validOrigin } from '@/lib/http';
import { PLAYER_COOKIE, secureCookie } from '@/lib/auth';
import { enforcePublicRateLimit } from '@/lib/rate-limit';
import { shouldPersistPlayerSession } from '@/lib/session-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return forbidden();
  try {
    const raw: unknown = await req.json().catch(() => null);
    const key = raw && typeof raw === 'object' && 'key' in raw ? raw.key : null;
    if (typeof key !== 'string' || !/^[a-f0-9]{24}$/.test(key))
      return json({ ok: false, reason: 'invalid_key' }, 400);
    const rateLimited = await enforcePublicRateLimit('lock', key);
    if (rateLimited) return rateLimited;

    const cookieValue = req.cookies.get(PLAYER_COOKIE)?.value;
    const validExistingCookie = typeof cookieValue === 'string' && /^[a-f0-9]{64}$/.test(cookieValue);
    const session = validExistingCookie ? cookieValue : randomBytes(32).toString('hex');
    const { data, error } = await db().rpc('one_scan_lock_pass', { p_key: key, p_session: session, p_ip: '' });
    if (error) throw error;
    const result = data as { ok: boolean; reason: string; reserved_until?: string; server_now?: string; claimed_at?: string; claim_reference?: string };
    const response = json(result, result.ok ? 200 : 409);

    // CRITICAL: only a SUCCESSFUL new reservation establishes a browser cookie.
    // Concurrent first-load requests can each propose a different random session.
    // A losing/rejected response must NEVER overwrite the winner's cookie.
    // On a successful resume, refresh the SAME token's expiry for one-minute reservation.
    if (shouldPersistPlayerSession(result)) {
      response.cookies.set(PLAYER_COOKIE, session, { ...secureCookie, maxAge: 60 * 60 * 24 });
    }
    return response;
  } catch (error) { return exception(error); }
}
