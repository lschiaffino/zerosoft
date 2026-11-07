import { NextRequest } from 'next/server';
import { canEditDocument, pumpRender, RETRYABLE_ERRORS, retryVersion, versionDto, versionForActor } from '@/lib/send/core';
import { sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: renderiza más páginas. El navegador de quien sube lo llama hasta que termina; si se va, sigue el cron. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const { version, document } = await versionForActor(a.actor, id);
    if (!canEditDocument(a.actor, document)) return sJson({ error: 'forbidden' }, 403);
    // ?retry=1: otra vez, si falló por el servidor y no por el archivo.
    const retry = req.nextUrl.searchParams.get('retry') === '1' && version.status === 'failed' && RETRYABLE_ERRORS.includes(version.error ?? '');
    if (retry) await retryVersion(version.id);
    const v = version.status === 'processing' || retry ? await pumpRender(version.id) : version;
    const fresh = v.status === 'ready' ? (await versionForActor(a.actor, id)).document.current_version_id : document.current_version_id;
    return sJson({ version: versionDto(v, fresh) });
  } catch (err) {
    return sFail(err);
  }
}
