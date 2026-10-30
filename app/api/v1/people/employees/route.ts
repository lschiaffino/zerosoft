import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { getSettings, listEmployees, type PeopleCtx } from '@/lib/people';
import type { VisibilitySettings } from '@/lib/people-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/people/employees (people:read): el directorio con los campos que
 * ve cualquiera del workspace. Una API key no es HR ni la persona: nunca trae
 * sueldo, datos personales, licencias ni evaluaciones, y respeta los campos
 * que el workspace restringió (Ajustes › Visibilidad).
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'people:read');
  if ('res' in auth) return auth.res;
  const ws = auth.user.id;
  const settings = await getSettings(ws);
  const ctx: PeopleCtx = {
    ws,
    personId: '',
    wsAdmin: false,
    viewer: { personId: '', employeeId: null, hr: false, reports: new Set() },
    visibility: settings.visibility as VisibilitySettings,
    hasManager: false,
  };
  const sp = req.nextUrl.searchParams;
  const list = await listEmployees(ctx, { q: sp.get('q') ?? undefined, department: sp.get('department') ?? undefined });
  return NextResponse.json({
    data: list.map((e) => ({
      id: e.id,
      name: e.name,
      jobTitle: e.jobTitle,
      department: e.department,
      workEmail: e.workEmail,
      managerId: e.managerId,
      status: e.status,
      ...(e.location !== null ? { location: e.location } : {}),
      ...(e.phone !== null ? { phone: e.phone } : {}),
      ...(e.startDate !== undefined ? { startDate: e.startDate } : {}),
      ...(e.employmentType !== null ? { employmentType: e.employmentType } : {}),
    })),
    total: list.length,
  });
}
