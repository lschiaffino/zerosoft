import { NextRequest } from 'next/server';
import { createGoal, listGoals } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ goals: await listGoals(ctx, (await params).id) }));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ goal: await createGoal(ctx, (await params).id, await readJson(req)) }, 201));
}
