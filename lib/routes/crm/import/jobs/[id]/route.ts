import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { cancelImportJob, getImportJob, startImportJob } from '@/lib/crm-import-jobs';
import { crmError, forbidden, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startSchema = z.object({
  groups: z.array(z.enum(['companies', 'contacts', 'deals', 'activities'])).min(1).max(4),
  ownerMap: z.record(z.string().max(64), z.string().max(64)).default({}),
  defaultOwnerId: z.string().min(1).max(64),
});

type Props = { params: Promise<{ id: string }> };

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  if (!isWorkspaceAdmin(user)) return { res: forbidden() } as const;
  return { user } as const;
}

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const a = await admin();
  if ('res' in a) return a.res;
  const job = await getImportJob(a.user.id, id);
  return job ? NextResponse.json(job) : notFound();
}

/** Arranca el import revisado en la vista previa: qué traer y a quién va cada owner. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const a = await admin();
  if ('res' in a) return a.res;
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const res = await startImportJob(a.user.id, id, parsed.data);
  if (!res.ok) return res.code === 'not_found' ? notFound() : crmError(400, res.code);
  return NextResponse.json(res.job);
}

/** Cancela (y borra el token). Lo ya importado queda. */
export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const a = await admin();
  if ('res' in a) return a.res;
  if (!(await cancelImportJob(a.user.id, id))) return notFound();
  return NextResponse.json(await getImportJob(a.user.id, id));
}
