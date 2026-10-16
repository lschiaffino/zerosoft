import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import type { FeedbackRow } from '@/lib/feedback';
import { getBoardPerson } from '@/lib/board-session';
import { attachFeedbackToItem, createRoadmapItem, roadmapCreateSchema } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

const promoteSchema = z.union([
  z.object({ itemId: z.string().min(1).max(80) }),
  z.object({ create: roadmapCreateSchema }),
]);

/**
 * "Promover a ítem": adjunta el feedback a un ítem existente o crea uno nuevo
 * con él como primera señal. Marca el feedback como leído. Solo ADMIN_EMAILS.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = promoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const db = getDb();
  const feedback = (await db.prepare('SELECT * FROM feedback WHERE id = ?').get(id)) as FeedbackRow | undefined;
  if (!feedback) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const targetId =
    'itemId' in parsed.data ? parsed.data.itemId : (await createRoadmapItem(parsed.data.create, person.id)).id;
  const item = await attachFeedbackToItem(feedback, targetId);
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (feedback.status === 'new') await db.prepare("UPDATE feedback SET status = 'read' WHERE id = ?").run(id);
  return NextResponse.json({ item });
}
