import { NextRequest } from 'next/server';
import { addCompensation, deleteCompensation, listCompensation } from '@/lib/people';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: historial de sueldo (HR y la persona; queda auditado). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ entries: await listCompensation(ctx, (await params).id, 'api') }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ entry: await addCompensation(ctx, (await params).id, await readJson(req)) }, 201));
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) =>
    (await deleteCompensation(ctx, (await params).id, req.nextUrl.searchParams.get('entry') ?? '')) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404),
  );
}
