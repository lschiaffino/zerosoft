import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setTeam, teamSchema } from '@/lib/hiring/core';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT { members: [{ userId, role }] }: el equipo de contratación del puesto. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { members } = await parseBody(req, z.object({ members: teamSchema }));
    return hJson({ team: await setTeam(a.actor, (await params).id, members) });
  } catch (err) {
    return hFail(err);
  }
}
