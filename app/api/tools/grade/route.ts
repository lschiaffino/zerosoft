import { NextResponse } from 'next/server';
import { limitByIp, rateLimit } from '@/lib/rate-limit';
import { GradeError, gradeWebsite } from '@/lib/tools/website-grader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

/** Tope de análisis por sitio destino (todas las IPs): evita usar el grader para martillar un host. */
const PER_HOST_LIMIT = 60;

function targetHost(raw: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Website grader público. Body: { url }. 20 análisis por hora por IP y 60 por
 * hora por sitio destino. Las salidas pasan por safeFetch (SSRF: solo hosts
 * públicos, cada redirect revalidado).
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'tools-grade', 20, 3600);
  if (limited) return limited;
  let url = '';
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === 'string' ? body.url.trim() : '';
  } catch {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  }
  if (!url || url.length > 2048) return NextResponse.json({ error: 'invalid_url' }, { status: 400 });

  const host = targetHost(url);
  if (host && process.env.RATE_LIMIT_DISABLED !== 'true') {
    const perHost = await rateLimit(`tools-grade-host:${host}`, PER_HOST_LIMIT, 3600);
    if (!perHost.ok) {
      return NextResponse.json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil((perHost.resetAt - Date.now()) / 1000))) } },
      );
    }
  }

  try {
    const result = await gradeWebsite(url);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const code = err instanceof GradeError ? err.code : 'unreachable';
    const status = code === 'invalid_url' || code === 'private_host' || code === 'https_required' ? 400 : 422;
    return NextResponse.json({ error: code }, { status });
  }
}
