import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { afterPost, listChannelMessages, postMessage } from '@/lib/talk';
import { after } from 'next/server';

type Ctx = { params: Promise<{ id: string }> };

const postSchema = z.object({
  body: z.string().max(12_000).default(''),
  parentId: z.string().max(64).nullable().optional(),
  alsoInChannel: z.boolean().optional(),
  fileIds: z.array(z.string().max(64)).max(10).optional(),
});

/** ?before= / ?after= (fechas ISO) o ?around=<id de mensaje>; ?limit=. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    return NextResponse.json(
      await listChannelMessages(actor, id, {
        before: sp.get('before'),
        after: sp.get('after'),
        around: sp.get('around'),
        limit: Number(sp.get('limit')) || 50,
      }),
    );
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, postSchema);
      if (!body) return jsonError(400, 'invalid_input');
      const result = await postMessage(actor, { channelId: id, body: body.body, parentId: body.parentId ?? null, alsoInChannel: body.alsoInChannel, fileIds: body.fileIds });
      // Avisos, vista previa de links y Flow después de responder.
      const job = () => afterPost(actor, result).catch((err) => console.error('[talk] afterPost', err));
      try {
        after(job);
      } catch {
        await job();
      }
      return NextResponse.json(result.message, { status: 201 });
    },
    { write: 'messages', limit: 120 },
  );
}
