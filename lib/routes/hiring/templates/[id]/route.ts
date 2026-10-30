import { NextRequest } from 'next/server';
import { deleteTemplate, templateSchema, updateTemplate } from '@/lib/hiring/comms';
import { hFail, hiringActor, hJson, readJson } from '@/lib/hiring/http';
import { HiringError } from '@/lib/hiring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const parsed = templateSchema.omit({ kind: true }).partial().safeParse(await readJson(req));
    if (!parsed.success) throw new HiringError('invalid_input');
    return hJson({ template: await updateTemplate(a.actor, (await params).id, parsed.data) });
  } catch (err) {
    return hFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    await deleteTemplate(a.actor, (await params).id);
    return hJson({ ok: true });
  } catch (err) {
    return hFail(err);
  }
}
