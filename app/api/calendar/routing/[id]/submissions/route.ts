import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listRoutingSubmissions } from '@/lib/calendar-routing';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?limit= — envíos del routing form (respuestas y destino), el más nuevo primero. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 100);
  const rows = await listRoutingSubmissions(user.id, params.id, Number.isFinite(limit) ? limit : 100);
  if (!rows) return notFound();
  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      answers: r.answersParsed,
      outcome: r.outcome,
      target: r.target,
      ruleId: r.rule_id,
    })),
  });
}
