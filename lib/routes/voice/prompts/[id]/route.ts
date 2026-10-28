import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { deletePrompt, updatePrompt } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  shared: z.boolean().optional(),
});

/** Solo quien lo creó lo edita (los compartidos por otra persona dan 404). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const prompt = await updatePrompt(auth.owner, id, parsed.data);
  if (!prompt) return voiceJsonError(404, 'not_found');
  return NextResponse.json(prompt);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  if (!(await deletePrompt(auth.owner, id))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}
