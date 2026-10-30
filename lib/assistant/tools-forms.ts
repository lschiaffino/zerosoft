/**
 * Herramientas de Forms para el asistente. Lectura: formularios, cuántas
 * respuestas hubo en un período (con NPS si el form tiene esa pregunta) y el
 * resumen por pregunta. Escritura (con confirmación): crear un form desde una
 * plantilla y publicar, cerrar o reabrir uno. Mismas funciones y el mismo
 * acceso por formulario que la app: nadie ve respuestas de un form al que no
 * tiene acceso.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { userCanUseApp } from '../workspace';
import { createForm, getForm, listForms, updateForm, type FormListItem } from '../forms/core';
import { formSummary } from '../forms/responses';
import { npsOf } from '../forms/engine';
import { TEMPLATE_IDS } from '../forms/templates';
import type { FormsActor } from '../forms/types';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const actorOf = (ctx: ToolCtx): FormsActor => ({ ws: ctx.workspaceId, person: ctx.personId, admin: ctx.isAdmin, crm: userCanUseApp(ctx.user, 'crm') });

async function findForm(actor: FormsActor, ref: string): Promise<FormListItem | { error: string; hint?: unknown }> {
  const all = await listForms(actor, { q: ref.length >= 2 ? ref : undefined });
  const byId = (await listForms(actor)).find((f) => f.id === ref);
  if (byId) return byId;
  const exact = all.find((f) => f.name.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;
  if (all.length === 1) return all[0];
  return { error: all.length ? 'ambiguous_form' : 'form_not_found', hint: { candidates: all.slice(0, 8).map((f) => f.name) } };
}

function sinceIso(period: 'today' | 'week' | 'month' | 'all', now = new Date()): string | null {
  if (period === 'all') return null;
  const d = new Date(now.getTime());
  if (period === 'today') d.setUTCHours(0, 0, 0, 0);
  else d.setUTCDate(d.getUTCDate() - (period === 'week' ? 7 : 30));
  return d.toISOString();
}

export const formsTools: AssistantTool[] = [
  readTool({
    name: 'forms_list',
    app: 'forms',
    description: 'List the Forms forms this person can see, with status (draft, published, closed), total completed responses and responses in the last 7 days.',
    input: z.object({ query: z.string().trim().max(200).optional() }),
    run: async (ctx, { query }) => {
      const actor = actorOf(ctx);
      const forms = await listForms(actor, { q: query });
      const week = sinceIso('week')!;
      const out = [];
      for (const f of forms.slice(0, 30)) {
        const n = (await getDb().prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'completed' AND submitted_at >= ?").get(f.id, week)) as { n: number };
        out.push({ name: f.name, status: f.status, open: f.open, responses: f.responseCount, last7Days: Number(n.n), partial: f.partialCount, href: `/app/forms/${f.id}` });
      }
      return { total: forms.length, forms: out };
    },
  }),
  readTool({
    name: 'forms_response_count',
    app: 'forms',
    description:
      'How many completed responses a form got in a period (today, week = last 7 days, month = last 30 days, or all). If the form has an NPS question, also returns the NPS for that period. Use it for questions like "how many NPS responses this week".',
    input: z.object({ form: z.string().trim().min(1).max(200), period: z.enum(['today', 'week', 'month', 'all']).optional() }),
    run: async (ctx, { form, period }) => {
      const actor = actorOf(ctx);
      const hit = await findForm(actor, form);
      if ('error' in hit) return hit;
      const full = await getForm(actor, hit.id);
      if (!full) return { error: 'form_not_found' };
      const since = sinceIso(period ?? 'week');
      const rows = (await getDb()
        .prepare(`SELECT answers FROM forms_responses WHERE form_id = ? AND status = 'completed'${since ? ' AND submitted_at >= ?' : ''} LIMIT 5000`)
        .all(...(since ? [hit.id, since] : [hit.id]))) as Array<{ answers: string }>;
      const npsQ = full.definition.questions.find((q) => q.type === 'opinion_scale' && q.nps);
      let nps: ReturnType<typeof npsOf> = null;
      if (npsQ) {
        const vals: number[] = [];
        for (const r of rows) {
          try {
            const v = (JSON.parse(r.answers) as Record<string, unknown>)[npsQ.id];
            if (typeof v === 'number') vals.push(v);
          } catch {
            /* fila rota */
          }
        }
        nps = npsOf(vals);
      }
      return { form: hit.name, period: period ?? 'week', responses: rows.length, ...(npsQ ? { nps } : {}), href: `/app/forms/${hit.id}/responses` };
    },
  }),
  readTool({
    name: 'forms_summary',
    app: 'forms',
    description: 'Summary of a form: total responses, visits, completion rate, per-question results (option counts, averages, NPS, a few recent text answers) and drop-off per question.',
    input: z.object({ form: z.string().trim().min(1).max(200) }),
    run: async (ctx, { form }) => {
      const actor = actorOf(ctx);
      const hit = await findForm(actor, form);
      if ('error' in hit) return hit;
      const s = await formSummary(actor, hit.id);
      if (!s) return { error: 'form_not_found' };
      return {
        form: hit.name,
        responses: s.total,
        visits: s.visits,
        completionRate: `${s.completionRate}%`,
        questions: s.questions.map((q) => ({
          question: q.title,
          answered: q.answered,
          ...(q.counts ? { counts: q.counts.map((c) => ({ option: c.label, count: c.count })) } : {}),
          ...(q.average !== undefined && q.average !== null ? { average: q.average } : {}),
          ...(q.nps ? { nps: q.nps } : {}),
          ...(q.samples?.length ? { recent: q.samples.map((x) => x.slice(0, 300)) } : {}),
        })),
        dropOff: s.dropOff.map((d) => ({ question: d.id === '__completed' ? 'Completed' : d.title, reached: d.reached, rate: `${d.rate}%` })),
        href: `/app/forms/${hit.id}/summary`,
      };
    },
  }),
  writeTool({
    name: 'propose_forms_create',
    app: 'forms',
    description: `Prepare a new form (draft) from a template: ${TEMPLATE_IDS.join(', ')}, or "blank". Optional name and language (en, es, pt). The person confirms first; the form stays a draft until published.`,
    input: z.object({ template: z.enum(['blank', ...TEMPLATE_IDS]), name: z.string().trim().max(200).optional(), lang: z.enum(['en', 'es', 'pt']).optional() }),
    prepare: async (ctx, input) => {
      const lang = input.lang ?? (['es', 'pt'].includes(ctx.locale) ? (ctx.locale as 'es' | 'pt') : 'en');
      const name = input.name?.trim() || `${input.template === 'blank' ? 'Untitled' : input.template.toUpperCase()} form`;
      return {
        summary: `Create the form "${name}"`,
        details: [
          { label: 'Template', after: input.template },
          { label: 'Language', after: lang },
          { label: 'Status', after: 'Draft' },
        ],
        input: { template: input.template === 'blank' ? null : input.template, name, lang },
      };
    },
    execute: async (ctx, input) => {
      try {
        const form = await createForm(actorOf(ctx), { name: String(input.name), template: (input.template as string | null) ?? null, lang: input.lang as 'en' });
        return { ok: true, message: `Form "${form.name}" created as a draft.`, href: `/app/forms/${form.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_forms_status',
    app: 'forms',
    description: 'Prepare publishing, closing or reopening a form (reopen publishes it again). The person confirms first.',
    input: z.object({ form: z.string().trim().min(1).max(200), action: z.enum(['publish', 'close', 'reopen']) }),
    prepare: async (ctx, input) => {
      const actor = actorOf(ctx);
      const hit = await findForm(actor, input.form);
      if ('error' in hit) return hit;
      const next = input.action === 'close' ? 'closed' : 'published';
      if (hit.status === next) return { error: 'already', hint: { status: hit.status } };
      return {
        summary: `${input.action === 'close' ? 'Close' : 'Publish'} "${hit.name}"`,
        details: [{ label: 'Status', before: hit.status, after: next }],
        input: { id: hit.id, status: next },
      };
    },
    execute: async (ctx, input) => {
      try {
        const form = await updateForm(actorOf(ctx), String(input.id), { status: input.status as 'published' | 'closed' });
        if (!form) return { ok: false, error: 'not_found' };
        return { ok: true, message: `"${form.name}" is now ${form.status}.`, href: `/app/forms/${form.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
];
