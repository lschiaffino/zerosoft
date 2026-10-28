import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { deleteDictionaryEntry } from '@/lib/voice';
import { isWorkspaceAdmin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  // Las del equipo las borra un admin.
  if (!(await deleteDictionaryEntry(auth.owner, id, { admin: isWorkspaceAdmin(auth.user) }))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}
