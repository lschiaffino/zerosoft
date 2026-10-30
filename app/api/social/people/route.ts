import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { isSocialAdmin, listSocialPeople, setSocialRole } from '@/lib/social';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admins: personas con Social, su rol (publica o necesita aprobación) y sus cuentas. */
export async function GET() {
  return withSocial(async ({ actor }) => {
    if (!isSocialAdmin(actor)) return jsonError(403, 'admin_only');
    return NextResponse.json({ people: await listSocialPeople(actor) });
  });
}

const schema = z.object({ personId: z.string().max(64), role: z.enum(['publisher', 'drafter']) });

export async function PATCH(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      await setSocialRole(actor, body.personId, body.role);
      return NextResponse.json({ people: await listSocialPeople(actor) });
    },
    { write: 'people', limit: 60 },
  );
}
