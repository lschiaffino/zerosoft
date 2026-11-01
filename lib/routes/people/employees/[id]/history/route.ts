import type { NextRequest } from 'next/server';
import { pjson, withPeople } from '@/lib/people-http';
import { listJobHistory } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: historial de puesto, área, manager y estado (HR, la persona y su cadena). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ entries: await listJobHistory(ctx, (await params).id) }));
}
