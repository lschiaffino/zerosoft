import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { GradeError, gradeWebsite } from '@/lib/tools/website-grader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

/** Website grader público. Body: { url }. 20 análisis por hora por IP. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'tools-grade', 20, 3600);
  if (limited) return limited;
  let url = '';
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === 'string' ? body.url : '';
  } catch {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
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
