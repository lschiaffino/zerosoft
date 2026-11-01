// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/people/changes/[id]/route';
import * as m1 from '@/lib/routes/people/checklists/[id]/route';
import * as m2 from '@/lib/routes/people/custom-reports/[id]/route';
import * as m3 from '@/lib/routes/people/cycles/[id]/route';
import * as m4 from '@/lib/routes/people/cycles/[id]/launch/route';
import * as m5 from '@/lib/routes/people/cycles/[id]/peers/route';
import * as m6 from '@/lib/routes/people/documents/[id]/route';
import * as m7 from '@/lib/routes/people/documents/[id]/ack/route';
import * as m8 from '@/lib/routes/people/employees/[id]/route';
import * as m9 from '@/lib/routes/people/employees/[id]/balances/route';
import * as m10 from '@/lib/routes/people/employees/[id]/compensation/route';
import * as m11 from '@/lib/routes/people/employees/[id]/exit-interview/route';
import * as m12 from '@/lib/routes/people/employees/[id]/goals/route';
import * as m13 from '@/lib/routes/people/employees/[id]/history/route';
import * as m14 from '@/lib/routes/people/employees/[id]/offboard/route';
import * as m15 from '@/lib/routes/people/employees/[id]/one-on-ones/route';
import * as m16 from '@/lib/routes/people/employees/[id]/photo/route';
import * as m17 from '@/lib/routes/people/employees/[id]/scheduled/route';
import * as m18 from '@/lib/routes/people/fields/[id]/route';
import * as m19 from '@/lib/routes/people/goals/[id]/route';
import * as m20 from '@/lib/routes/people/holidays/[id]/route';
import * as m21 from '@/lib/routes/people/one-on-ones/[id]/route';
import * as m22 from '@/lib/routes/people/policies/[id]/route';
import * as m23 from '@/lib/routes/people/reviews/[id]/route';
import * as m24 from '@/lib/routes/people/scheduled/[id]/route';
import * as m25 from '@/lib/routes/people/surveys/[id]/route';
import * as m26 from '@/lib/routes/people/tasks/[id]/route';
import * as m27 from '@/lib/routes/people/templates/[id]/route';
import * as m28 from '@/lib/routes/people/time-off/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'changes/[id]', mod: m0 }, // lib/routes/people/changes/[id]
  { pattern: 'checklists/[id]', mod: m1 }, // lib/routes/people/checklists/[id]
  { pattern: 'custom-reports/[id]', mod: m2 }, // lib/routes/people/custom-reports/[id]
  { pattern: 'cycles/[id]', mod: m3 }, // lib/routes/people/cycles/[id]
  { pattern: 'cycles/[id]/launch', mod: m4 }, // lib/routes/people/cycles/[id]/launch
  { pattern: 'cycles/[id]/peers', mod: m5 }, // lib/routes/people/cycles/[id]/peers
  { pattern: 'documents/[id]', mod: m6 }, // lib/routes/people/documents/[id]
  { pattern: 'documents/[id]/ack', mod: m7 }, // lib/routes/people/documents/[id]/ack
  { pattern: 'employees/[id]', mod: m8 }, // lib/routes/people/employees/[id]
  { pattern: 'employees/[id]/balances', mod: m9 }, // lib/routes/people/employees/[id]/balances
  { pattern: 'employees/[id]/compensation', mod: m10 }, // lib/routes/people/employees/[id]/compensation
  { pattern: 'employees/[id]/exit-interview', mod: m11 }, // lib/routes/people/employees/[id]/exit-interview
  { pattern: 'employees/[id]/goals', mod: m12 }, // lib/routes/people/employees/[id]/goals
  { pattern: 'employees/[id]/history', mod: m13 }, // lib/routes/people/employees/[id]/history
  { pattern: 'employees/[id]/offboard', mod: m14 }, // lib/routes/people/employees/[id]/offboard
  { pattern: 'employees/[id]/one-on-ones', mod: m15 }, // lib/routes/people/employees/[id]/one-on-ones
  { pattern: 'employees/[id]/photo', mod: m16 }, // lib/routes/people/employees/[id]/photo
  { pattern: 'employees/[id]/scheduled', mod: m17 }, // lib/routes/people/employees/[id]/scheduled
  { pattern: 'fields/[id]', mod: m18 }, // lib/routes/people/fields/[id]
  { pattern: 'goals/[id]', mod: m19 }, // lib/routes/people/goals/[id]
  { pattern: 'holidays/[id]', mod: m20 }, // lib/routes/people/holidays/[id]
  { pattern: 'one-on-ones/[id]', mod: m21 }, // lib/routes/people/one-on-ones/[id]
  { pattern: 'policies/[id]', mod: m22 }, // lib/routes/people/policies/[id]
  { pattern: 'reviews/[id]', mod: m23 }, // lib/routes/people/reviews/[id]
  { pattern: 'scheduled/[id]', mod: m24 }, // lib/routes/people/scheduled/[id]
  { pattern: 'surveys/[id]', mod: m25 }, // lib/routes/people/surveys/[id]
  { pattern: 'tasks/[id]', mod: m26 }, // lib/routes/people/tasks/[id]
  { pattern: 'templates/[id]', mod: m27 }, // lib/routes/people/templates/[id]
  { pattern: 'time-off/[id]', mod: m28 }, // lib/routes/people/time-off/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
