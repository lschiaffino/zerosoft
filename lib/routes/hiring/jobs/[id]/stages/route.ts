import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setStages, stagesSchema } from '@/lib/hiring/core';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT { stages: [{ id?, name, kind, criteria }] }: etapas del pipeline y los criterios de sus scorecards. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { stages } = await parseBody(req, z.object({ stages: stagesSchema }));
    return hJson({ stages: await setStages(a.actor, (await params).id, stages) });
  } catch (err) {
    return hFail(err);
  }
}
