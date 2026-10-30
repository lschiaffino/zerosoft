/**
 * Herramientas de People para el asistente. Lectura: directorio (solo campos
 * públicos), quién está fuera, mis saldos, pendientes de aprobación y el
 * sueldo solo si quien pregunta lo puede ver (HR o la propia persona; queda
 * auditado como 'assistant'). Escritura con confirmación: pedir días y
 * aprobar o rechazar un pedido. Usan las mismas funciones (y los mismos
 * permisos) que la app: el modelo nunca recibe un dato que la persona no vería.
 */
import { z } from 'zod';
import { getEmployeeRow, listCompensation, listEmployees, peopleContext, PeopleError, type PeopleCtx } from '../people';
import { balancesFor, createRequest, decideRequest, listPolicies, listRequests, requestDays, teamCalendar } from '../people-timeoff';
import { canApprove, canSeeSensitive } from '../people-access';
import { addDays } from '../people-time';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const pctx = (ctx: ToolCtx): Promise<PeopleCtx> => peopleContext(ctx.workspaceId, ctx.personId, ctx.user.role ?? 'owner');
const today = () => new Date().toISOString().slice(0, 10);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** La persona por nombre o email (la primera que coincide del directorio que quien pregunta puede ver). */
async function findPerson(p: PeopleCtx, name: string) {
  const list = await listEmployees(p, { q: name.trim() });
  return list[0] ?? null;
}

