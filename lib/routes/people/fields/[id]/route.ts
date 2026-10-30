import { NextRequest } from 'next/server';
import { deleteField, updateField } from '@/lib/people';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await updateField(ctx, (await params).id, await readJson(req))) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteField(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
