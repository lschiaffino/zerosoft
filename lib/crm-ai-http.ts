/**
 * Respuestas de error de las rutas de IA del CRM: AiError (ai_disabled,
 * quota_exceeded, rate_limited), CrmAiError y AiRunError con su código, y
 * ai_failed para cualquier otra falla del modelo. Server-only.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AiError } from './ai';
import { CrmAiError } from './crm-ai';
import { AiRunError } from './crm-ai-agents';
import { requestLocale } from './request-locale';

export function aiErrorResponse(err: unknown): NextResponse {
  if (err instanceof AiError) {
    return NextResponse.json({ error: err.code }, { status: err.code === 'ai_disabled' ? 503 : 429 });
  }
  if (err instanceof CrmAiError || err instanceof AiRunError) {
    // sendItem pasa el código del envío (unsubscribed, send_failed…) en message.
    const code = err.message && err.message !== err.code ? err.message : err.code;
    return NextResponse.json({ error: code }, { status: err.status });
  }
  console.error('[crm-ai] failed', err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
}

/** Idioma de la respuesta de la IA: el que manda la UI o el del request. */
export function aiLocale(req: NextRequest, explicit?: string | null): string {
  if (explicit && ['en', 'es', 'pt'].includes(explicit)) return explicit;
  return requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
}
