import { NextRequest } from 'next/server';
import { getSettings, listFields, updateSettings } from '@/lib/people';
import { listPolicies } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => {
    const s = await getSettings(ctx.ws);
    return pjson({ settings: ctx.viewer.hr ? s : { visibility: s.visibility, welcome: s.welcome, handbookPageId: s.handbookPageId, countries: s.countries }, fields: await listFields(ctx.ws), policies: await listPolicies(ctx.ws) });
  });
}

export async function PATCH(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ settings: await updateSettings(ctx, (await readJson(req)) as never) }));
}
