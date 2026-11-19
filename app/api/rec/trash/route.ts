import { NextRequest } from 'next/server';
import { z } from 'zod';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { listRecTrash, restoreRecTrash } from '@/lib/rec-trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: videos que la retención mandó a la papelera (título y fechas). Los propios, o todos para un admin. */
export async function GET() {
  const s = await recActor();
  if ('res' in s) return s.res;
  return recJson({ items: await listRecTrash(s.actor) });
}

const Restore = z.object({ entryId: z.string().min(1).max(80) });

/** POST { entryId }: restaura un video de la papelera. */
export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = Restore.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    return recJson({ item: await restoreRecTrash(s.actor, parsed.data.entryId) });
  } catch (err) {
    return recFail(err);
  }
}
