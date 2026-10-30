import { NextRequest } from 'next/server';
import { requireVisibleApp } from '@/lib/hiring/candidates';
import { createOffer, listOffers, offerSchema } from '@/lib/hiring/offers';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: ofertas de la postulación (solo quien gestiona el puesto). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { app, access } = await requireVisibleApp(a.actor, (await params).id);
    if (!access.manage) return hJson({ offers: [] });
    return hJson({ offers: await listOffers(app.id) });
  } catch (err) {
    return hFail(err);
  }
}

/** POST: oferta nueva (pendiente de aprobación) desde la plantilla de carta. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson({ offer: await createOffer(a.actor, (await params).id, await parseBody(req, offerSchema)) }, 201);
  } catch (err) {
    return hFail(err);
  }
}
