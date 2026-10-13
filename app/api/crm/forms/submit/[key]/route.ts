import { NextRequest, NextResponse } from 'next/server';
import { submitForm } from '@/lib/crm-forms';
import { formSubmitSchema } from '@/lib/crm-forms-schema';
import { clientIp, limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Envío público de un form (página /f/<key>, embed o un POST propio).
 * Sin cookies. Rate limit por IP: 5 envíos por minuto por form y 30 por hora
 * en total, además del honeypot y el tiempo mínimo que aplica lib/crm-forms.
 */
export async function POST(req: NextRequest, props: Ctx) {
  const { key } = await props.params;
  const perForm = await limitByIp(req, 'form-submit', 5, 60, key);
  if (perForm) return perForm;
  const perIp = await limitByIp(req, 'form-submit-all', 30, 3600);
  if (perIp) return perIp;

  const body: unknown = await req.json().catch(() => null);
  const parsed = formSubmitSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_input' }, 400);

  const result = await submitForm(key, parsed.data, {
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent') ?? '',
  });
  if (!result.ok) {
    if (result.error === 'not_found') return json({ error: 'not_found' }, 404);
    if (result.error === 'paused') return json({ error: 'paused' }, 409);
    return json({ error: 'invalid', fieldErrors: result.fieldErrors ?? {} }, 400);
  }
  return json({
    ok: true,
    successMode: result.successMode,
    successMessage: result.successMessage,
    redirectUrl: result.redirectUrl,
  });
}
