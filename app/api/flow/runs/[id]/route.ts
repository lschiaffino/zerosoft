import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRunWithSteps } from '@/lib/flow';
import { notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Una corrida con sus pasos (input/output/error por nodo). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const run = await getRunWithSteps(user.id, id);
  if (!run) return notFound();
  return NextResponse.json({ run });
}
