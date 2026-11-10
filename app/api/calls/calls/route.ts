import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createUpload, listCalls } from '@/lib/calls/core';
import { sendBotNow } from '@/lib/calls/schedule';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (v: string | null) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** GET ?q=&owner=&deal=&from=&to=&minMinutes=&maxMinutes=: la biblioteca de llamadas que la persona ve. */
export async function GET(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const scope = await sessionScope(a.user);
  const calls = await listCalls(
    a.actor,
    {
      q: sp.get('q') ?? '',
      owner: sp.get('owner') ?? undefined,
      deal: sp.get('deal') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      minMinutes: num(sp.get('minMinutes')),
      maxMinutes: num(sp.get('maxMinutes')),
    },
    scope,
  );
  return cJson({ calls });
}

const schema = z.union([
  // Mandar el bot ya a una reunión de Google Meet.
  z.object({ meetingUrl: z.string().trim().min(10).max(500), title: z.string().trim().max(200).optional() }),
  // Subir una grabación: se crea la llamada y el navegador manda las partes.
  z.object({ upload: z.object({ title: z.string().trim().max(200), mime: z.string().max(120), size: z.number().int().positive() }) }),
]);

/** POST: mandar el bot a un link de Meet, o empezar la subida de una grabación. */
export async function POST(req: NextRequest) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'create', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const input = await parseBody(req, schema);
    if ('upload' in input) {
      const up = await createUpload(a.actor, input.upload);
      return cJson({ call: { id: up.id }, parts: up.parts }, 201);
    }
    const r = await sendBotNow(a.actor, { url: input.meetingUrl, title: input.title });
    return cJson({ call: { id: r.id } }, 201);
  } catch (err) {
    return cFail(err);
  }
}
