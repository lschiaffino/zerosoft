import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getConversationDetail } from '@/lib/agents';
import { notFound, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Una conversación con sus mensajes, feedback y llamadas a herramientas. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getConversationDetail(user.id, id, cid);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}
