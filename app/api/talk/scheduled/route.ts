import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listScheduled, scheduleMessage } from '@/lib/talk-extras';

const schema = z.object({
  channelId: z.string().min(1).max(64),
  parentId: z.string().max(64).nullable().optional(),
  body: z.string().max(12_000),
  sendAt: z.string().min(10).max(40),
  fileIds: z.array(z.string().max(64)).max(10).optional(),
});

export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json({ scheduled: await listScheduled(actor) }));
}

export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await scheduleMessage(actor, body), { status: 201 });
    },
    { write: 'scheduled', limit: 60 },
  );
}
