import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { listTasks, setTaskChecked, setTaskMeta } from '@/lib/notes-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tareas de la persona: las de sus notas y las que le asignaron. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ tasks: await listTasks(noteOwner(user)) });
}

const patchSchema = z.object({
  note_id: z.string().min(1).max(64),
  block_id: z.string().min(1).max(64),
  checked: z.boolean().optional(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, 'invalid_date')
    .nullable()
    .optional(),
  assignee_id: z.string().min(1).max(128).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { note_id, block_id, checked, due, assignee_id } = parsed.data;
  const STATUS = { not_found: 404, forbidden: 403, not_member: 400, locked: 423, not_saved: 409 } as const;
  let out: Record<string, unknown> = {};
  if (due !== undefined || assignee_id !== undefined) {
    const res = await setTaskMeta(owner, note_id, block_id, { due, assignee_id });
    if (typeof res === 'string') return jsonError(STATUS[res], res);
    out = { ...res };
  }
  if (checked !== undefined) {
    const res = await setTaskChecked(owner, note_id, block_id, checked);
    if (typeof res === 'string') return jsonError(STATUS[res], res);
    out = { ...out, ...res };
  }
  return NextResponse.json(out);
}
