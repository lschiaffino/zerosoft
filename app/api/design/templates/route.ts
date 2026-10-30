import { NextRequest } from 'next/server';
import { listDesigns } from '@/lib/design';
import { DESIGN_TEMPLATES, templateDoc, templateName } from '@/lib/design-templates';
import { designActor, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plantillas de la app (con su JSON, para dibujar la vista previa) y las del workspace (con miniatura). */
export async function GET(req: NextRequest) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const locale = req.nextUrl.searchParams.get('locale') ?? 'en';
  const builtIn = DESIGN_TEMPLATES.map((t) => ({ id: t.id, preset: t.preset, name: templateName(t, locale), doc: templateDoc(t, locale) }));
  const workspace = await listDesigns(s.actor, { view: 'templates', limit: 100 });
  return designJson({ builtIn, workspace });
}
