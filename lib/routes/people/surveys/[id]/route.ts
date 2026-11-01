import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { answerSurvey, closeSurvey, deleteSurvey } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { score, comment }: responder, una vez. */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    await answerSurvey(ctx, (await params).id, { score: b.score, comment: b.comment });
    return pjson({ ok: true }, 201);
  });
}

/** PATCH: HR la cierra. */
export async function PATCH(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await closeSurvey(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteSurvey(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
