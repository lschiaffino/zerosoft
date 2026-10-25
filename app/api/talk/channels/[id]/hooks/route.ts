import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { createHook, deleteHook, listHooks } from '@/lib/talk-extras';
import { siteUrl } from '@/lib/board-urls';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ name: z.string().max(60).default('Webhook') });

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json({ hooks: await listHooks(actor, id) }));
}

/** Crea un webhook entrante. La URL (con el token) se muestra una sola vez. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const { hook, token } = await createHook(actor, id, body.name);
      return NextResponse.json({ hook, url: `${siteUrl()}/api/talk/hooks/${token}` }, { status: 201 });
    },
    { write: 'hooks', limit: 30 },
  );
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const hookId = req.nextUrl.searchParams.get('hookId') ?? '';
      if (!(await deleteHook(actor, id, hookId))) return jsonError(404, 'not_found');
      return NextResponse.json({ ok: true });
    },
    { write: 'hooks', limit: 30 },
  );
}
