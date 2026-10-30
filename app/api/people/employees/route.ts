import { NextRequest } from 'next/server';
import { createEmployee, directoryFacets, listEmployees } from '@/lib/people';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/people/employees?q=&department=&location=&status=&type=: directorio (solo lo que quien mira puede ver). */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const sp = req.nextUrl.searchParams;
    const employees = await listEmployees(ctx, {
      q: sp.get('q') ?? undefined,
      department: sp.get('department') ?? undefined,
      location: sp.get('location') ?? undefined,
      status: sp.get('status') ?? undefined,
      type: sp.get('type') ?? undefined,
    });
    return pjson({ employees, facets: await directoryFacets(ctx), hr: ctx.viewer.hr, me: ctx.viewer.employeeId });
  });
}

/** POST: HR crea una ficha (y, si se elige, su onboarding). */
export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ employee: await createEmployee(ctx, (await readJson(req)) as never) }, 201));
}
