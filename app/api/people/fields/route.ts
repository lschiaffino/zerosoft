import { NextRequest } from 'next/server';
import { createField, listFields } from '@/lib/people';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => pjson({ fields: await listFields(ctx.ws) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ field: await createField(ctx, await readJson(req)) }, 201));
}
