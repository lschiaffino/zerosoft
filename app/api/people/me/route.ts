import { getEmployee } from '@/lib/people';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/people/me: rol en People y la ficha propia. */
export async function GET() {
  return withPeople(async (ctx) =>
    pjson({
      hr: ctx.viewer.hr,
      employeeId: ctx.viewer.employeeId,
      reports: [...ctx.viewer.reports],
      employee: ctx.viewer.employeeId ? await getEmployee(ctx, ctx.viewer.employeeId, { audit: false }) : null,
    }),
  );
}
