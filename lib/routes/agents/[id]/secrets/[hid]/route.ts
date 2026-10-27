import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { removeSecretHeader } from '@/lib/agents';
import { canEditAgents, forbidden, notFound, unauthorized } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; hid: string }> };

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, hid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditAgents(user)) return forbidden();
  const res = await removeSecretHeader(user.id, id, hid);
  if (!res.ok) return notFound();
  return NextResponse.json({ headers: res.headers });
}
