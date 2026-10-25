import { NextResponse } from 'next/server';
import { getSettings, updateSettings } from '@/lib/groups';
import { groupsSession, readJson } from '@/lib/groups-http';
import type { GroupsSettings } from '@/lib/groups-rules';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reglas de tickets, SLA (con su email), umbral y modo de "sin responder". */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json(await getSettings(s.ws));
}

export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = (await readJson(req)) as Partial<GroupsSettings>;
  // Los emails del workspace (SLA) salen en el idioma de quien guarda los ajustes.
  const cookie = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1];
  const locale = (typeof b.locale === 'string' ? b.locale : requestLocale(cookie, req.headers.get('accept-language'))) as GroupsSettings['locale'];
  return NextResponse.json(await updateSettings(s.ws, { ...b, locale }));
}
