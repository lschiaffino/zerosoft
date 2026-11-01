import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { addPeerReviewer, removePeerReviewer } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { subjectId, reviewerId }: suma un evaluador par (HR o la cadena de managers). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    await addPeerReviewer(ctx, (await params).id, String(b.subjectId ?? ''), String(b.reviewerId ?? ''));
    return pjson({ ok: true }, 201);
  });
}

/** DELETE ?review=: saca a un par que todavía no respondió. */
export async function DELETE(req: NextRequest) {
  return withPeople(async (ctx) => ((await removePeerReviewer(ctx, req.nextUrl.searchParams.get('review') ?? '')) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
