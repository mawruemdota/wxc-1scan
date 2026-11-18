import { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/supabase';
import { exception, forbidden, json, validOrigin } from '@/lib/http';
import { normalizeRegistrationUrl } from '@/lib/registration-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETTING_KEY = 'registration_url';

/** Public, read-only: provides only the configured registration destination. */
export async function GET() {
  try {
    const { data, error } = await db()
      .from('one_scan_settings')
      .select('setting_value')
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();
    if (error) throw error;
    return json({ ok: true, registrationUrl: data?.setting_value || null });
  } catch (error) {
    return exception(error);
  }
}

/** Admin-only: protected by signed HttpOnly cookie and same-origin check. */
export async function POST(req: NextRequest) {
  if (!validOrigin(req) || !await isAdmin()) return forbidden();
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('registrationUrl' in body))
      return json({ ok: false, reason: 'invalid_request' }, 400);
    const registrationUrl = normalizeRegistrationUrl(body.registrationUrl);
    if (registrationUrl === null)
      return json({ ok: false, reason: 'invalid_url' }, 400);

    const { data, error } = await db()
      .from('one_scan_settings')
      .upsert({
        setting_key: SETTING_KEY,
        setting_value: registrationUrl,
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' })
      .select('setting_value')
      .single();
    if (error) throw error;
    return json({ ok: true, registrationUrl: data.setting_value || null });
  } catch (error) {
    return exception(error);
  }
}
