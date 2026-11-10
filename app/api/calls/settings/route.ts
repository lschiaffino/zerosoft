import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAutoJoin, getSettings, setAutoJoin, settingsSchema, updateSettings } from '@/lib/calls/settings';
import { callsActor, cFail, cJson, parseBody } from '@/lib/calls/http';
import { botConfigured } from '@/lib/calls/bot';
import { callsStorageConfigured } from '@/lib/calls/files';
import { AUTO_JOIN_RULES } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: ajustes del workspace, la regla de grabación de la persona y si hay bot y almacenamiento. */
export async function GET() {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const [settings, autoJoin] = await Promise.all([getSettings(a.actor.ws), getAutoJoin(a.actor.ws, a.actor.person)]);
  return cJson({ settings, autoJoin, admin: a.actor.admin, botConfigured: botConfigured(), storageConfigured: callsStorageConfigured() });
}

const schema = settingsSchema.extend({ autoJoin: z.enum(AUTO_JOIN_RULES as unknown as [string, ...string[]]).optional() });

/** PUT: la regla propia (cualquiera) y los ajustes del workspace (solo admins). */
export async function PUT(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { autoJoin, ...rest } = await parseBody(req, schema);
    if (autoJoin) await setAutoJoin(a.actor, autoJoin as (typeof AUTO_JOIN_RULES)[number]);
    const settings = Object.keys(rest).length ? await updateSettings(a.actor, rest) : await getSettings(a.actor.ws);
    return cJson({ settings, autoJoin: await getAutoJoin(a.actor.ws, a.actor.person) });
  } catch (err) {
    return cFail(err);
  }
}
