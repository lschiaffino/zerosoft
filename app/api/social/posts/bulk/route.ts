import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBody, withSocial } from '@/lib/social-http';
import { createPostsBulk } from '@/lib/social';
import { BULK_CHUNK } from '@/lib/social-bulk';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  accountIds: z.array(z.string().max(64)).min(1).max(50),
  action: z.enum(['schedule', 'draft']),
  rows: z
    .array(
      z.object({
        text: z.string().max(70_000).default(''),
        linkUrl: z.string().max(2000).nullable().optional(),
        scheduledAt: z.string().max(40).nullable(),
      }),
    )
    .min(1)
    .max(BULK_CHUNK),
});

/**
 * Programación masiva desde un CSV: una tanda de hasta BULK_CHUNK filas para
 * las mismas cuentas. Se valida toda la tanda antes de crear nada.
 */
export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, schema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createPostsBulk(actor, body), { status: 201 });
    },
    // 350 filas en tandas de 25 = 14 pedidos por archivo.
    { write: 'posts-bulk', limit: 60 },
  );
}
