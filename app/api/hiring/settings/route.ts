import { NextRequest } from 'next/server';
import { ensureSettings, hiringPeople, settingsDto, settingsSchema, updateSettings } from '@/lib/hiring/core';
import { repliesEnabled } from '@/lib/hiring/comms';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: ajustes de la página de empleos, personas con Hiring (para el equipo) y si las respuestas por email vuelven. */
export async function GET() {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const settings = await ensureSettings(a.actor.ws);
  return hJson({ settings: settingsDto(settings), people: await hiringPeople(a.actor.ws), repliesEnabled: repliesEnabled(), canAdmin: a.actor.admin });
}

/** PUT: solo admins. */
export async function PUT(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson({ settings: settingsDto(await updateSettings(a.actor, await parseBody(req, settingsSchema))) });
  } catch (err) {
    return hFail(err);
  }
}
