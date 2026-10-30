import { NextRequest } from 'next/server';
import { getExitInterview, saveExitInterview } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ interview: await getExitInterview(ctx, (await params).id) }));
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    await saveExitInterview(ctx, id, await readJson(req));
    return pjson({ interview: await getExitInterview(ctx, id) });
  });
}
