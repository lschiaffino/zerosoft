import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { unfurlLink } from '@/lib/docs-unfurl';
import { embedFor } from '@/lib/docs-embeds';
import { rateLimit } from '@/lib/rate-limit';
import { docsError, invalidBody, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ url: z.string().min(1).max(2048) });

/**
 * Vista previa de un link para un bookmark (título, descripción, imagen,
 * ícono), leída en el servidor con safeFetch. También dice si el link se
 * puede embeber (lib/docs-embeds.ts).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await rateLimit(`docs-unfurl:${user.id}`, 60, 60)).ok) return docsError(429, 'rate_limited');
  const preview = await unfurlLink(parsed.data.url);
  if (!preview) return docsError(400, 'invalid_url');
  const embed = embedFor(preview.url);
  return NextResponse.json({ preview, embeddable: Boolean(embed), provider: embed?.label ?? null });
}
