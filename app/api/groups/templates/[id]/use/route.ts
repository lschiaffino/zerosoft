import { NextResponse } from 'next/server';
import { parseCsv } from '@/lib/csv-parse';
import { createFromTemplate, getTemplate, missingVariables, parseTemplateCsv, previewTemplateUse, type TemplateUse } from '@/lib/groups-org';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Crea grupos con la plantilla. Uno: { numberId, vars, phones }. Varios:
 * { numberId, csv } (una columna por variable y `participants` opcional).
 * Con { preview: true } devuelve los nombres que quedarían, sin crear nada.
 */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const template = await getTemplate(s.ws, id);
  if (!template) return groupsError(404, 'not_found');
  const b = await readJson(req);
  let uses: TemplateUse[];
  let errors: Array<{ line: number; error: string }> = [];
  if (typeof b.csv === 'string') {
    const parsed = parseTemplateCsv(parseCsv(b.csv.slice(0, 500_000)), template);
    uses = parsed.rows;
    errors = parsed.errors;
  } else {
    const raw = b.vars && typeof b.vars === 'object' && !Array.isArray(b.vars) ? (b.vars as Record<string, unknown>) : {};
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 40)) if (typeof v === 'string') vars[k.slice(0, 40)] = v.slice(0, 200);
    // Sin una variable el grupo quedaría con un nombre roto ("· Soporte").
    if (missingVariables(template, vars).length) return groupsError(400, 'missing_variables');
    uses = [{ vars, phones: strArr(b.phones, 1000) }];
  }
  if (b.preview === true) return NextResponse.json({ rows: previewTemplateUse(template, uses), errors });
  const numberId = str(b.numberId, 100) ?? '';
  if (!numberId) return groupsError(400, 'invalid_number');
  try {
    const results = await createFromTemplate(s.ws, s.me, numberId, id, uses);
    return NextResponse.json({ results, errors }, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
