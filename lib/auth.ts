import 'server-only';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'qr_admin';
export const PLAYER_COOKIE = 'qr_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

function password(): string {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd || pwd.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters');
  return pwd;
}
function mac(value: string): string {
  // Domain separation: the password isn't directly emitted in any session token.
  return createHmac('sha256', createHash('sha256').update('qr-admin-session:' + password()).digest()).update(value).digest('hex');
}
function safeHexEquals(a:string,b:string):boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
export function checkPassword(candidate:string):boolean {
  const a = createHash('sha256').update(candidate).digest('hex');
  const b = createHash('sha256').update(password()).digest('hex');
  return safeHexEquals(a,b);
}
export function createAdminSession():string {
  const base = `${Date.now()+SESSION_MS}.${randomBytes(16).toString('hex')}`;
  return `${base}.${mac(base)}`;
}
export function verifyAdminSession(token?:string):boolean {
  if (!token || token.length > 160) return false;
  const parts=token.split('.');
  if(parts.length!==3 || !/^\d{13}$/.test(parts[0]) || !/^[a-f0-9]{32}$/.test(parts[1])) return false;
  const expiry=Number(parts[0]);
  if(!Number.isSafeInteger(expiry) || expiry<=Date.now() || expiry>Date.now()+SESSION_MS) return false;
  return safeHexEquals(mac(`${parts[0]}.${parts[1]}`),parts[2]);
}
export async function isAdmin():Promise<boolean> {
  return verifyAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
}
export const secureCookie = {
  httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'strict' as const, path:'/'
};
