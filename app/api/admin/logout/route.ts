import { NextRequest } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';
import { forbidden,json,validOrigin } from '@/lib/http';
export async function POST(req:NextRequest) {
  if(!validOrigin(req)) return forbidden();
  const response=json({ok:true});
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}
