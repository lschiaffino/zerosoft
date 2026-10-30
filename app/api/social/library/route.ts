import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { createLibraryItem, listLibrary, type LibraryKind } from '@/lib/social';
import { mediaSchema } from '@/lib/social-schemas';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['snippet', 'hashtags', 'asset'];

/** Biblioteca del workspace: textos guardados, grupos de hashtags y archivos. ?kind=, ?q=. */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const kind = sp.get('kind');
    return NextResponse.json({ items: await listLibrary(actor, kind && KINDS.includes(kind) ? (kind as LibraryKind) : undefined, sp.get('q')?.slice(0, 200)) });
  });
}

const schema = z.object({
  kind: z.enum(['snippet', 'hashtags', 'asset']),
  name: z.string().trim().min(1).max(120),
  body: z.string().max(10_000).optional(),
  media: z.array(mediaSchema).max(20).optional(),
});

export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createLibraryItem(actor, body), { status: 201 });
    },
    { write: 'library', limit: 120 },
  );
}
