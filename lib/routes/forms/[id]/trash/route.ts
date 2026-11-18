import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listFormTrash, restoreFormTrash } from '@/lib/forms/trash';
import { fFail, fJson, formsActor, parseBody } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: lo que la retención mandó a la papelera de este form (fecha y plazo, sin contenido). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    return fJson({ items: await listFormTrash(a.actor, (await params).id) });
  } catch (err) {
    return fFail(err);
  }
}

const Restore = z.object({ entryId: z.string().min(1).max(80) });

/** POST { entryId }: restaura una respuesta de la papelera. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const { entryId } = await parseBody(req, Restore);
    return fJson({ item: await restoreFormTrash(a.actor, (await params).id, entryId) });
  } catch (err) {
    return fFail(err);
  }
}
