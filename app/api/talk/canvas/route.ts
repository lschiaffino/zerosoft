import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { deleteCanvas, getCanvas, saveCanvas } from '@/lib/talk-canvas';
import type { DocsBlock } from '@/lib/docs-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El canvas del canal (?channelId=). */
export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') ?? '';
  return withTalk(async ({ actor }) => NextResponse.json({ canvas: await getCanvas(actor, channelId) }));
}

const schema = z.object({
  channelId: z.string().max(64),
  title: z.string().max(200).optional(),
  content: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
  baseRev: z.number().int().min(0),
});

/** Crea o guarda el canvas (compare-and-set por baseRev). */
export async function PUT(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      const canvas = await saveCanvas(actor, body.channelId, { title: body.title, content: body.content as unknown as DocsBlock[] | undefined, baseRev: body.baseRev });
      return NextResponse.json({ canvas });
    },
    { write: 'canvas', limit: 300 },
  );
}

export async function DELETE(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') ?? '';
  return withTalk(
    async ({ actor }) => NextResponse.json({ ok: await deleteCanvas(actor, channelId) }),
    { write: 'canvas', limit: 60 },
  );
}
