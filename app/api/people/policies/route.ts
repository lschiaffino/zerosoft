import { NextRequest } from 'next/server';
import { createPolicy, listPolicies } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => pjson({ policies: await listPolicies(ctx.ws, { includeArchived: ctx.viewer.hr }) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ policy: await createPolicy(ctx, await readJson(req)) }, 201));
}
