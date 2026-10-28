import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { saveBasicProfile } from '@/lib/onboarding';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().max(80).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timeZone: z.string().max(64).optional(),
});

/** PATCH: nombre, idioma y zona de la persona (Ajustes › Perfil). El nombre editado no lo pisa el de Google. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limit = await rateLimit(`profile:${realUserId(user)}`, 30, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await saveBasicProfile(realUserId(user), { ...parsed.data, finish: false });
  return NextResponse.json({ ok: true });
}
