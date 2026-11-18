import 'server-only';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';

export function clientIp(request: NextRequest): string {
  // Vercel overwrites its forwarding headers. Never trust these on arbitrary hosting.
  if (process.env.VERCEL) {
    const raw = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || '';
    const value = raw.split(',')[0]?.trim();
    if (isIP(value)) return value;
    throw new Error('Trusted client IP not available');
  }
  if (process.env.NODE_ENV === 'development') return '127.0.0.1';
  throw new Error('IP enforcement requires verified Vercel request headers');
}

export function validOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === req.nextUrl.origin; } catch { return false; }
}

export function json(data: object, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function forbidden() { return json({ ok:false, reason:'forbidden' },403); }
export function exception(error: unknown) {
  console.error('API error:', error instanceof Error ? error.message : error);
  return json({ ok:false, reason:'server_error' },500);
}
