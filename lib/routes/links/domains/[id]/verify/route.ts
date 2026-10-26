import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';
import { verifyDomain } from '@/lib/link-domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await limitByIp(req, 'domain-verify', 20, 60);
  if (limited) return limited;
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await verifyDomain(user.id, id);
  if (res.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(res);
}
