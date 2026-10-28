// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/teams/groups/[id]/route';
import * as m1 from '@/lib/routes/teams/invites/[id]/route';
import * as m2 from '@/lib/routes/teams/members/[userId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'groups/[id]', mod: m0 }, // lib/routes/teams/groups/[id]
  { pattern: 'invites/[id]', mod: m1 }, // lib/routes/teams/invites/[id]
  { pattern: 'members/[userId]', mod: m2 }, // lib/routes/teams/members/[userId]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
