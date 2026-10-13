import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getFlowRow, listRuns } from '@/lib/flow';
import { notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getFlowRow(user.id, id))) return notFound();
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '30') || 30;
  return NextResponse.json({ runs: await listRuns(user.id, id, limit) });
}
