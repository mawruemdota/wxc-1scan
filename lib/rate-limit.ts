import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { json } from '@/lib/http';

type PublicEndpoint = 'lock' | 'claim' | 'receipt';
type RateResult = { ok: boolean; reason: string; retry_after?: number };

/** Database-atomic quotas by QR pass key or browser session; no shared-IP throttling. */
export async function enforcePublicRateLimit(endpoint: PublicEndpoint, subject: string): Promise<NextResponse | null> {
  const { data, error } = await db().rpc('one_scan_public_request_allow_token', {
    p_endpoint: endpoint,
    p_subject: subject
  });
  if (error) throw error; // Fail closed if the migration was not applied or Supabase is unavailable.
  const result = data as RateResult | null;
  if (!result) throw new Error('Missing public_request_allow result');
  if (result.ok) return null;
  if (result.reason !== 'too_many_requests') throw new Error(`Unexpected rate-limit result: ${result.reason}`);
  const retryAfter = Math.max(1, Math.min(3600, Number(result.retry_after) || 60));
  const response = json({ ok: false, reason: 'too_many_requests', retry_after: retryAfter }, 429);
  response.headers.set('Retry-After', String(retryAfter));
  return response;
}
