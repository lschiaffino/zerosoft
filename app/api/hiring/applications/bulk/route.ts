import { NextRequest } from 'next/server';
import { bulkApplications, bulkSchema } from '@/lib/hiring/candidates';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { ids, action: move|reject|tag, … }: acción en lote (cada postulación con su chequeo de acceso). */
export async function POST(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await bulkApplications(a.actor, await parseBody(req, bulkSchema)));
  } catch (err) {
    return hFail(err);
  }
}
