import { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';
import { PLAYER_COOKIE } from '@/lib/auth';
import { exception, json } from '@/lib/http';
import { enforcePublicRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only recovery for a lost POST response, reload, or changed network. */
export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get('key');
    const session = req.cookies.get(PLAYER_COOKIE)?.value;
    if (!key || !/^[a-f0-9]{24}$/.test(key) || !session || !/^[a-f0-9]{64}$/.test(session))
      return json({ ok: false, reason: 'not_claimed' }, 404);
    const rateLimited = await enforcePublicRateLimit('receipt', session);
    if (rateLimited) return rateLimited;
    const { data, error } = await db().rpc('one_scan_get_claim_receipt', { p_key: key, p_session: session });
    if (error) throw error;
    const result = data as { ok: boolean; reason: string; claimed_at?: string; claim_reference?: string };
    return json(result, result.ok ? 200 : 404);
  } catch (error) { return exception(error); }
}