export const peopleTools: AssistantTool[] = [
  readTool({
    name: 'people_directory',
    app: 'people',
    description: 'Search the People directory by name, job title or department. Returns public profile fields only (no salary or personal data).',
    input: z.object({ query: z.string().trim().max(200).optional(), department: z.string().trim().max(80).optional() }),
    run: async (ctx, { query, department }) => {
      const p = await pctx(ctx);
      const list = await listEmployees(p, { q: query, department });
      return {
        total: list.length,
        people: list.slice(0, 25).map((e) => ({ name: e.name, jobTitle: e.jobTitle, department: e.department, location: e.location, workEmail: e.workEmail, href: `/app/people/${e.id}` })),
      };
    },
  }),
  readTool({
    name: 'people_whos_out',
    app: 'people',
    description: 'Who is out of office between two dates (default: the next 7 days). The type of leave is only included when the person asking may see it.',
    input: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
    run: async (ctx, { from, to }) => {
      const p = await pctx(ctx);
      const f = from ?? today();
      const cal = await teamCalendar(p, f, to ?? addDays(f, 7));
      return {
        out: cal.entries.filter((e) => e.status === 'approved').map((e) => ({ name: e.employeeName, from: e.startDate, to: e.endDate, half: e.half || undefined, type: e.policyName ?? undefined })),
        holidays: cal.holidays.map((h) => ({ date: h.date, name: h.name })),
        href: '/app/people/time-off?tab=calendar',
      };
    },
  }),
  readTool({
    name: 'people_my_time_off',
    app: 'people',
    description: "The asking person's own time off balances (available days per policy) and their recent requests.",
    input: z.object({}),
    run: async (ctx) => {
      const p = await pctx(ctx);
      if (!p.viewer.employeeId) return { error: 'no_profile' };
      const [balances, requests] = await Promise.all([balancesFor(p, p.viewer.employeeId), listRequests(p, { employeeId: p.viewer.employeeId, scope: 'mine' })]);
      return {
        balances: balances.map((b) => ({ policy: b.policy.name, available: b.policy.accrual === 'none' ? null : b.balance.available, taken: b.balance.used + b.balance.scheduled, pending: b.balance.pending })),
        requests: requests.slice(0, 10).map((r) => ({ id: r.id, type: r.policyName, from: r.startDate, to: r.endDate, days: r.days, status: r.status })),
        href: '/app/people/time-off',
      };
    },
  }),
  readTool({
    name: 'people_pending_approvals',
    app: 'people',
    description: 'Time off requests waiting for the asking person to approve (their reports, or everyone for HR).',
    input: z.object({}),
    run: async (ctx) => {
      const p = await pctx(ctx);
      const list = await listRequests(p, { scope: 'approvals' });
      return { requests: list.map((r) => ({ id: r.id, name: r.employeeName, type: r.policyName, from: r.startDate, to: r.endDate, days: r.days })), href: '/app/people/time-off?tab=approvals' };
    },
  }),
  readTool({
    name: 'people_compensation',
    app: 'people',
    description: "A person's salary history. Only HR admins and the person themselves may see it; for anyone else this returns an error and no amounts.",
    input: z.object({ name: z.string().trim().min(1).max(200) }),
    run: async (ctx, { name }) => {
      const p = await pctx(ctx);
      const person = await findPerson(p, name);
      if (!person) return { error: 'not_found' };
      if (!canSeeSensitive(p.viewer, person.id, 'compensation')) return { error: 'forbidden' };
      const entries = await listCompensation(p, person.id, 'assistant');
      return { name: person.name, entries: entries.map((e) => ({ effective: e.effectiveDate, amount: e.amount, currency: e.currency, per: e.period })), href: `/app/people/${person.id}?tab=compensation` };
    },
  }),
  writeTool({
    name: 'propose_people_time_off',
    app: 'people',
    description: 'Prepare a time off request for the asking person: policy name (e.g. Vacation), start and end date (YYYY-MM-DD), optional half day (am or pm, single day only) and note. The person confirms before it is sent to their manager.',
    input: z.object({ policy: z.string().trim().min(1).max(80), startDate: isoDate, endDate: isoDate.optional(), half: z.enum(['am', 'pm']).optional(), note: z.string().max(500).optional() }),
    prepare: async (ctx, input) => {
      const p = await pctx(ctx);
      if (!p.viewer.employeeId) return { error: 'no_profile' };
      const policy = (await listPolicies(p.ws)).find((x) => x.name.toLowerCase() === input.policy.toLowerCase()) ?? (await listPolicies(p.ws)).find((x) => x.name.toLowerCase().includes(input.policy.toLowerCase()));
      if (!policy) return { error: 'invalid_policy', hint: { policies: (await listPolicies(p.ws)).map((x) => x.name) } };
      const end = input.endDate ?? input.startDate;
      const days = await requestDays(p.ws, p.viewer.employeeId, input.startDate, end, input.half ?? '');
      return {
        summary: `Request ${days} day(s) of ${policy.name}`,
        details: [
          { label: 'Type', after: policy.name },
          { label: 'Dates', after: end === input.startDate ? input.startDate : `${input.startDate} to ${end}` },
          ...(input.half ? [{ label: 'Half day', after: input.half === 'am' ? 'Morning' : 'Afternoon' }] : []),
          { label: 'Working days', after: String(days) },
        ],
        input: { policyId: policy.id, startDate: input.startDate, endDate: end, half: input.half ?? '', note: input.note ?? '' },
      };
    },
    execute: async (ctx, input) => {
      try {
        const p = await pctx(ctx);
        await createRequest(p, { policyId: String(input.policyId), startDate: String(input.startDate), endDate: String(input.endDate), half: String(input.half ?? ''), note: String(input.note ?? '') });
        return { ok: true, message: 'Time off requested. Your manager was notified.', href: '/app/people/time-off' };
      } catch (err) {
        return { ok: false, error: err instanceof PeopleError ? err.code : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_people_decide',
    app: 'people',
    description: 'Prepare approving or declining a pending time off request (id from people_pending_approvals). Only managers of that person or HR can. The person confirms first.',
    input: z.object({ requestId: z.string().trim().min(1).max(80), decision: z.enum(['approve', 'deny']) }),
    prepare: async (ctx, input) => {
      const p = await pctx(ctx);
      const req = (await listRequests(p, { scope: 'approvals' })).find((r) => r.id === input.requestId);
      if (!req) return { error: 'not_found' };
      const emp = await getEmployeeRow(p.ws, req.employeeId);
      if (!canApprove(p.viewer, req.employeeId, Boolean(emp?.manager_id))) return { error: 'forbidden' };
      return {
        summary: `${input.decision === 'approve' ? 'Approve' : 'Decline'} ${req.employeeName}'s time off`,
        details: [
          { label: 'Person', after: req.employeeName },
          { label: 'Dates', after: req.endDate === req.startDate ? req.startDate : `${req.startDate} to ${req.endDate}` },
          { label: 'Status', before: 'Pending', after: input.decision === 'approve' ? 'Approved' : 'Declined' },
        ],
        input: { requestId: req.id, decision: input.decision },
      };
    },
    execute: async (ctx, input) => {
      try {
        const p = await pctx(ctx);
        const r = await decideRequest(p, String(input.requestId), input.decision === 'approve' ? 'approve' : 'deny');
        return { ok: true, message: `${r.employeeName}'s time off ${r.status === 'approved' ? 'approved' : 'declined'}.`, href: '/app/people/time-off?tab=approvals' };
      } catch (err) {
        return { ok: false, error: err instanceof PeopleError ? err.code : 'error' };
      }
    },
  }),
];
