import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listHiringTrash, restoreHiringTrash } from '@/lib/hiring/trash';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: candidatos que la retención mandó a la papelera (nombre y fechas). Solo admins. */
export async function GET() {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson({ items: await listHiringTrash(a.actor) });
  } catch (err) {
    return hFail(err);
  }
}

const Restore = z.object({ entryId: z.string().min(1).max(80) });

/** POST { entryId }: restaura un candidato de la papelera. Solo admins. */
export async function POST(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { entryId } = await parseBody(req, Restore);
    return hJson({ item: await restoreHiringTrash(a.actor, entryId) });
  } catch (err) {
    return hFail(err);
  }
}
