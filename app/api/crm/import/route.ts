import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import {
  importCompanies,
  importContacts,
  type MappedCompanyRow,
  type MappedContactRow,
} from '@/lib/crm';
import { crmError, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Las filas ya vienen mapeadas (header → campo); solo se valida que sean
// objetos string→string. Los errores por fila van dentro del resultado.
const importSchema = z.object({
  entity: z.enum(['contacts', 'companies']),
  mode: z.enum(['skip', 'update']),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(5000),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  const { entity, mode, rows } = parsed.data;
  try {
    const result =
      entity === 'contacts'
        ? await importContacts(user.id, rows as unknown as MappedContactRow[], mode)
        : await importCompanies(user.id, rows as unknown as MappedCompanyRow[], mode);
    return NextResponse.json(result);
  } catch {
    return crmError(500, 'import_failed');
  }
}
