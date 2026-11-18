import { NextRequest } from 'next/server';
import { ADMIN_COOKIE, checkPassword, createAdminSession, secureCookie } from '@/lib/auth';
import { clientIp, exception, forbidden, json, validOrigin } from '@/lib/http';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function POST(req:NextRequest) {
  if(!validOrigin(req)) return forbidden();
  try {
    const {password}=await req.json();
    if(typeof password!=='string'||password.length>500) return json({ok:false,reason:'invalid_credentials'},401);
    const {data,error}=await db().rpc('admin_login_allow',{p_ip:clientIp(req)});
    if(error) throw error;
    if(!data) return json({ok:false,reason:'too_many_attempts'},429);
    if(!checkPassword(password)) return json({ok:false,reason:'invalid_credentials'},401);
    const response=json({ok:true});
    response.cookies.set(ADMIN_COOKIE,createAdminSession(),{...secureCookie,maxAge:60*60*12});
    return response;
  }catch(e){return exception(e);}
}
