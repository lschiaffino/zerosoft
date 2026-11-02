import { NextRequest } from 'next/server';
import { z } from 'zod';
import { completeUpload, getDocument, versionDto } from '@/lib/send/core';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ durationSec: z.number().positive().max(86_400).optional() });

/** POST: terminó la subida. Valida el archivo por sus bytes y lo deja para procesar. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const v = await completeUpload(a.actor, id, await parseBody(req, schema));
    const d = await getDocument(a.actor, v.document_id);
    return sJson({ version: versionDto(v, d.current_version_id) });
  } catch (err) {
    return sFail(err);
  }
}
