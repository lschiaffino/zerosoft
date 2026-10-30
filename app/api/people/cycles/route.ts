import { NextRequest } from 'next/server';
import { createCycle, listCycles } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => pjson({ cycles: await listCycles(ctx) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ cycle: await createCycle(ctx, await readJson(req)) }, 201));
}
