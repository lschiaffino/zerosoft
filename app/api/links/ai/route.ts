import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { AiError } from '@/lib/ai';
import { askLinksAnalytics } from '@/lib/link-ai';
import { parseTimezone, parseWorkspaceFilters, parseWorkspaceRange } from '@/lib/link-analytics';
import { viewerOf } from '@/lib/link-folders';
import { limitByIp } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Pregunta a la IA sobre las analytics del rango y filtros de la página. */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'links-ai', 20, 60);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const params = Object.fromEntries(
    Object.entries(body ?? {}).filter(([, v]) => typeof v === 'string'),
  ) as Record<string, string>;
  const locale =
    typeof body?.locale === 'string' && ['en', 'es', 'pt'].includes(body.locale)
      ? body.locale
      : requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  try {
    const answer = await askLinksAnalytics({
      ws: user.id,
      question,
      locale,
      range: parseWorkspaceRange(params.from, params.to),
      opts: { filters: parseWorkspaceFilters(params), timezone: parseTimezone(params.tz), viewer: viewerOf(user) },
    });
    return NextResponse.json({ answer });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'ai_disabled' ? 503 : 429 });
    }
    // eslint-disable-next-line no-console
    console.error('[link-ai] failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
  }
}
