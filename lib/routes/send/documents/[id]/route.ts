import { NextRequest } from 'next/server';
import { z } from 'zod';
import { canEditDocument, deleteDocument, getDocument, listVersions, updateDocument, versionDto } from '@/lib/send/core';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    const versions = await listVersions(d.id);
    return sJson({ document: { id: d.id, title: d.title, sharing: d.sharing, canEdit: canEditDocument(a.actor, d), currentVersionId: d.current_version_id }, versions: versions.map((v) => versionDto(v, d.current_version_id)) });
  } catch (err) {
    return sFail(err);
  }
}

const patchSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), sharing: z.enum(['private', 'workspace']).optional() });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const d = await updateDocument(a.actor, id, await parseBody(req, patchSchema));
    return sJson({ document: { id: d.id, title: d.title, sharing: d.sharing } });
  } catch (err) {
    return sFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    await deleteDocument(a.actor, id);
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}
