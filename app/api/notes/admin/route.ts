import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { adminDisableLink, adminTransferNotes, notesAdminOverview } from '@/lib/notes-admin';
import { roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Consola de admin de Notes: solo owner y admin del workspace. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!roleAtLeast(user.role, 'admin')) return jsonError(403, 'forbidden');
  return NextResponse.json(await notesAdminOverview(user.id));
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disable_link'), note_id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('transfer'), from: z.string().min(1).max(128), to: z.string().min(1).max(128) }),
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!roleAtLeast(user.role, 'admin')) return jsonError(403, 'forbidden');
  const limited = await limitWrites('notes:admin', noteOwner(user).personId, 30);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  if (parsed.data.action === 'disable_link') {
    if (!(await adminDisableLink(user.id, parsed.data.note_id))) return jsonError(404, 'not_found');
  } else {
    const moved = await adminTransferNotes(user.id, parsed.data.from, parsed.data.to);
    if (moved === 'not_member') return jsonError(400, 'not_member');
  }
  return NextResponse.json(await notesAdminOverview(user.id));
}
