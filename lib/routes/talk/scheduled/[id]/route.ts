import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { cancelScheduled, updateScheduled } from '@/lib/talk-extras';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ body: z.string().max(12_000).optional(), sendAt: z.string().min(10).max(40).optional() });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      if (!(await updateScheduled(actor, id, body))) return jsonError(404, 'not_found');
      return NextResponse.json({ ok: true });
    },
    { write: 'scheduled', limit: 60 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      if (!(await cancelScheduled(actor, id))) return jsonError(404, 'not_found');
      return NextResponse.json({ ok: true });
    },
    { write: 'scheduled', limit: 60 },
  );
}
