import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { createReminder, deleteReminder } from '@/lib/talk-extras';

const schema = z.object({ messageId: z.string().max(64).nullable().optional(), text: z.string().max(500).optional(), remindAt: z.string().min(10).max(40) });

export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createReminder(actor, body), { status: 201 });
    },
    { write: 'reminders', limit: 60 },
  );
}

export async function DELETE(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      if (!(await deleteReminder(actor, req.nextUrl.searchParams.get('id') ?? ''))) return jsonError(404, 'not_found');
      return NextResponse.json({ ok: true });
    },
    { write: 'reminders', limit: 60 },
  );
}
