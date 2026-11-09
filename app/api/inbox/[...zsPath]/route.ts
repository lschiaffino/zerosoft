// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/inbox/avatar/[id]/route';
import * as m1 from '@/lib/routes/inbox/folders/[id]/route';
import * as m2 from '@/lib/routes/inbox/media/[id]/route';
import * as m3 from '@/lib/routes/inbox/scheduled/[id]/route';
import * as m4 from '@/lib/routes/inbox/snippets/[id]/route';
import * as m5 from '@/lib/routes/inbox/threads/[id]/route';
import * as m6 from '@/lib/routes/inbox/threads/[id]/messages/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'avatar/[id]', mod: m0 }, // lib/routes/inbox/avatar/[id]
  { pattern: 'folders/[id]', mod: m1 }, // lib/routes/inbox/folders/[id]
  { pattern: 'media/[id]', mod: m2 }, // lib/routes/inbox/media/[id]
  { pattern: 'scheduled/[id]', mod: m3 }, // lib/routes/inbox/scheduled/[id]
  { pattern: 'snippets/[id]', mod: m4 }, // lib/routes/inbox/snippets/[id]
  { pattern: 'threads/[id]', mod: m5 }, // lib/routes/inbox/threads/[id]
  { pattern: 'threads/[id]/messages', mod: m6 }, // lib/routes/inbox/threads/[id]/messages
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
