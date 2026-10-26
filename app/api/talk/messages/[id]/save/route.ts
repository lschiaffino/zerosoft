import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { completeSaved, setSaved } from '@/lib/talk-extras';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ done: z.boolean().optional() });

/** Guardar para más tarde ({ done } lo marca completado o lo reabre). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = (await readBody(req, schema)) ?? {};
      if (body.done !== undefined) await completeSaved(actor, id, body.done);
      else await setSaved(actor, id, true);
      return NextResponse.json({ ok: true });
    },
    { write: 'saved', limit: 240 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      await setSaved(actor, id, false);
      return NextResponse.json({ ok: true });
    },
    { write: 'saved', limit: 240 },
  );
}
