import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, limit, parseBody, withFleet } from '@/lib/fleet/api';
import { createConnection, listConnections, syncNow } from '@/lib/fleet/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: cuentas de GitHub y Vercel conectadas (sin tokens). */
export async function GET() {
  return withFleet(async ({ actor }) => fJson({ connections: await listConnections(actor) }));
}

const createSchema = z.object({
  kind: z.enum(['github', 'vercel']),
  token: z.string().min(1).max(400),
  label: z.string().max(200).optional(),
  teamId: z.string().max(100).optional(),
  repos: z.array(z.string().max(201)).max(50).optional(),
});

/** POST: conecta una cuenta. El token se valida contra la API y se guarda sellado; nunca vuelve. */
export async function POST(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`connect:${actor.person}`, 20, 3600);
    if (limited) return limited;
    const input = await parseBody(req, createSchema);
    const res = await createConnection(actor, input);
    // Primera sincronización enseguida: la cuenta nueva no aparece vacía.
    await syncNow(actor, res.connection.id).catch(() => null);
    return fJson({ ...res, connections: await listConnections(actor) }, 201);
  });
}
