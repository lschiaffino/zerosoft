import { NextRequest } from 'next/server';
import { deleteResponses, getResponse } from '@/lib/forms/responses';
import { fFail, fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; rid: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const { id, rid } = await params;
  const response = await getResponse(a.actor, id, rid);
  return response ? fJson({ response }) : fJson({ error: 'not_found' }, 404);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const { id, rid } = await params;
    const n = await deleteResponses(a.actor, id, [rid]);
    return n ? fJson({ ok: true }) : fJson({ error: 'not_found' }, 404);
  } catch (err) {
    return fFail(err);
  }
}
