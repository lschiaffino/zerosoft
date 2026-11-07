import type { NextRequest } from 'next/server';
import { hFail, hiringActor, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';
import { importCandidates, importSchema } from '@/lib/hiring/transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { csv, dryRun }: candidatos de un CSV (name, email; phone, location, headline, source, tags). No les manda nada. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const limited = await hiringLimit(req, 'import', 30, 3600, a.actor.person);
  if (limited) return limited;
  try {
    return hJson(await importCandidates(a.actor, (await params).id, await parseBody(req, importSchema)));
  } catch (err) {
    return hFail(err);
  }
}
