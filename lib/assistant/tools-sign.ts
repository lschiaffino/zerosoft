/**
 * Herramientas de Sign para el asistente. Lectura: sobres que la persona ve
 * (con su caja), el detalle de uno con su línea de tiempo y las plantillas.
 * Escritura (con confirmación): mandar un sobre desde una plantilla y
 * reenviar el link a quien le toca. El asistente nunca firma, anula ni borra.
 */
import { z } from 'zod';
import { envelopeDto, listEnvelopes, remindEnvelope, requireSee, SIGN_BOXES, type SignBox } from '../sign/core';
import { listTemplates, templateDto, envelopeFromTemplate, type TemplateRole } from '../sign/templates';
import { isEmail, type SignActor } from '../sign/types';
import { readTool, writeTool, type AssistantTool, type ToolCtx } from './registry';

const actor = (ctx: ToolCtx): SignActor => {
  const person = ctx.user.actingUser ?? ctx.user;
  return { ws: ctx.workspaceId, person: ctx.personId, admin: ctx.isAdmin, email: (person.email ?? '').toLowerCase(), name: person.name ?? '' };
};

export const signTools: AssistantTool[] = [
  readTool({
    name: 'sign_envelopes',
    app: 'sign',
    description: 'List Sign envelopes I can see with their box: action (waiting on me), waiting (on others), completed, closed (declined, voided, expired) or drafts. Filter by box or text (title, recipient name or email).',
    input: z.object({ box: z.enum(SIGN_BOXES as [SignBox, ...SignBox[]]).optional(), query: z.string().trim().max(100).optional() }),
    run: async (ctx, { box, query }) => {
      const items = await listEnvelopes(actor(ctx), { box: box ?? 'all', q: query });
      return {
        total: items.length,
        envelopes: items.slice(0, 30).map((e) => ({ title: e.title, box: e.box, status: e.status, sentAt: e.sentAt, expiresAt: e.expiresAt, completedAt: e.completedAt, recipients: e.recipients.map((r) => ({ name: r.name, role: r.role, status: r.status })), href: `/app/sign/envelopes/${e.id}` })),
      };
    },
  }),
  readTool({
    name: 'sign_envelope',
    app: 'sign',
    description: 'One Sign envelope I can see, by title: status, recipients with their order and status, hashes and the latest events.',
    input: z.object({ title: z.string().trim().min(1).max(200) }),
    run: async (ctx, { title }) => {
      const hit = (await listEnvelopes(actor(ctx), { q: title, limit: 5 }))[0];
      if (!hit) return { error: 'not_found' };
      const { env, recipients } = await requireSee(actor(ctx), hit.id);
      const d = await envelopeDto(actor(ctx), env, recipients, { events: true });
      return {
        title: d.title,
        status: d.status,
        signingOrder: d.signingOrder,
        sentAt: d.sentAt,
        expiresAt: d.expiresAt,
        completedAt: d.completedAt,
        recipients: d.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, order: r.routingOrder, status: r.status, current: r.current, signedAt: r.signedAt, declineReason: r.declineReason || undefined })),
        documentHash: d.documentHash,
        finalHash: d.finalHash,
        events: d.events.slice(-15).map((e) => ({ kind: e.kind, at: e.at, who: e.recipient?.name })),
        href: `/app/sign/envelopes/${d.id}`,
      };
    },
  }),
  readTool({
    name: 'sign_templates',
    app: 'sign',
    description: 'Sign templates of the workspace with their roles (key, name, signer/approver/cc).',
    input: z.object({ query: z.string().trim().max(100).optional() }),
    run: async (ctx, { query }) => ({
      templates: (await listTemplates(actor(ctx), query ?? '')).slice(0, 30).map((t) => {
        const d = templateDto(t, actor(ctx));
        return { name: d.name, description: d.description, ready: d.hasDocument, roles: d.roles.map((r) => ({ key: r.key, name: r.name, role: r.role })), href: `/app/sign/templates/${d.id}` };
      }),
    }),
  }),
  writeTool({
    name: 'propose_sign_send',
    app: 'sign',
    description:
      'Prepare sending a Sign envelope from a template (by template name). Give one person (name and email) per template role, by role name. The person confirms before anything is sent.',
    input: z.object({
      template: z.string().trim().min(1).max(160),
      title: z.string().trim().max(200).optional(),
      people: z.array(z.object({ role: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(120), email: z.string().trim().max(254) })).min(1).max(20),
    }),
    prepare: async (ctx, input) => {
      const t = (await listTemplates(actor(ctx), input.template))[0];
      if (!t) return { error: 'not_found' };
      const d = templateDto(t, actor(ctx));
      if (!d.hasDocument) return { error: 'no_document' };
      const recipients: Record<string, { name: string; email: string }> = {};
      for (const role of d.roles as TemplateRole[]) {
        const p = input.people.find((x) => x.role.toLowerCase() === role.name.toLowerCase()) ?? (d.roles.length === 1 ? input.people[0] : undefined);
        if (!p) return { error: 'role_unfilled', hint: { roles: d.roles.map((r) => r.name) } };
        if (!isEmail(p.email)) return { error: 'invalid_email', hint: { email: p.email } };
        recipients[role.key] = { name: p.name, email: p.email };
      }
      const title = input.title || d.name;
      return {
        summary: `Send "${title}" for signature`,
        details: [
          { label: 'Template', after: d.name },
          ...d.roles.map((r) => ({ label: r.name, after: `${recipients[r.key].name} <${recipients[r.key].email}>` })),
        ],
        input: { templateId: d.id, title, recipients },
      };
    },
    execute: async (ctx, input) => {
      try {
        const env = await envelopeFromTemplate(actor(ctx), String(input.templateId), {
          title: String(input.title),
          recipients: input.recipients as Record<string, { name: string; email: string }>,
          send: true,
          locale: ctx.locale,
        });
        return { ok: true, message: 'Sent.', href: `/app/sign/envelopes/${env.id}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
  writeTool({
    name: 'propose_sign_remind',
    app: 'sign',
    description: 'Prepare emailing the signing link again to whoever has to sign an envelope I sent now (by title). The person confirms first.',
    input: z.object({ title: z.string().trim().min(1).max(200) }),
    prepare: async (ctx, input) => {
      const hit = (await listEnvelopes(actor(ctx), { q: input.title, box: 'waiting', limit: 5 })).find((e) => e.mine) ?? null;
      if (!hit) return { error: 'not_found' };
      return { summary: `Remind the recipients of "${hit.title}"`, details: [{ label: 'Envelope', after: hit.title }], input: { envelopeId: hit.id } };
    },
    execute: async (ctx, input) => {
      try {
        const n = await remindEnvelope(actor(ctx), String(input.envelopeId));
        return { ok: true, message: `Reminded ${n}.`, href: `/app/sign/envelopes/${String(input.envelopeId)}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'error' };
      }
    },
  }),
];
