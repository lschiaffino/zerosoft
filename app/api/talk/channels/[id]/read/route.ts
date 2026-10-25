import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { markAllRead, markRead } from '@/lib/talk';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ at: z.string().max(40).nullable().optional() });

/** Marca leído (hasta `at`, o ahora). El id "all" marca todo. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = (await readBody(req, schema)) ?? {};
      if (id === 'all') await markAllRead(actor);
      else await markRead(actor, id, body.at ?? null);
      return NextResponse.json({ ok: true });
    },
    { write: 'read', limit: 600 },
  );
}
