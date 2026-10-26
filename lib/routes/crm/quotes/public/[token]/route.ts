import { NextRequest, NextResponse } from 'next/server';
import { acceptQuote, declineQuote } from '@/lib/crm-products';
import { quoteRespondSchema } from '@/lib/crm-schema';
import { clientIp, limitByIp } from '@/lib/rate-limit';
import { crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { not_found: 404, expired: 410, not_open: 409, invalid_signature: 400 };

/** Respuesta pública del cliente a un quote (/q/<token>): aceptar o rechazar. Sin login. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:quote', 20, 600);
  if (limited) return limited;
  const body: unknown = await req.json().catch(() => null);
  const parsed = quoteRespondSchema.safeParse(body);
  if (!parsed.success) {
    // Nombre vacío o checkbox sin marcar = firma inválida.
    const action = (body as { action?: unknown } | null)?.action;
    return crmError(400, action === 'accept' ? 'invalid_signature' : 'invalid_input');
  }
  const ip = clientIp(req);
  const result =
    parsed.data.action === 'accept'
      ? await acceptQuote(token, {
          name: parsed.data.name,
          agree: parsed.data.agree,
          ip,
          email: parsed.data.email || undefined,
          signature: parsed.data.signature,
          userAgent: req.headers.get('user-agent') ?? '',
        })
      : await declineQuote(token, { reason: parsed.data.reason, ip });
  if (!result.ok) return crmError(STATUS[result.error] ?? 400, result.error);
  return NextResponse.json(result.quote);
}
