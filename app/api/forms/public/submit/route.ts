import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/rate-limit';
import { submitResponse } from '@/lib/forms/responses';
import { FormsError } from '@/lib/forms/types';
import { formsLimit, PUBLIC_CORS } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PUBLIC_CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS });
}

const bodySchema = z.object({
  slug: z.string().max(62),
  answers: z.record(z.unknown()),
  hidden: z.record(z.string().max(300)).optional(),
  lang: z.string().max(5).optional(),
  consent: z.boolean().optional(),
  website_url: z.string().max(500).optional(),
  renderToken: z.string().max(80).optional(),
  resumeToken: z.string().max(64).optional(),
  visitId: z.string().max(40).optional(),
});

/**
 * Envío público de /f/<slug> (o del embed). Sin cookies. Rate limit por IP
 * (10 por minuto por form y 60 por hora en total) además del honeypot, el
 * tiempo mínimo desde el render (marca firmada; too_fast con 425 y lo que
 * falta esperar) y el límite por IP que el form tenga configurado.
 */
export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid_input' }, 400);
  const perForm = await formsLimit(req, 'submit', 10, 60, parsed.data.slug);
  if (perForm) return perForm;
  const perIp = await formsLimit(req, 'submit-all', 60, 3600);
  if (perIp) return perIp;
  try {
    const res = await submitResponse(parsed.data.slug, parsed.data, { ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? '' });
    if (!res.ok && res.error === 'too_fast') return json({ error: 'too_fast', waitMs: res.waitMs, renderToken: res.renderToken }, 425);
    if (!res.ok) {
      const status = res.error === 'not_found' ? 404 : res.error === 'closed' ? 409 : res.error === 'ip_limit' ? 429 : 400;
      return json({ error: res.error, reason: res.reason, errors: res.errors ?? {} }, status);
    }
    return json({ ok: true, endingId: res.endingId, vars: res.vars });
  } catch (err) {
    if (err instanceof FormsError) return json({ error: err.code }, err.status);
    throw err;
  }
}
