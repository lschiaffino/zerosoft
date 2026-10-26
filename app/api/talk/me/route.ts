import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { heartbeat, setPrefs, setStatus } from '@/lib/talk-extras';

const schema = z.object({
  status: z
    .object({ emoji: z.string().max(16).optional(), text: z.string().max(100).optional(), expiresAt: z.string().max(40).nullable().optional() })
    .optional(),
  away: z.boolean().optional(),
  dndUntil: z.string().max(40).nullable().optional(),
  prefs: z
    .object({ notify: z.enum(['all', 'mentions', 'none']).optional(), email: z.enum(['mentions', 'off']).optional(), keywords: z.string().max(500).optional() })
    .optional(),
});

/** Latido de presencia de la pestaña abierta. */
export async function POST() {
  return withTalk(
    async ({ actor }) => {
      await heartbeat(actor);
      return NextResponse.json({ ok: true });
    },
    { write: 'presence', limit: 120 },
  );
}

/** Estado, ausente, no molestar y preferencias de aviso. */
export async function PATCH(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const presence =
        body.status || body.away !== undefined || body.dndUntil !== undefined
          ? await setStatus(actor, { ...(body.status ?? {}), away: body.away, dndUntil: body.dndUntil })
          : null;
      const prefs = body.prefs ? await setPrefs(actor, body.prefs) : null;
      return NextResponse.json({ presence, prefs });
    },
    { write: 'me', limit: 120 },
  );
}
