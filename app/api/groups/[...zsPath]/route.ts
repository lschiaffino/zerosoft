// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/groups/broadcasts/[id]/route';
import * as m1 from '@/lib/routes/groups/chats/[id]/route';
import * as m2 from '@/lib/routes/groups/chats/[id]/group/route';
import * as m3 from '@/lib/routes/groups/chats/[id]/members/route';
import * as m4 from '@/lib/routes/groups/chats/[id]/messages/route';
import * as m5 from '@/lib/routes/groups/integrations/[kind]/route';
import * as m6 from '@/lib/routes/groups/labels/[id]/route';
import * as m7 from '@/lib/routes/groups/lists/[id]/route';
import * as m8 from '@/lib/routes/groups/media/[id]/route';
import * as m9 from '@/lib/routes/groups/messages/[id]/route';
import * as m10 from '@/lib/routes/groups/numbers/[id]/route';
import * as m11 from '@/lib/routes/groups/numbers/[id]/connect/route';
import * as m12 from '@/lib/routes/groups/recurring/[id]/route';
import * as m13 from '@/lib/routes/groups/rules/[id]/route';
import * as m14 from '@/lib/routes/groups/tasks/[id]/route';
import * as m15 from '@/lib/routes/groups/teams/[id]/route';
import * as m16 from '@/lib/routes/groups/templates/[id]/route';
import * as m17 from '@/lib/routes/groups/tickets/[id]/route';
import * as m18 from '@/lib/routes/groups/webhooks/[id]/route';
import * as m19 from '@/lib/routes/groups/webhooks/deliveries/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'broadcasts/[id]', mod: m0 }, // lib/routes/groups/broadcasts/[id]
  { pattern: 'chats/[id]', mod: m1 }, // lib/routes/groups/chats/[id]
  { pattern: 'chats/[id]/group', mod: m2 }, // lib/routes/groups/chats/[id]/group
  { pattern: 'chats/[id]/members', mod: m3 }, // lib/routes/groups/chats/[id]/members
  { pattern: 'chats/[id]/messages', mod: m4 }, // lib/routes/groups/chats/[id]/messages
  { pattern: 'integrations/[kind]', mod: m5 }, // lib/routes/groups/integrations/[kind]
  { pattern: 'labels/[id]', mod: m6 }, // lib/routes/groups/labels/[id]
  { pattern: 'lists/[id]', mod: m7 }, // lib/routes/groups/lists/[id]
  { pattern: 'media/[id]', mod: m8 }, // lib/routes/groups/media/[id]
  { pattern: 'messages/[id]', mod: m9 }, // lib/routes/groups/messages/[id]
  { pattern: 'numbers/[id]', mod: m10 }, // lib/routes/groups/numbers/[id]
  { pattern: 'numbers/[id]/connect', mod: m11 }, // lib/routes/groups/numbers/[id]/connect
  { pattern: 'recurring/[id]', mod: m12 }, // lib/routes/groups/recurring/[id]
  { pattern: 'rules/[id]', mod: m13 }, // lib/routes/groups/rules/[id]
  { pattern: 'tasks/[id]', mod: m14 }, // lib/routes/groups/tasks/[id]
  { pattern: 'teams/[id]', mod: m15 }, // lib/routes/groups/teams/[id]
  { pattern: 'templates/[id]', mod: m16 }, // lib/routes/groups/templates/[id]
  { pattern: 'tickets/[id]', mod: m17 }, // lib/routes/groups/tickets/[id]
  { pattern: 'webhooks/[id]', mod: m18 }, // lib/routes/groups/webhooks/[id]
  { pattern: 'webhooks/deliveries/[id]', mod: m19 }, // lib/routes/groups/webhooks/deliveries/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
