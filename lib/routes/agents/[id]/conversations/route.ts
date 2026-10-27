import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getAgentRow, listConversations } from '@/lib/agents';
import { notFound, unauthorized } from '@/lib/agents-http';
import type { AgentChannel } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS: AgentChannel[] = ['playground', 'public', 'api', 'chat'];

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await getAgentRow(user.id, id))) return notFound();
  const raw = req.nextUrl.searchParams.get('channel');
  const channel = CHANNELS.includes(raw as AgentChannel) ? (raw as AgentChannel) : undefined;
  const needsReview = req.nextUrl.searchParams.get('review') === '1';
  return NextResponse.json({ conversations: await listConversations(user.id, id, { channel, limit: 100, needsReview }) });
}
