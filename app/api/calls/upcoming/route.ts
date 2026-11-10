import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listUpcoming, setEventMode } from '@/lib/calls/schedule';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';
import { botConfigured } from '@/lib/calls/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: próximas reuniones de la persona (7 días) y si el bot va a entrar a cada una. */
export async function GET() {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    return cJson({ ...(await listUpcoming(a.actor)), botConfigured: botConfigured() });
  } catch (err) {
    return cFail(err);
  }
}

const schema = z.object({ key: z.string().min(3).max(600), mode: z.enum(['auto', 'on', 'off']) });

/** PUT: el interruptor de una reunión ('on' graba, 'off' no, 'auto' sigue la regla). */
export async function PUT(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'toggle', 300, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    return cJson({ event: await setEventMode(a.actor, input.key, input.mode) });
  } catch (err) {
    return cFail(err);
  }
}
