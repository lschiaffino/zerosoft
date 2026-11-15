import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, limit, parseBody, withFleet } from '@/lib/fleet/api';
import { syncNow } from '@/lib/fleet/core';
import { loadBoard } from '@/lib/fleet/board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({ id: z.string().max(100).optional() })
  .nullable()
  .transform((v) => v ?? {});

/** POST: "Actualizar". Sincroniza ya las cuentas (o una) y devuelve el tablero. */
export async function POST(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`sync:${actor.person}`, 6, 60);
    if (limited) return limited;
    const { id } = await parseBody(req, schema);
    const result = await syncNow(actor, id);
    return fJson({ ...result, board: await loadBoard(actor) });
  });
}
