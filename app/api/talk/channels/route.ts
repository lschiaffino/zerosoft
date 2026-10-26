import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { browseChannels, createChannel } from '@/lib/talk';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['public', 'private']).default('public'),
  topic: z.string().max(250).optional(),
  description: z.string().max(1000).optional(),
  memberIds: z.array(z.string().max(64)).max(200).optional(),
});

/** Directorio de canales (públicos y los privados donde estoy). ?q= busca, ?archived=1 los archivados. */
export async function GET(req: NextRequest) {
  return withTalk(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    return NextResponse.json({ channels: await browseChannels(actor, { q: sp.get('q')?.slice(0, 100) ?? '', archived: sp.get('archived') === '1' }) });
  });
}

export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, createSchema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createChannel(actor, body), { status: 201 });
    },
    { write: 'channels', limit: 60 },
  );
}
