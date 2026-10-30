import { NextRequest } from 'next/server';
import { z } from 'zod';
import { forgetByToken } from '@/lib/hiring/candidates';
import { hiringLimit, hJson, readJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { token }: el candidato borra sus datos con el link del email de acuse. */
export async function POST(req: NextRequest) {
  const limited = await hiringLimit(req, 'forget', 10, 600);
  if (limited) return limited;
  const parsed = z.object({ token: z.string().min(20).max(80) }).safeParse(await readJson(req));
  if (!parsed.success) return hJson({ error: 'invalid_input' }, 400);
  const ok = await forgetByToken(parsed.data.token);
  return ok ? hJson({ ok: true }) : hJson({ error: 'not_found' }, 404);
}
