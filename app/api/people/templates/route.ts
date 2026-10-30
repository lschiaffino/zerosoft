import { NextRequest } from 'next/server';
import { createTemplate, listTemplates } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => pjson({ templates: await listTemplates(ctx.ws) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ template: await createTemplate(ctx, await readJson(req)) }, 201));
}
