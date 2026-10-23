import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { activeImportJob, createImportPreview, importPeople, listImportJobs } from '@/lib/crm-import-jobs';
import { crmError, forbidden, limitAction, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const createSchema = z.object({
  provider: z.enum(['hubspot', 'pipedrive']),
  token: z.string().trim().min(4).max(500),
});

/** Migración por API (solo admins): el job activo, los últimos y las personas para mapear owners. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const [active, jobs, people] = await Promise.all([activeImportJob(user.id), listImportJobs(user.id), importPeople(user.id)]);
  return NextResponse.json({
    active,
    jobs,
    people: people.map((p) => ({ id: p.id, label: p.name || p.email, email: p.email })),
  });
}

/**
 * Conecta con el token y arma la vista previa (no escribe nada en el CRM). El
 * token se guarda cifrado en el job y no vuelve nunca en las respuestas.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const limited = await limitAction(realUserId(user), 'import-api', 20, 3600);
  if (limited) return limited;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const res = await createImportPreview(user.id, realUserId(user), parsed.data.provider, parsed.data.token).catch(() => null);
  if (!res) return crmError(502, 'provider_error');
  if (!res.ok) return crmError(res.code === 'import_running' ? 409 : 400, res.code);
  return NextResponse.json(res.job, { status: 201 });
}
