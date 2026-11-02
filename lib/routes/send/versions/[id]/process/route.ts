import { NextRequest } from 'next/server';
import { canEditDocument, pumpRender, versionDto, versionForActor } from '@/lib/send/core';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: renderiza más páginas. El navegador de quien sube lo llama hasta que termina; si se va, sigue el cron. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const { version, document } = await versionForActor(a.actor, id);
    if (!canEditDocument(a.actor, document)) return sJson({ error: 'forbidden' }, 403);
    const v = version.status === 'processing' ? await pumpRender(version.id) : version;
    const fresh = v.status === 'ready' ? (await versionForActor(a.actor, id)).document.current_version_id : document.current_version_id;
    return sJson({ version: versionDto(v, fresh) });
  } catch (err) {
    return sFail(err);
  }
}
