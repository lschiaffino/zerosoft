import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { connectBluesky } from '@/lib/social';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ identifier: z.string().trim().min(3).max(253), password: z.string().min(4).max(100) });

/** Admins: conecta Bluesky con handle y contraseña de app. La contraseña no se guarda: solo la sesión, cifrada. */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json({ accounts: await connectBluesky(actor, body.identifier, body.password) }, { status: 201 });
    },
    { write: 'connect', limit: 10 },
  );
}
