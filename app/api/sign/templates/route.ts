import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createTemplate, listTemplates, templateDto } from '@/lib/sign/templates';
import { parseBody, sFail, signActor, sJson } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: plantillas del workspace (?q=). */
export async function GET(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  const rows = await listTemplates(a.actor, req.nextUrl.searchParams.get('q') ?? '');
  return sJson({ templates: rows.map((t) => templateDto(t, a.actor)) });
}

const schema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    const t = await createTemplate(a.actor, await parseBody(req, schema));
    return sJson({ template: templateDto(t, a.actor) }, 201);
  } catch (err) {
    return sFail(err);
  }
}
