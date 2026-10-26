import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { discardFile, readableFile } from '@/lib/talk-extras';
import { fileBlockResponse } from '@/lib/upload-serve';
import { deleteUploads } from '@/lib/uploads';
import type { DocsBlock } from '@/lib/docs-types';

type Ctx = { params: Promise<{ id: string }> };

/** Sirve el archivo si su canal es legible (?download=1 lo baja). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(async ({ actor }) => {
    const file = await readableFile(actor, id);
    if (!file) return jsonError(404, 'not_found');
    const block = { id, type: 'file', content: '', url: file.url, name: file.name, mime: file.mime } as unknown as DocsBlock & { url: string };
    const res = await fileBlockResponse(block, { download: req.nextUrl.searchParams.get('download') === '1', range: req.headers.get('range') });
    return res ?? jsonError(404, 'not_found');
  });
}

/** Descarta un archivo subido que todavía no se mandó. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withTalk(
    async ({ actor }) => {
      const url = await discardFile(actor, id);
      if (!url) return jsonError(404, 'not_found');
      await deleteUploads([url]);
      return NextResponse.json({ ok: true });
    },
    { write: 'upload', limit: 120 },
  );
}
