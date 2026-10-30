import { NextRequest } from 'next/server';
import { actOnOffer, offerActionSchema } from '@/lib/hiring/offers';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { action: approve | send | withdraw }: aprobar (hiring manager o admin), enviar (aprobada) o retirar. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await actOnOffer(a.actor, (await params).id, await parseBody(req, offerActionSchema)));
  } catch (err) {
    return hFail(err);
  }
}
