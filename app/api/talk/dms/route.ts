import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { openDm } from '@/lib/talk';

const schema = z.object({ userIds: z.array(z.string().max(64)).max(9) });

/** Abre (o crea) el DM con estas personas (vacío = DM conmigo). */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await openDm(actor, body.userIds));
    },
    { write: 'dms', limit: 60 },
  );
}
