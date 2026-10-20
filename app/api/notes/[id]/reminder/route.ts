import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { ReminderError, clearNoteReminder, setNoteReminder } from '@/lib/notes-reminders';
import { noteReminderSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Pone o mueve el recordatorio (avisa in-app y por email a la hora indicada). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = noteReminderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  try {
    const reminder = await setNoteReminder(owner, id, parsed.data);
    return NextResponse.json({ reminder });
  } catch (err) {
    if (err instanceof ReminderError) {
      if (err.code === 'note_not_found') return jsonError(404, 'not_found');
      return jsonError(err.code === 'note_trashed' ? 409 : 400, err.code);
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  await clearNoteReminder(noteOwner(user), id);
  return NextResponse.json({ reminder: null });
}
