import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  importCompanies,
  importContacts,
  importDeals,
  normalizeImportValue,
  type MappedCompanyRow,
  type MappedContactRow,
  type MappedDealRow,
} from '@/lib/crm-import';
import { crmError, unauthorized, limitAction } from '@/lib/crm-http';
import { importCompanyRowSchema, importContactRowSchema, importDealRowSchema } from '@/lib/crm-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Las filas ya vienen mapeadas (header → campo) como objetos string→string.
// Cada fila se sanea campo por campo con el schema de import: lo que no valida
// se descarta (un "Lead" en mayúscula se acepta como 'lead'), así una celda
// mala no tumba el import entero. El email se pasa tal cual para que la lib
// lo reporte como error de esa fila. Los valores de HubSpot ("Marketing
// Qualified Lead", "In Progress"…) se traducen antes de validar, y las claves
// `custom.<name>` pasan como texto: la lib las convierte según el tipo.
const importSchema = z.object({
  entity: z.enum(['contacts', 'companies', 'deals']),
  mode: z.enum(['skip', 'update']),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(5000),
});

type RowSchema = typeof importContactRowSchema | typeof importCompanyRowSchema | typeof importDealRowSchema;

const CUSTOM_KEY = /^custom\.([A-Za-z0-9_-]{1,64})$/;

function sanitizeRows(rows: Array<Record<string, string>>, schema: RowSchema): Array<Record<string, unknown>> {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  return rows.map((raw) => {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      const value = raw[key]?.trim();
      if (!value) continue;
      if (key === 'email') {
        out.email = value;
        continue;
      }
      if (key === 'employees') {
        const n = Number(value.replace(/[^\d]/g, ''));
        if (value.replace(/[^\d]/g, '') && Number.isSafeInteger(n)) out.employees = n;
        continue;
      }
      const normalized = normalizeImportValue(key, value);
      for (const candidate of [normalized, normalized.toLowerCase()]) {
        const r = field.safeParse(candidate);
        if (r.success && r.data !== undefined) {
          out[key] = r.data;
          break;
        }
      }
    }
    const custom: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const m = CUSTOM_KEY.exec(key);
      const v = value?.trim();
      if (m && v) custom[m[1]] = v.slice(0, 500);
    }
    if (Object.keys(custom).length) out.custom = custom;
    return out;
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const limited = await limitAction(realUserId(user), 'import', 20, 3600);
  if (limited) return limited;

  const body: unknown = await req.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  const { entity, mode, rows } = parsed.data;
  try {
    const result =
      entity === 'contacts'
        ? await importContacts(user.id, sanitizeRows(rows, importContactRowSchema) as MappedContactRow[], mode)
        : entity === 'companies'
          ? await importCompanies(user.id, sanitizeRows(rows, importCompanyRowSchema) as MappedCompanyRow[], mode)
          : await importDeals(user.id, sanitizeRows(rows, importDealRowSchema) as MappedDealRow[], mode);
    return NextResponse.json(result);
  } catch {
    return crmError(500, 'import_failed');
  }
}
