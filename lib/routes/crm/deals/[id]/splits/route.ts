import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { getSplits, MAX_SPLITS, setSplits } from '@/lib/crm-splits';
import { listMembers } from '@/lib/teams';
import { crmError, guardRecord, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  splits: z
    .array(z.object({ ownerId: z.string().trim().min(1).max(100), percent: z.number().min(0).max(100) }))
    .max(MAX_SPLITS),
});

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const hidden = await guardRecord(user.id, 'deal', id, await sessionScope(user));
  if (hidden) return hidden;
  return NextResponse.json({ splits: await getSplits(user.id, id) });
}

/** Reemplaza los splits (tienen que sumar 100%; lista vacía = 100% del owner). */
export async function PUT(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const hidden = await guardRecord(user.id, 'deal', id, await sessionScope(user));
  if (hidden) return hidden;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const members = user.team?.id ? await listMembers(user.team.id) : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  const names = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const res = await setSplits(user.id, id, parsed.data.splits, user.actingUser?.email ?? user.email, (pid) => names.get(pid) ?? pid);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(400, res.reason);
  return NextResponse.json({ splits: res.splits });
}
