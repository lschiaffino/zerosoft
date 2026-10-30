import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createDesign, getDesign, listDesigns, listFolders, type DesignView } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIEWS: DesignView[] = ['recent', 'mine', 'shared', 'starred', 'templates', 'trash', 'folder'];

/** Lista: ?view=recent|mine|shared|starred|templates|trash|folder (&folder=<id>) y ?q=. Con las carpetas. */
export async function GET(req: NextRequest) {
  const s = await designActor();
  if ('res' in s) return s.res;
  const sp = req.nextUrl.searchParams;
  const raw = sp.get('view') as DesignView | null;
  const view: DesignView = raw && VIEWS.includes(raw) ? raw : 'recent';
  const [designs, folders] = await Promise.all([
    listDesigns(s.actor, { view, folderId: sp.get('folder'), q: sp.get('q') ?? '', limit: Number(sp.get('limit') ?? 100) || 100 }),
    listFolders(s.actor),
  ]);
  return designJson({ designs, folders });
}

const createSchema = z.object({
  name: z.string().max(120).optional(),
  width: z.number().int().min(1).max(100_000).optional(),
  height: z.number().int().min(1).max(100_000).optional(),
  template: z.string().max(80).optional(),
  folderId: z.string().max(64).nullable().optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  untitled: z.string().max(120).optional(),
});

/** Diseño nuevo: en blanco (ancho y alto en px) o desde una plantilla. */
export async function POST(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  const input = parsed.data;
  if (!input.template && (!input.width || !input.height)) return designJson({ error: 'invalid_input' }, 400);
  try {
    const id = await createDesign(s.actor, input);
    const design = await getDesign(s.actor, id);
    return designJson({ design }, 201);
  } catch (err) {
    return designFail(err);
  }
}
