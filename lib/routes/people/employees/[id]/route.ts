import { NextRequest } from 'next/server';
import { deleteEmployee, getEmployee, updateEmployee } from '@/lib/people';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const e = await getEmployee(ctx, (await params).id, { via: 'api' });
    return e ? pjson({ employee: e }) : pjson({ error: 'not_found' }, 404);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ employee: await updateEmployee(ctx, (await params).id, (await readJson(req)) as never) }));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteEmployee(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
