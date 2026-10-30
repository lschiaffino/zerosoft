import { orgChart } from '@/lib/people';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withPeople(async (ctx) => pjson({ nodes: await orgChart(ctx) }));
}
