import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRecSettings, listContentOwners, retentionPreview, updateRecSettings } from '@/lib/rec-admin';
import { recActor, recCurrentPeople, recFail, recJson, recPeople } from '@/lib/rec-http';
import { REC_RETENTION_OPTIONS } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes de Rec. La lista de dueños y la vista previa de retención son solo para admins. */
export async function GET(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const settings = await getRecSettings(s.actor.ws);
  if (!s.actor.admin) return recJson({ settings, admin: false });
  const days = Number(req.nextUrl.searchParams.get('previewDays'));
  const preview = (REC_RETENTION_OPTIONS as readonly number[]).includes(days) ? await retentionPreview(s.actor, days) : null;
  // Destinos del traspaso, con la regla de transferContent: quien lo hace solo se lo queda si no hay nadie más.
  const all = await recPeople(s.user);
  const others = all.filter((p) => p.id !== s.actor.actor);
  return recJson({ settings, admin: true, owners: await listContentOwners(s.actor, await recCurrentPeople(s.user)), people: others.length ? others : all, preview });
}

const schema = z
  .object({
    defaultPrivacy: z.enum(['people', 'link', 'workspace']),
    defaultAllowDownload: z.boolean(),
    brandName: z.string().max(80),
    brandColor: z.string().max(7).nullable(),
    retentionDays: z.number().int().nullable(),
  })
  .partial();

export async function PATCH(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    return recJson({ settings: await updateRecSettings(s.actor, parsed.data) });
  } catch (err) {
    return recFail(err);
  }
}
