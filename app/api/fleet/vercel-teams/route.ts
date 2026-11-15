import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, limit, parseBody, withFleet } from '@/lib/fleet/api';
import { vercelWhoAmI } from '@/lib/fleet/vercel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { token }: valida un token de Vercel y devuelve su usuario y equipos, para elegir cuál mirar. No guarda nada. */
export async function POST(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`vteams:${actor.person}`, 20, 600);
    if (limited) return limited;
    const { token } = await parseBody(req, z.object({ token: z.string().trim().min(1).max(400) }));
    return fJson(await vercelWhoAmI(token));
  });
}
