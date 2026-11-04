/**
 * Herramientas de Send para el asistente. Solo lectura: documentos y quién leyó
 * qué, con los mismos permisos que la app. No devuelven URLs de links: un link
 * abre el documento sin cuenta y se copia desde la web.
 */
import { z } from 'zod';
import { documentAnalytics } from '../send/analytics';
import { getDocument, listDocuments, listLinks } from '../send/core';
import type { SendActor } from '../send/types';
import { readTool, type AssistantTool, type ToolCtx } from './registry';

const actorOf = (ctx: ToolCtx): SendActor => ({ ws: ctx.workspaceId, person: ctx.personId, admin: ctx.isAdmin, email: '', name: '' });

export const sendTools: AssistantTool[] = [
  readTool({
    name: 'send_list_documents',
    app: 'send',
    description: 'List Send documents the person can see, with links, visits and who is reading now.',
    input: z.object({ query: z.string().trim().max(100).optional() }),
    run: async (ctx, input) => {
      const items = await listDocuments(actorOf(ctx), { q: input.query ?? '', limit: 30 });
      return { documents: items.map((d) => ({ title: d.title, kind: d.kind, pages: d.pageCount, links: d.links, visits: d.visits, readingNow: d.live, lastVisitAt: d.lastVisitAt, href: `/app/send/documents/${d.id}` })) };
    },
  }),
  readTool({
    name: 'send_document_readers',
    app: 'send',
    description: 'Who opened a Send document: each person, time spent, completion and time per page. Emails marked verified=false were typed, not proven. Pass the document title or id.',
    input: z.object({ document: z.string().trim().min(1).max(200) }),
    run: async (ctx, input) => {
      const actor = actorOf(ctx);
      const all = await listDocuments(actor, { q: input.document });
      const found = (await listDocuments(actor, { limit: 200 })).find((d) => d.id === input.document) ?? all.find((d) => d.title.toLowerCase() === input.document.toLowerCase()) ?? (all.length === 1 ? all[0] : null);
      if (!found) return { error: all.length ? 'ambiguous_document' : 'document_not_found', hint: { candidates: all.slice(0, 8).map((d) => d.title) } };
      const doc = await getDocument(actor, found.id);
      const a = await documentAnalytics(doc.id);
      const links = await listLinks(actor, { documentId: doc.id });
      return {
        title: doc.title,
        totals: a.totals,
        links: links.map((l) => ({ name: l.name, state: l.state, expiresAt: l.expiresAt, visits: l.visits })),
        people: a.visitors.slice(0, 30).map((v) => ({ email: v.email, verified: v.verified, possiblyForwarded: v.forwarded, visits: v.visits, seconds: v.seconds, bestCompletionPct: v.bestCompletion, lastSeenAt: v.lastSeenAt })),
        timePerPage: a.pages.map((p) => ({ page: p.page, avgSeconds: p.avgSeconds, reachPct: p.reach })),
        href: `/app/send/documents/${doc.id}`,
      };
    },
  }),
];
