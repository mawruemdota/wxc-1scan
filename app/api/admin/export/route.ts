import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { csvRow, normalizePassSearch, passFilter } from '@/lib/admin-query';
import { exception, forbidden, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = 10000;
const COLUMNS = 'id,pass_key,claimed_full_name,claimed_username,claimed_email,claimed_ip,claim_date,claimed_at,created_at';

export async function GET(req: NextRequest) {
  if (!await isAdmin()) return forbidden();
  try {
    const rawSearch = req.nextUrl.searchParams.get('search') || '';
    if (rawSearch.length > 80) return json({ ok: false, reason: 'invalid_query' }, 400);
    const search = normalizePassSearch(rawSearch);
    const supabase = db();
    const filter = passFilter('claimed', search, new Date().toISOString());
    const check = supabase.from('one_scan_passes').select('id', { count: 'exact', head: true }).or(filter!);
    const count = await check;
    if (count.error) throw count.error;
    if ((count.count || 0) > LIMIT) return json({ ok: false, reason: 'export_limit_exceeded', limit: LIMIT }, 413);

    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < (count.count || 0); offset += 500) {
      const query = supabase.from('one_scan_passes').select(COLUMNS).or(filter!).order('id', { ascending: false }).range(offset, offset + 499);
      const result = await query;
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
    }
    const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => dateParts.find(item => item.type === type)?.value || '00';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const manilaTime = (input: unknown) => input ? new Date(String(input)).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false }) : '';
    const headers = ['Pass ID', 'Pass Key', 'Full Name', 'Username', 'Email', 'IP Address', 'Claim Date (Manila)', 'Claimed At (Manila)', 'Created At (Manila)'];
    const csv = '\uFEFF' + [csvRow(headers), ...rows.map(row => csvRow([
      row.id, row.pass_key, row.claimed_full_name, row.claimed_username,
      row.claimed_email, row.claimed_ip, row.claim_date, manilaTime(row.claimed_at), manilaTime(row.created_at)
    ]))].join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="1scan-claims-${date}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (e) { return exception(e); }
}
