import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { deleteFolder, renameFolder } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ name: z.string().trim().min(1).max(100) });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  if (!(await renameFolder(auth.owner, id, parsed.data.name))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true, name: parsed.data.name });
}

/** Borra la carpeta y sus subcarpetas; las reuniones quedan sin carpeta. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  if (!(await deleteFolder(auth.owner, id))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}
