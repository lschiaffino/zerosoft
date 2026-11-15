import { NextRequest } from 'next/server';
import { fJson, limit, withFleet } from '@/lib/fleet/api';
import { connectionOptions } from '@/lib/fleet/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: repos que ve el token de GitHub, o proyectos del equipo de Vercel, para elegir cuáles mirar. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`options:${actor.person}`, 30, 600);
    if (limited) return limited;
    const { id } = await ctx.params;
    return fJson({ options: await connectionOptions(actor, id) });
  });
}
