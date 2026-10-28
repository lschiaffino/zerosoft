import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getFlowRow, listFlowVersions } from '@/lib/flow';
import { notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Historial de versiones del flow (una por guardado con cambios en el grafo). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getFlowRow(user.id, id))) return notFound();
  return NextResponse.json({ versions: await listFlowVersions(user.id, id) });
}
