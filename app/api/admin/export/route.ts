import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { csvRow, isPassStatus, normalizePassSearch, passFilter } from '@/lib/admin-query';
import { exception, forbidden, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bounded export prevents runaway memory use on serverless. CSV includes full
// single-use QR keys: treat the exported file as sensitive event data.
const LIMIT = 10000;
const COLUMNS = 'id,pass_key,status,reserved_until,claimed_full_name,claimed_username,claimed_email,claim_date,claimed_at,created_at';

export async function GET(req: NextRequest) {
  if (!await isAdmin()) return forbidden();
  try {
    const status = req.nextUrl.searchParams.get('status') || 'claimed';
    const rawSearch = req.nextUrl.searchParams.get('search') || '';
    if (!isPassStatus(status) || rawSearch.length > 80)
      return json({ ok: false, reason: 'invalid_query' }, 400);
    const search = normalizePassSearch(rawSearch);
    const serverNow = new Date().toISOString();
    const filter = passFilter(status, search, serverNow);
    const supabase = db();

    let counter = supabase.from('one_scan_passes').select('id', { count: 'exact', head: true });
    if (filter) counter = counter.or(filter);
    const count = await counter;
    if (count.error) throw count.error;
    if ((count.count || 0) > LIMIT)
      return json({ ok: false, reason: 'export_limit_exceeded', limit: LIMIT }, 413);

    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < (count.count || 0); offset += 500) {
      let query = supabase.from('one_scan_passes').select(COLUMNS);
      if (filter) query = query.or(filter);
      const result = await query.order('id', { ascending: false }).range(offset, offset + 499);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
    }

    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => dateParts.find(item => item.type === type)?.value || '00';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const manilaTime = (input: unknown) => input
      ? new Date(String(input)).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour12: false })
      : '';
    const effectiveStatus = (row: Record<string, unknown>) => {
      if (row.status === 'claimed') return 'Claimed';
      if (row.status === 'reserved' && typeof row.reserved_until === 'string' &&
          Date.parse(row.reserved_until) > Date.parse(serverNow)) return 'Reserved';
      return 'Available';
    };
    const headers = [
      'Pass ID','Pass Key','QR Status','Reserved Until (Manila)','Full Name',
      'Username','Email','Claim Date (Manila)','Claimed At (Manila)','Created At (Manila)'
    ];
    const csv = '\uFEFF' + [csvRow(headers), ...rows.map(row => csvRow([
      row.id, row.pass_key, effectiveStatus(row),
      effectiveStatus(row) === 'Reserved' ? manilaTime(row.reserved_until) : '',
      row.claimed_full_name, row.claimed_username, row.claimed_email,
      row.claim_date, manilaTime(row.claimed_at), manilaTime(row.created_at)
    ]))].join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="1scan-qr-${status}-${date}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return exception(error);
  }
}
