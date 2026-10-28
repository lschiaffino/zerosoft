import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { runCommand } from '@/lib/talk-commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ channelId: z.string().max(64), parentId: z.string().max(64).nullable().optional(), command: z.string().max(40), text: z.string().max(4000) });

/** Corre un slash command de una app en este canal. */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const res = await runCommand(actor, body);
      if (res.error) return jsonError(502, res.error);
      return NextResponse.json(res);
    },
    { write: 'commands-run', limit: 60 },
  );
}
