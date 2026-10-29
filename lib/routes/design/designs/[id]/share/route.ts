import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDesign, getShare, updateShare } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';
import { designPeople, notifyDesignShared } from '@/lib/design-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Acceso del diseño: workspace, personas, link público, y la gente del workspace que se puede sumar. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    const share = await getShare(s.actor, id);
    const people = share.canShare ? (await designPeople(s.user)).filter((p) => p.userId !== share.ownerId) : [];
    return designJson({ share, people });
  } catch (err) {
    return designFail(err);
  }
}

const putSchema = z.object({
  workspaceAccess: z.enum(['none', 'view', 'edit']).optional(),
  members: z
    .array(z.object({ userId: z.string().max(64), role: z.enum(['view', 'edit']) }))
    .max(200)
    .optional(),
  link: z.enum(['on', 'off', 'reset']).optional(),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    // Solo gente del workspace que puede usar Design.
    const allowed = new Set((await designPeople(s.user)).map((p) => p.userId));
    const { added } = await updateShare(s.actor, id, parsed.data, allowed);
    if (added.length) {
      const d = await getDesign(s.actor, id);
      await notifyDesignShared(s.actor, id, d?.name ?? '', added);
    }
    return designJson({ share: await getShare(s.actor, id) });
  } catch (err) {
    return designFail(err);
  }
}
