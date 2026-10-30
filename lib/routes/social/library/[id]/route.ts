import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { deleteLibraryItem, getLibraryItem, updateLibraryItem } from '@/lib/social';
import { mediaSchema } from '@/lib/social-schemas';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(async ({ actor }) => NextResponse.json(await getLibraryItem(actor, id)));
}

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(10_000).optional(),
  media: z.array(mediaSchema).max(20).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await updateLibraryItem(actor, id, body));
    },
    { write: 'library', limit: 240 },
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      await deleteLibraryItem(actor, id);
      return NextResponse.json({ ok: true });
    },
    { write: 'library', limit: 120 },
  );
}
