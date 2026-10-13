import { NextResponse } from 'next/server';
import { clientIp, limitByIp } from '@/lib/rate-limit';
import { voteRoadmapItem } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

/** Upvote público: un voto por IP (hasheada) por ítem, con rate limit por IP. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const limited = await limitByIp(req, 'roadmap-vote', 30, 600);
  if (limited) return limited;
  const res = await voteRoadmapItem(id, clientIp(req));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ votes: res.votes, counted: res.counted });
}
