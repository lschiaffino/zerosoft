import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createRecord, getObject, objectEntity } from '@/lib/crm-objects';
import { coerceCustom, workspacePeople } from '@/lib/crm-import';
import { crmError, forbidden, invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { isWorkspaceAdmin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  name: z.string().max(500),
  ownerEmail: z.string().max(320).optional(),
  custom: z.record(z.string().max(2000)).optional(),
});
const bodySchema = z.object({ rows: z.array(rowSchema).min(1).max(5000) });

/**
 * Import CSV de registros de un objeto propio: el navegador parsea el CSV y
 * mapea columnas a propiedades; acá se valida cada valor con el tipo de la
 * propiedad y el owner por email o nombre. Una fila sin nombre se salta.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const object = await getObject(user.id, id);
  if (!object) return notFound();
  const limited = await limitAction(realUserId(user), 'import', 30, 3600);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const [people, access] = await Promise.all([
    workspacePeople(user.id),
    fieldAccessFor(sessionFieldViewer(user), objectEntity(id)),
  ]);
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;
  for (const [i, row] of parsed.data.rows.entries()) {
    const rowNo = i + 2;
    const name = row.name.trim().slice(0, 200);
    if (!name) {
      skipped++;
      errors.push(`Row ${rowNo}: empty ${object.primary_label || 'name'}, skipped`);
      continue;
    }
    let ownerId: string | undefined;
    const owner = (row.ownerEmail ?? '').trim().toLowerCase();
    if (owner) {
      ownerId = people.find((p) => p.email.toLowerCase() === owner || p.name.trim().toLowerCase() === owner)?.id;
      if (!ownerId) errors.push(`Row ${rowNo}: owner "${row.ownerEmail}" not found, kept default`);
    }
    const custom = coerceCustom(access.all, row.custom, rowNo, errors);
    // Lo que la persona no puede editar no se importa.
    for (const name of access.restricted.keys()) delete custom[name];
    try {
      await createRecord(user.id, id, { name, ownerId: ownerId ?? realUserId(user), custom });
      created++;
    } catch {
      skipped++;
      errors.push(`Row ${rowNo}: could not be saved`);
    }
  }
  if (!created && !skipped) return crmError(400, 'invalid_input');
  return NextResponse.json({ total: parsed.data.rows.length, created, updated: 0, skipped, errors: errors.slice(0, 200) });
}
