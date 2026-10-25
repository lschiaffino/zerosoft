import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { deleteChannel, getChannelDto, updateChannel, updateMemberPrefs } from '@/lib/talk';
import { deleteUploads } from '@/lib/uploads';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  topic: z.string().max(250).optional(),
  description: z.string().max(1000).optional(),
  archived: z.boolean().optional(),
  kind: z.literal('private').optional(),
  starred: z.boolean().optional(),
  notify: z.enum(['default', 'all', 'mentions', 'none']).optional(),
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => {
    const channel = await getChannelDto(actor, id);
    if (!channel) return jsonError(404, 'not_found');
    return NextResponse.json(channel);
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, patchSchema);
      if (!body) return jsonError(400, 'invalid_input');
      const { starred, notify, ...rest } = body;
      if (starred !== undefined || notify !== undefined) await updateMemberPrefs(actor, id, { starred, notify });
      const channel = Object.keys(rest).length ? await updateChannel(actor, id, rest) : await getChannelDto(actor, id);
      if (!channel) return jsonError(404, 'not_found');
      return NextResponse.json(channel);
    },
    { write: 'channels', limit: 120 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const { fileUrls } = await deleteChannel(actor, id);
      await deleteUploads(fileUrls);
      return NextResponse.json({ ok: true });
    },
    { write: 'channels', limit: 60 },
  );
}
