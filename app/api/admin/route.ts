import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { exception, forbidden, json, validOrigin } from '@/lib/http';
import { isPassStatus, normalizePassSearch, passFilter } from '@/lib/admin-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PASS_COLUMNS = 'id,pass_key,status,reserved_until,claimed_full_name,claimed_username,claimed_email,claimed_ip,claim_date,claimed_at,created_at';

export async function GET(req: NextRequest) {
  if (!await isAdmin()) return forbidden();
  try {
    const params = req.nextUrl.searchParams;
    const offset = Number(params.get('offset') || '0');
    const limit = Number(params.get('limit') || '25');
    const status = params.get('status') || 'all';
    const rawSearch = params.get('search') || '';
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !isPassStatus(status) || rawSearch.length > 80) {
      return json({ ok: false, reason: 'invalid_query' }, 400);
    }
    const supabase = db();
    const serverNow = new Date().toISOString();
    let listing = supabase.from('passes').select(PASS_COLUMNS, { count: 'exact' });
    const filter = passFilter(status, normalizePassSearch(rawSearch), serverNow);
    if (filter) listing = listing.or(filter);
    const [passes, total, unused, reserved, claimed, expired, players] = await Promise.all([
      listing.order('id', { ascending: false }).range(offset, offset + limit - 1),
      supabase.from('passes').select('id', { head: true, count: 'exact' }),
      supabase.from('passes').select('id', { head: true, count: 'exact' }).eq('status', 'unused'),
      supabase.from('passes').select('id', { head: true, count: 'exact' }).eq('status', 'reserved').gt('reserved_until', serverNow),
      supabase.from('passes').select('id', { head: true, count: 'exact' }).eq('status', 'claimed'),
      supabase.from('passes').select('id', { head: true, count: 'exact' }).eq('status', 'reserved').lte('reserved_until', serverNow),
      supabase.from('allowed_players').select('username', { head: true, count: 'exact' })
    ]);
    for (const result of [passes, total, unused, reserved, claimed, expired, players]) {
      if (result.error) throw result.error;
    }
    return json({
      ok: true,
      passes: passes.data,
      count: passes.count || 0,
      allowedPlayerCount: players.count || 0,
      stats: {
        total: total.count || 0,
        unused: (unused.count || 0) + (expired.count || 0),
        reserved: reserved.count || 0,
        claimed: claimed.count || 0
      },
      serverNow
    });
  } catch (e) { return exception(e); }
}

export async function POST(req: NextRequest) {
  if (!validOrigin(req) || !await isAdmin()) return forbidden();
  try {
    const payload = await req.json();
    const supabase = db();
    if (payload.action === 'generate') {
      const count = Number(payload.count);
      if (!Number.isInteger(count) || count < 1 || count > 100) return json({ ok: false, reason: 'count_must_be_1_to_100' }, 400);
      const keys = Array.from({ length: count }, () => ({ pass_key: randomBytes(12).toString('hex') }));
      const { error } = await supabase.from('passes').insert(keys);
      if (error) throw error;
      return json({ ok: true, generated: count });
    }
    if (payload.action === 'upsert_players' || payload.action === 'replace_players') {
      if (!Array.isArray(payload.usernames) || payload.usernames.length < 1 || payload.usernames.length > 10000)
        return json({ ok: false, reason: 'invalid_player_list' }, 400);
      const normalized: string[] = [...new Set(payload.usernames.map((name: unknown) =>
        typeof name === 'string' ? name.trim().toLowerCase() : ''))].filter(x => x.length >= 1 && x.length <= 64);
      if (!normalized.length) return json({ ok: false, reason: 'no_valid_usernames' }, 400);
      if (payload.action === 'replace_players') {
        if (payload.usernames.some((name: unknown) => typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 64))
          return json({ ok: false, reason: 'invalid_username' }, 400);
        if (payload.confirm !== true) return json({ ok: false, reason: 'confirmation_required' }, 400);
        const { data, error } = await supabase.rpc('replace_allowed_players', { p_usernames: normalized });
        if (error) throw error;
        return json(data as object, data?.ok ? 200 : 400);
      }
      for (let i = 0; i < normalized.length; i += 500) {
        const { error } = await supabase.from('allowed_players').upsert(
          normalized.slice(i, i + 500).map(username => ({ username })), { onConflict: 'username', ignoreDuplicates: true }
        );
        if (error) throw error;
      }
      return json({ ok: true, imported: normalized.length });
    }
    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (e) { return exception(e); }
}
