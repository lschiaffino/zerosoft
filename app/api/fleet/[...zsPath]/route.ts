// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/fleet/connections/[id]/route';
import * as m1 from '@/lib/routes/fleet/connections/[id]/options/route';
import * as m2 from '@/lib/routes/fleet/sessions/[id]/route';
import * as m3 from '@/lib/routes/fleet/sessions/[id]/messages/route';
import * as m4 from '@/lib/routes/fleet/sessions/[id]/messages/[messageId]/route';
import * as m5 from '@/lib/routes/fleet/tokens/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'connections/[id]', mod: m0 }, // lib/routes/fleet/connections/[id]
  { pattern: 'connections/[id]/options', mod: m1 }, // lib/routes/fleet/connections/[id]/options
  { pattern: 'sessions/[id]', mod: m2 }, // lib/routes/fleet/sessions/[id]
  { pattern: 'sessions/[id]/messages', mod: m3 }, // lib/routes/fleet/sessions/[id]/messages
  { pattern: 'sessions/[id]/messages/[messageId]', mod: m4 }, // lib/routes/fleet/sessions/[id]/messages/[messageId]
  { pattern: 'tokens/[id]', mod: m5 }, // lib/routes/fleet/tokens/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
