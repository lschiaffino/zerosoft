import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { createCommand, deleteCommand, listCommands } from '@/lib/talk-commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json({ commands: await listCommands(actor) }));
}

const schema = z.object({ command: z.string().max(40), url: z.string().max(1000), description: z.string().max(200).optional(), usageHint: z.string().max(100).optional() });

/** Registrar un slash command (admins). El secreto de firma se devuelve una sola vez. */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createCommand(actor, body), { status: 201 });
    },
    { write: 'commands', limit: 30 },
  );
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  return withTalk(
    async ({ actor }) => NextResponse.json({ ok: await deleteCommand(actor, id) }),
    { write: 'commands', limit: 30 },
  );
}
