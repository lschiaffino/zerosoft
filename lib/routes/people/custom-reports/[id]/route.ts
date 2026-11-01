import type { NextRequest } from 'next/server';
import { pjson, withPeople } from '@/lib/people-http';
import { deleteReport } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => ((await deleteReport(ctx, (await params).id)) ? pjson({ ok: true }) : pjson({ error: 'not_found' }, 404)));
}
