import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { getTalkSettings, setTalkSettings } from '@/lib/talk-admin';
import { hasTurn } from '@/lib/talk-huddles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes de Talk del workspace (retención, ventana de edición) y si hay TURN para huddles. */
export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json({ settings: await getTalkSettings(actor.workspaceId), turn: hasTurn() }));
}

const schema = z.object({ retentionDays: z.number().int().nullable().optional(), editWindowMinutes: z.number().int().nullable().optional() });

export async function PATCH(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json({ settings: await setTalkSettings(actor, body) });
    },
    { write: 'admin', limit: 30 },
  );
}
