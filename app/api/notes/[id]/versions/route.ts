import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteEditable, noteOwner } from '@/lib/notes';
import { listNoteVersions, saveNoteVersion } from '@/lib/notes-versions';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  if ((await noteEditable(owner, id)) === 'not_found') return jsonError(404, 'not_found');
  return NextResponse.json({ rows: await listNoteVersions(owner, id) });
}

/** "Guardar versión": snapshot manual del estado actual. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const state = await noteEditable(owner, id);
  if (state === 'not_found') return jsonError(404, 'not_found');
  if (state === 'trashed') return jsonError(409, 'note_trashed');
  const versionId = await saveNoteVersion(owner, id);
  if (!versionId) return jsonError(404, 'not_found');
  return NextResponse.json({ id: versionId }, { status: 201 });
}
