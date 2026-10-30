import { NextRequest } from 'next/server';
import { launchCycle } from '@/lib/people-perf';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { employeeIds? }: lanza el ciclo (arma las evaluaciones y avisa). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const b = await readJson(req);
    return pjson({ cycle: await launchCycle(ctx, (await params).id, Array.isArray(b.employeeIds) ? b.employeeIds.map(String) : undefined) });
  });
}
