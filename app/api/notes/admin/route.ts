import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { adminDisableLink, adminTransferNotes, notesAdminOverview } from '@/lib/notes-admin';
import { roleAtLeast } from '@/lib/teams';
import { noteOcrEnabled, setNoteOcrEnabled } from '@/lib/notes-file-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Consola de admin de Notes: solo owner y admin del workspace. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!roleAtLeast(user.role, 'admin')) return jsonError(403, 'forbidden');
  return NextResponse.json({ ...(await notesAdminOverview(user.id)), ocr: await noteOcrEnabled(user.id) });
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disable_link'), note_id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('transfer'), from: z.string().min(1).max(128), to: z.string().min(1).max(128) }),
  z.object({ action: z.literal('ocr'), enabled: z.boolean() }),
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!roleAtLeast(user.role, 'admin')) return jsonError(403, 'forbidden');
  const limited = await limitWrites('notes:admin', noteOwner(user).personId, 30);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const actor = noteOwner(user).personId;
  if (parsed.data.action === 'disable_link') {
    if (!(await adminDisableLink(user.id, actor, parsed.data.note_id))) return jsonError(404, 'not_found');
  } else if (parsed.data.action === 'ocr') {
    await setNoteOcrEnabled(user.id, parsed.data.enabled);
  } else {
    const moved = await adminTransferNotes(user.id, actor, parsed.data.from, parsed.data.to);
    if (typeof moved === 'string') return jsonError(400, moved);
  }
  return NextResponse.json({ ...(await notesAdminOverview(user.id)), ocr: await noteOcrEnabled(user.id) });
}
