import { NextResponse } from 'next/server';
import { createTemplate, listTemplates, templateInput } from '@/lib/groups-org';
import { groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plantillas de grupo: nombre con variables, descripción, miembros y admins fijos, etiquetas, ajustes y bienvenida. */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ templates: await listTemplates(s.ws) });
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await createTemplate(s.ws, s.me, templateInput(await readJson(req))), { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
