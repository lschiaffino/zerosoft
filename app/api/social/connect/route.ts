import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { startOAuth } from '@/lib/social';
import { SOCIAL_NETWORKS } from '@/lib/social-networks';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ network: z.enum(SOCIAL_NETWORKS) });

/** Admins: arranca el OAuth de una red (state + PKCE) y devuelve la URL a la que ir. */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json({ url: await startOAuth(actor, body.network) });
    },
    { write: 'connect', limit: 30 },
  );
}
