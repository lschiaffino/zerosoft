import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { deleteMessage, editMessage, getThread, markThreadRead, setFollow } from '@/lib/talk';
import { deleteUploads } from '@/lib/uploads';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ body: z.string().max(12_000).optional(), follow: z.boolean().optional(), read: z.boolean().optional() });

/** El hilo de este mensaje (raíz + respuestas). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json(await getThread(actor, id)));
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, patchSchema);
      if (!body) return jsonError(400, 'invalid_input');
      if (body.follow !== undefined) await setFollow(actor, id, body.follow);
      if (body.read) await markThreadRead(actor, id);
      if (body.body !== undefined) return NextResponse.json(await editMessage(actor, id, body.body));
      return NextResponse.json({ ok: true });
    },
    { write: 'messages', limit: 120 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const { fileUrls } = await deleteMessage(actor, id);
      await deleteUploads(fileUrls);
      return NextResponse.json({ ok: true });
    },
    { write: 'messages', limit: 120 },
  );
}
