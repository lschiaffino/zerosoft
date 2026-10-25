import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { deleteCustomTemplate, updateCustomTemplate } from '@/lib/voice';
import { voiceTemplateSchema as templateSchema } from '@/lib/voice-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = templateSchema.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const t = await updateCustomTemplate(auth.owner, id, parsed.data);
  if (!t) return voiceJsonError(404, 'not_found');
  return NextResponse.json(t);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  if (!(await deleteCustomTemplate(auth.owner, id))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}
