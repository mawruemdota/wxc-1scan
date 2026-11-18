import { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { exception, forbidden, json, validOrigin } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CleanupSnapshot = {
  ok: boolean;
  total: number;
  claimed: number;
  activeReservations: number;
  receipts: number;
  maxId: number;
};
type CleanupResult = {
  ok: boolean;
  reason?: string;
  deleted?: number;
  receiptsDeleted?: number;
  activeReservations?: number;
};

export async function GET() {
  if (!await isAdmin()) return forbidden();
  try {
    const { data, error } = await db().rpc('one_scan_cleanup_preview');
    if (error) throw error;
    return json(data as CleanupSnapshot);
  } catch (error) {
    return exception(error);
  }
}

export async function POST(req: NextRequest) {
  if (!validOrigin(req) || !await isAdmin()) return forbidden();
  try {
    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return json({ ok: false, reason: 'invalid_request' }, 400);
    const p = payload as Record<string, unknown>;
    if (p.confirmation !== 'CLEAR ALL QR RESULTS' || p.acknowledged !== true ||
        !Number.isSafeInteger(p.expectedTotal) || !Number.isSafeInteger(p.expectedClaimed) ||
        !Number.isSafeInteger(p.expectedMaxId) ||
        (p.expectedTotal as number) <= 0 || (p.expectedClaimed as number) < 0 || (p.expectedMaxId as number) < 0)
      return json({ ok: false, reason: 'confirmation_required' }, 400);
    const { data, error } = await db().rpc('one_scan_clear_all_passes', {
      p_expected_total: p.expectedTotal,
      p_expected_claimed: p.expectedClaimed,
      p_expected_max_id: p.expectedMaxId
    });
    if (error) throw error;
    const result = data as CleanupResult;
    if (!result.ok) {
      if (result.reason === 'results_changed') return json(result, 409);
      if (result.reason === 'active_reservations') return json(result, 423);
      return json(result, 400);
    }
    return json(result);
  } catch (error) {
    return exception(error);
  }
}
