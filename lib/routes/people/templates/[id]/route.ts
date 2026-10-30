import { NextRequest } from 'next/server';
import { deleteTemplate, getTemplate, updateTemplate } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const t = await getTemplate(ctx.ws, (await params).id);
    return t ? pjson({ template: t }) : pjson({ error: 'not_found' }, 404);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ template: await updateTemplate(ctx, (await params).id, await readJson(req)) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteTemplate(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
