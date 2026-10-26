import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { saveDraft } from '@/lib/talk-extras';

const schema = z.object({ channelId: z.string().min(1).max(64), parentId: z.string().max(64).nullable().optional(), body: z.string().max(12_000) });

/** Guarda (o borra, si está vacío) el borrador de un canal o hilo. */
export async function PUT(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      await saveDraft(actor, body.channelId, body.parentId ?? null, body.body);
      return NextResponse.json({ ok: true });
    },
    { write: 'drafts', limit: 600 },
  );
}
