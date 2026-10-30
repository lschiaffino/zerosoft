// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/social/accounts/[id]/route';
import * as m1 from '@/lib/routes/social/accounts/[id]/slots/route';
import * as m2 from '@/lib/routes/social/inbox/[id]/route';
import * as m3 from '@/lib/routes/social/library/[id]/route';
import * as m4 from '@/lib/routes/social/posts/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'accounts/[id]', mod: m0 }, // lib/routes/social/accounts/[id]
  { pattern: 'accounts/[id]/slots', mod: m1 }, // lib/routes/social/accounts/[id]/slots
  { pattern: 'inbox/[id]', mod: m2 }, // lib/routes/social/inbox/[id]
  { pattern: 'library/[id]', mod: m3 }, // lib/routes/social/library/[id]
  { pattern: 'posts/[id]', mod: m4 }, // lib/routes/social/posts/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
