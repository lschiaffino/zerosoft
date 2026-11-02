import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { listScheduled, scheduleChange } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: cambios agendados de la ficha. POST { effectiveDate, changes }: agenda uno. Solo HR. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ scheduled: await listScheduled(ctx, (await params).id) }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson({ id: await scheduleChange(ctx, (await params).id, { effectiveDate: b.effectiveDate, changes: (b.changes ?? {}) as Record<string, unknown> }) }, 201);
  });
}
