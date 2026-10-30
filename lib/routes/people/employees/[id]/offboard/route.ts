import { NextRequest } from 'next/server';
import { offboard } from '@/lib/people-onboarding';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { endDate, templateId, removeFromWorkspace }: salida (HR). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson(
      await offboard(ctx, (await params).id, {
        endDate: typeof b.endDate === 'string' ? b.endDate : undefined,
        templateId: typeof b.templateId === 'string' && b.templateId ? b.templateId : null,
        removeFromWorkspace: b.removeFromWorkspace === true,
      }),
    );
  });
}
