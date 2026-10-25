import { NextRequest, NextResponse } from 'next/server';
import { planningContext } from '@/lib/track-planning-http';
import { scopeWhere } from '@/lib/track-plans';
import { listWorkspaceCycles } from '@/lib/track-cycle-metrics';
import { unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cycles de todos los proyectos del workspace con su avance. */
export async function GET(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const today = req.nextUrl.searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
  const s = scopeWhere(ctx.scope, 'p');
  return NextResponse.json({ rows: await listWorkspaceCycles(s.where, s.arg, /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10)) });
}
