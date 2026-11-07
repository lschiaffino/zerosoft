import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { importEmployees } from '@/lib/people-extras';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { csv, dryRun }: altas y cambios desde una planilla (HR). No invita ni avisa a nadie. */
export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => {
    const limited = await limitByIp(req, 'people:import', 30, 3600, ctx.personId);
    if (limited) return limited;
    const b = await readJson(req);
    const csv = typeof b.csv === 'string' ? b.csv.slice(0, 2_000_000) : '';
    return pjson(await importEmployees(ctx, { csv, dryRun: b.dryRun === true }));
  });
}
