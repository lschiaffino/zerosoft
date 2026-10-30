import { NextRequest } from 'next/server';
import { listChecklists, startChecklist } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ checklists: await listChecklists(ctx, { employeeId: req.nextUrl.searchParams.get('employeeId') ?? undefined }) }));
}

/** POST { employeeId, templateId }: checklist desde una plantilla. */
export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson({ checklist: await startChecklist(ctx, String(b.employeeId ?? ''), String(b.templateId ?? ''), typeof b.anchorDate === 'string' ? b.anchorDate : undefined) }, 201);
  });
}
