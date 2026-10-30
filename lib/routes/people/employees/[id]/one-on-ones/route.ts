import { NextRequest } from 'next/server';
import { createOneOnOne, listOneOnOnes } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Notas 1:1 de quien mira con esta persona (solo las dos personas). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ notes: await listOneOnOnes(ctx, (await params).id) }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ note: await createOneOnOne(ctx, (await params).id, await readJson(req)) }, 201));
}
