import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { signInPath } from '@/lib/return-path';
import { escapeHtml } from '@/lib/email';
import { TALK_WS_COOKIE, acceptGuestInvite } from '@/lib/talk-guests';
import { limitWrites } from '@/lib/write-limit';
import en from '@/messages/en/talk.json';
import es from '@/messages/es/talk.json';
import pt from '@/messages/pt/talk.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STR = { en: en.guests.accept, es: { ...en.guests.accept, ...es.guests.accept }, pt: { ...en.guests.accept, ...pt.guests.accept } };

function page(locale: 'en' | 'es' | 'pt', text: string, status: number) {
  const s = STR[locale];
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Talk</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:Canvas;color:CanvasText}main{max-width:480px;margin:0 auto}a{color:inherit}</style></head>
<body><main><h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(text)}</p><p><a href="/${locale}/app/talk">${escapeHtml(s.open)}</a></p></main></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Link del email de invitación: se acepta con una sesión del email invitado y entra al canal. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get('token') ?? '';
  const raw = sp.get('locale');
  const locale = raw === 'es' || raw === 'pt' ? raw : 'en';
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL(signInPath(locale, `/api/talk/guests/accept?token=${encodeURIComponent(token)}&locale=${locale}`), req.url));
  }
  const real = user.actingUser ?? user;
  const limited = await limitWrites('talk:guest-accept', real.id, 20);
  if (limited) return limited;
  const res = await acceptGuestInvite(token, real);
  if (!res.ok) {
    const s = STR[locale];
    return page(locale, res.reason === 'expired' ? s.expired : res.reason === 'email_mismatch' ? s.mismatch : res.reason === 'already_member' ? s.member : s.invalid, 400);
  }
  const target = res.channelId ? `/${locale}/app/talk/${res.channelId}` : `/${locale}/app/talk`;
  const out = NextResponse.redirect(new URL(target, req.url));
  out.cookies.set(TALK_WS_COOKIE, res.workspaceId, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 365 * 86_400 });
  return out;
}
