import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { createBookmark, deleteBookmark, listBookmarks, updateBookmark } from '@/lib/talk-bookmarks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => NextResponse.json({ bookmarks: await listBookmarks(actor, id) }));
}

const createSchema = z.object({ title: z.string().max(300).optional(), url: z.string().min(1).max(2100) });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, createSchema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createBookmark(actor, id, body), { status: 201 });
    },
    { write: 'bookmarks', limit: 60 },
  );
}

const patchSchema = z.object({ bookmarkId: z.string().max(64), title: z.string().max(300).optional(), url: z.string().min(1).max(2100).optional() });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, patchSchema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await updateBookmark(actor, id, body.bookmarkId, { title: body.title, url: body.url }));
    },
    { write: 'bookmarks', limit: 60 },
  );
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const bookmarkId = req.nextUrl.searchParams.get('bookmarkId') ?? '';
  return withTalk(
    async ({ actor }) => {
      if (!(await deleteBookmark(actor, id, bookmarkId))) return jsonError(404, 'not_found');
      return NextResponse.json({ ok: true });
    },
    { write: 'bookmarks', limit: 60 },
  );
}
