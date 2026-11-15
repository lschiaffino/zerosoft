import { NextRequest } from 'next/server';
import { z } from 'zod';
import { baseUrlOf, fJson, limit, parseBody, withFleet } from '@/lib/fleet/api';
import { createToken, listTokens } from '@/lib/fleet/sessions';
import { installCommand } from '@/lib/fleet/hook-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: tokens de ingesta del hook (solo los últimos 4 caracteres). */
export async function GET() {
  return withFleet(async ({ actor }) => fJson({ tokens: await listTokens(actor) }));
}

/** POST { label }: crea un token. El token y el comando de instalación se devuelven solo esta vez. */
export async function POST(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const limited = await limit(`token:${actor.person}`, 10, 3600);
    if (limited) return limited;
    const { label } = await parseBody(req, z.object({ label: z.string().max(200).default('') }));
    const { token, item } = await createToken(actor, label);
    return fJson({ token, item, command: installCommand(baseUrlOf(req), token), tokens: await listTokens(actor) }, 201);
  });
}
