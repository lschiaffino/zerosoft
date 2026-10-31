import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setSpaceMembers, spaceMemberIds } from '@/lib/rec-admin';
import { recActor, recFail, recJson, recPeople } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Miembros del espacio y a quién se puede sumar (personas del workspace con acceso a Rec). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    return recJson({ members: await spaceMemberIds(s.actor, id), people: await recPeople(s.user) });
  } catch (err) {
    return recFail(err);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = z.object({ members: z.array(z.string().max(60)).max(500) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    const people = await recPeople(s.user);
    await setSpaceMembers(s.actor, id, parsed.data.members, people.map((p) => p.id));
    return recJson({ members: await spaceMemberIds(s.actor, id) });
  } catch (err) {
    return recFail(err);
  }
}
