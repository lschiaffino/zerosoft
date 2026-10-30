import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getBrandKit, saveBrandKit } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Kit de marca del workspace (lo usa todo el que tiene Design). */
export async function GET() {
  const s = await designActor();
  if ('res' in s) return s.res;
  return designJson({ brand: await getBrandKit(s.actor.ws), canEdit: s.actor.admin });
}

const font = z.string().max(40).nullable().optional();
const putSchema = z.object({
  colors: z.array(z.string().max(16)).max(48),
  fonts: z.object({ heading: font, subheading: font, body: font }),
  logos: z.array(z.string().max(80)).max(24),
});

/** Solo owner y admins. */
export async function PUT(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    return designJson({ brand: await saveBrandKit(s.actor, parsed.data) });
  } catch (err) {
    return designFail(err);
  }
}
