// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/v1/calendar/bookings/[id]/route';
import * as m1 from '@/lib/routes/v1/calendar/bookings/[id]/cancel/route';
import * as m2 from '@/lib/routes/v1/calendar/bookings/[id]/no-show/route';
import * as m3 from '@/lib/routes/v1/calendar/bookings/[id]/reschedule/route';
import * as m4 from '@/lib/routes/v1/chat/conversations/[id]/route';
import * as m5 from '@/lib/routes/v1/chat/conversations/[id]/assign/route';
import * as m6 from '@/lib/routes/v1/chat/conversations/[id]/messages/route';
import * as m7 from '@/lib/routes/v1/chat/conversations/[id]/reopen/route';
import * as m8 from '@/lib/routes/v1/chat/conversations/[id]/resolve/route';
import * as m9 from '@/lib/routes/v1/crm/companies/[id]/route';
import * as m10 from '@/lib/routes/v1/crm/contacts/[id]/route';
import * as m11 from '@/lib/routes/v1/crm/deals/[id]/route';
import * as m12 from '@/lib/routes/v1/crm/deals/[id]/line-items/route';
import * as m13 from '@/lib/routes/v1/crm/deals/[id]/line-items/[itemId]/route';
import * as m14 from '@/lib/routes/v1/crm/deals/[id]/move/route';
import * as m15 from '@/lib/routes/v1/crm/email-templates/[id]/route';
import * as m16 from '@/lib/routes/v1/crm/forms/[id]/submissions/route';
import * as m17 from '@/lib/routes/v1/crm/leads/[id]/route';
import * as m18 from '@/lib/routes/v1/crm/objects/[slug]/records/route';
import * as m19 from '@/lib/routes/v1/crm/objects/[slug]/records/[id]/route';
import * as m20 from '@/lib/routes/v1/crm/products/[id]/route';
import * as m21 from '@/lib/routes/v1/crm/quotes/[id]/route';
import * as m22 from '@/lib/routes/v1/crm/sequences/[id]/enroll/route';
import * as m23 from '@/lib/routes/v1/crm/sequences/[id]/unenroll/route';
import * as m24 from '@/lib/routes/v1/crm/tags/[id]/route';
import * as m25 from '@/lib/routes/v1/crm/tags/[id]/records/route';
import * as m26 from '@/lib/routes/v1/crm/tasks/[id]/route';
import * as m27 from '@/lib/routes/v1/groups/chats/[id]/route';
import * as m28 from '@/lib/routes/v1/groups/chats/[id]/members/route';
import * as m29 from '@/lib/routes/v1/groups/chats/[id]/messages/route';
import * as m30 from '@/lib/routes/v1/groups/tickets/[id]/route';
import * as m31 from '@/lib/routes/v1/links/[id]/route';
import * as m32 from '@/lib/routes/v1/links/[id]/stats/route';
import * as m33 from '@/lib/routes/v1/robots/[id]/bulk/route';
import * as m34 from '@/lib/routes/v1/robots/batches/[id]/route';
import * as m35 from '@/lib/routes/v1/robots/runs/[id]/route';
import * as m36 from '@/lib/routes/v1/track/agent-sessions/[id]/route';
import * as m37 from '@/lib/routes/v1/track/agent-sessions/[id]/activities/route';
import * as m38 from '@/lib/routes/v1/track/issues/[id]/route';
import * as m39 from '@/lib/routes/v1/track/issues/[id]/comments/route';
import * as m40 from '@/lib/routes/v1/track/projects/[id]/route';
import * as m41 from '@/lib/routes/v1/track/projects/[id]/cycles/route';
import * as m42 from '@/lib/routes/v1/track/projects/[id]/statuses/route';
import * as m43 from '@/lib/routes/v1/track/teams/[id]/route';
import * as m44 from '@/lib/routes/v1/track/teams/[id]/cycles/route';
import * as m45 from '@/lib/routes/v1/track/teams/[id]/statuses/route';
import * as m46 from '@/lib/routes/v1/voice/sessions/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'calendar/bookings/[id]', mod: m0 }, // lib/routes/v1/calendar/bookings/[id]
  { pattern: 'calendar/bookings/[id]/cancel', mod: m1 }, // lib/routes/v1/calendar/bookings/[id]/cancel
  { pattern: 'calendar/bookings/[id]/no-show', mod: m2 }, // lib/routes/v1/calendar/bookings/[id]/no-show
  { pattern: 'calendar/bookings/[id]/reschedule', mod: m3 }, // lib/routes/v1/calendar/bookings/[id]/reschedule
  { pattern: 'chat/conversations/[id]', mod: m4 }, // lib/routes/v1/chat/conversations/[id]
  { pattern: 'chat/conversations/[id]/assign', mod: m5 }, // lib/routes/v1/chat/conversations/[id]/assign
  { pattern: 'chat/conversations/[id]/messages', mod: m6 }, // lib/routes/v1/chat/conversations/[id]/messages
  { pattern: 'chat/conversations/[id]/reopen', mod: m7 }, // lib/routes/v1/chat/conversations/[id]/reopen
  { pattern: 'chat/conversations/[id]/resolve', mod: m8 }, // lib/routes/v1/chat/conversations/[id]/resolve
  { pattern: 'crm/companies/[id]', mod: m9 }, // lib/routes/v1/crm/companies/[id]
  { pattern: 'crm/contacts/[id]', mod: m10 }, // lib/routes/v1/crm/contacts/[id]
  { pattern: 'crm/deals/[id]', mod: m11 }, // lib/routes/v1/crm/deals/[id]
  { pattern: 'crm/deals/[id]/line-items', mod: m12 }, // lib/routes/v1/crm/deals/[id]/line-items
  { pattern: 'crm/deals/[id]/line-items/[itemId]', mod: m13 }, // lib/routes/v1/crm/deals/[id]/line-items/[itemId]
  { pattern: 'crm/deals/[id]/move', mod: m14 }, // lib/routes/v1/crm/deals/[id]/move
  { pattern: 'crm/email-templates/[id]', mod: m15 }, // lib/routes/v1/crm/email-templates/[id]
  { pattern: 'crm/forms/[id]/submissions', mod: m16 }, // lib/routes/v1/crm/forms/[id]/submissions
  { pattern: 'crm/leads/[id]', mod: m17 }, // lib/routes/v1/crm/leads/[id]
  { pattern: 'crm/objects/[slug]/records', mod: m18 }, // lib/routes/v1/crm/objects/[slug]/records
  { pattern: 'crm/objects/[slug]/records/[id]', mod: m19 }, // lib/routes/v1/crm/objects/[slug]/records/[id]
  { pattern: 'crm/products/[id]', mod: m20 }, // lib/routes/v1/crm/products/[id]
  { pattern: 'crm/quotes/[id]', mod: m21 }, // lib/routes/v1/crm/quotes/[id]
  { pattern: 'crm/sequences/[id]/enroll', mod: m22 }, // lib/routes/v1/crm/sequences/[id]/enroll
  { pattern: 'crm/sequences/[id]/unenroll', mod: m23 }, // lib/routes/v1/crm/sequences/[id]/unenroll
  { pattern: 'crm/tags/[id]', mod: m24 }, // lib/routes/v1/crm/tags/[id]
  { pattern: 'crm/tags/[id]/records', mod: m25 }, // lib/routes/v1/crm/tags/[id]/records
  { pattern: 'crm/tasks/[id]', mod: m26 }, // lib/routes/v1/crm/tasks/[id]
  { pattern: 'groups/chats/[id]', mod: m27 }, // lib/routes/v1/groups/chats/[id]
  { pattern: 'groups/chats/[id]/members', mod: m28 }, // lib/routes/v1/groups/chats/[id]/members
  { pattern: 'groups/chats/[id]/messages', mod: m29 }, // lib/routes/v1/groups/chats/[id]/messages
  { pattern: 'groups/tickets/[id]', mod: m30 }, // lib/routes/v1/groups/tickets/[id]
  { pattern: 'links/[id]', mod: m31 }, // lib/routes/v1/links/[id]
  { pattern: 'links/[id]/stats', mod: m32 }, // lib/routes/v1/links/[id]/stats
  { pattern: 'robots/[id]/bulk', mod: m33 }, // lib/routes/v1/robots/[id]/bulk
  { pattern: 'robots/batches/[id]', mod: m34 }, // lib/routes/v1/robots/batches/[id]
  { pattern: 'robots/runs/[id]', mod: m35 }, // lib/routes/v1/robots/runs/[id]
  { pattern: 'track/agent-sessions/[id]', mod: m36 }, // lib/routes/v1/track/agent-sessions/[id]
  { pattern: 'track/agent-sessions/[id]/activities', mod: m37 }, // lib/routes/v1/track/agent-sessions/[id]/activities
  { pattern: 'track/issues/[id]', mod: m38 }, // lib/routes/v1/track/issues/[id]
  { pattern: 'track/issues/[id]/comments', mod: m39 }, // lib/routes/v1/track/issues/[id]/comments
  { pattern: 'track/projects/[id]', mod: m40 }, // lib/routes/v1/track/projects/[id]
  { pattern: 'track/projects/[id]/cycles', mod: m41 }, // lib/routes/v1/track/projects/[id]/cycles
  { pattern: 'track/projects/[id]/statuses', mod: m42 }, // lib/routes/v1/track/projects/[id]/statuses
  { pattern: 'track/teams/[id]', mod: m43 }, // lib/routes/v1/track/teams/[id]
  { pattern: 'track/teams/[id]/cycles', mod: m44 }, // lib/routes/v1/track/teams/[id]/cycles
  { pattern: 'track/teams/[id]/statuses', mod: m45 }, // lib/routes/v1/track/teams/[id]/statuses
  { pattern: 'voice/sessions/[id]', mod: m46 }, // lib/routes/v1/voice/sessions/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
