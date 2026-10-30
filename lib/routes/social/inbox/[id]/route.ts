import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { assignInbox, replyInbox, setInboxStatus } from '@/lib/social-inbox';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  assignedTo: z.string().max(64).nullable().optional(),
});

/** Marcar hecho / reabrir y asignar a alguien con Social. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, patchSchema);
      if (!body || (body.status === undefined && body.assignedTo === undefined)) return jsonError(400, 'invalid_input');
      let item = body.assignedTo !== undefined ? await assignInbox(actor, id, body.assignedTo) : null;
      if (body.status) item = await setInboxStatus(actor, id, body.status);
      return NextResponse.json(item);
    },
    { write: 'inbox', limit: 240 },
  );
}

const replySchema = z.object({ text: z.string().trim().min(1).max(8000) });

/** Contestar en la red. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, replySchema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await replyInbox(actor, id, body.text));
    },
    { write: 'reply', limit: 60 },
  );
}
