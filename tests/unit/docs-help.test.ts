import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createDocPage, getDocPageRow, updateDocPage } from '@/lib/docs';
import {
  expandQuery,
  getHelpArticle,
  getHelpFeedbackStats,
  getHelpWorkspace,
  listHelpCollections,
  recordHelpFeedback,
  searchHelpArticles,
} from '@/lib/docs-help';
import { createChatWidget, updateChatWidget } from '@/lib/chat-data';
import { retrieveKnowledge } from '@/lib/chat-bot-ai';
import { GET as helpRoute } from '@/app/api/chat/help/route';
import { makeUser } from './helpers';

function para(text: string) {
  return [{ id: crypto.randomUUID(), type: 'paragraph' as const, content: text }];
}

async function handleOf(userId: string): Promise<string> {
  const row = (await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(userId)) as { handle: string };
  return row.handle;
}

async function setup() {
  const a = await makeUser('helpa');
  const b = await makeUser('helpb');
  const root = await createDocPage(a.id, { title: 'Getting started', content: para('Welcome to the product.') });
  const child = await createDocPage(a.id, { title: 'Billing and invoices', parent_id: root.id, content: para('Invoices arrive monthly by email.') });
  const draft = await createDocPage(a.id, { title: 'Secret roadmap', content: para('Confidential pricing plans zebra.') });
  const archived = await createDocPage(a.id, { title: 'Old article', content: para('Legacy flamingo content.') });
  const other = await createDocPage(b.id, { title: 'Other workspace refunds', content: para('Refund flamingo policy.') });
  for (const [owner, id] of [
    [a.id, root.id],
    [a.id, child.id],
    [a.id, archived.id],
    [b.id, other.id],
  ] as const) {
    await updateDocPage(owner, id, { published: true });
  }
  await updateDocPage(a.id, archived.id, { archived: true });
  // Publicada y despublicada: conserva el slug pero no se sirve.
  await updateDocPage(a.id, draft.id, { published: true });
  await updateDocPage(a.id, draft.id, { published: false });
  const slug = async (id: string) => (await getDocPageRow(id))!.slug as string;
  return {
    a,
    b,
    root,
    child,
    draft,
    archived,
    other,
    slugs: { root: await slug(root.id), child: await slug(child.id), draft: await slug(draft.id), other: await slug(other.id), archived: await slug(archived.id) },
  };
}

describe('centro de ayuda (/h/<handle>)', () => {
  it('publicar asigna un slug estable y único por workspace', async () => {
    const u = await makeUser('slug');
    const p1 = await createDocPage(u.id, { title: 'Cómo empezar' });
    const p2 = await createDocPage(u.id, { title: 'Cómo empezar' });
    await updateDocPage(u.id, p1.id, { published: true });
    await updateDocPage(u.id, p2.id, { published: true });
    expect((await getDocPageRow(p1.id))!.slug).toBe('como-empezar');
    expect((await getDocPageRow(p2.id))!.slug).toBe('como-empezar-2');
    await updateDocPage(u.id, p1.id, { title: 'Otro título' });
    await updateDocPage(u.id, p1.id, { published: false });
    await updateDocPage(u.id, p1.id, { published: true });
    expect((await getDocPageRow(p1.id))!.slug).toBe('como-empezar');
  });

  it('resuelve el workspace por handle', async () => {
    const { a } = await setup();
    const ws = await getHelpWorkspace(await handleOf(a.id));
    expect(ws?.id).toBe(a.id);
    expect(await getHelpWorkspace('no-such-handle-xyz')).toBeNull();
  });

  it('colecciones: solo publicadas, no archivadas, del workspace', async () => {
    const { a, root, child } = await setup();
    const cols = await listHelpCollections(a.id);
    expect(cols.map((c) => c.id)).toEqual([root.id]);
    expect(cols[0].articles.map((x) => x.id)).toEqual([child.id]);
  });

  it('nunca sirve páginas sin publicar, archivadas ni de otro workspace', async () => {
    const { a, slugs, child, root } = await setup();
    expect(await getHelpArticle(a.id, slugs.draft)).toBeNull();
    expect(await getHelpArticle(a.id, slugs.archived)).toBeNull();
    expect(await getHelpArticle(a.id, slugs.other)).toBeNull();
    const art = await getHelpArticle(a.id, slugs.child);
    expect(art?.id).toBe(child.id);
    expect(art?.collection?.id).toBe(root.id);
    expect(art?.prev?.id).toBe(root.id);
    expect(art?.next).toBeNull();
    expect(art?.children).toEqual([]);
  });

  it('una colección lista sus artículos publicados como hijas', async () => {
    const { a, slugs, child } = await setup();
    const col = await getHelpArticle(a.id, slugs.root);
    expect(col?.children.map((c) => c.id)).toEqual([child.id]);
    expect(col?.children[0].excerpt).toContain('Invoices arrive monthly');
  });

  it('la búsqueda ignora borradores y otros workspaces', async () => {
    const { a } = await setup();
    expect(await searchHelpArticles(a.id, 'zebra pricing')).toEqual([]);
    expect(await searchHelpArticles(a.id, 'flamingo')).toEqual([]);
    const hits = await searchHelpArticles(a.id, 'invoices monthly');
    expect(hits[0]?.title).toBe('Billing and invoices');
    // Cada artículo trae su colección para la miga del resultado.
    expect(hits[0]?.collection?.title).toBe('Getting started');
    // Singular/plural y raíces comunes también encuentran el artículo.
    expect((await searchHelpArticles(a.id, 'invoice'))[0]?.title).toBe('Billing and invoices');
    expect(expandQuery('reembolso', ['Reembolsos y devoluciones'])).toBe('reembolso reembolsos');
  });

  it('"¿Te sirvió?" solo cuenta en páginas publicadas', async () => {
    const { a, root, draft } = await setup();
    expect(await recordHelpFeedback(draft.id, true)).toBe(false);
    expect(await recordHelpFeedback(root.id, true)).toBe(true);
    expect(await recordHelpFeedback(root.id, false)).toBe(true);
    expect(await recordHelpFeedback(root.id, true)).toBe(true);
    expect(await getHelpFeedbackStats(a.id, root.id)).toEqual({ yes: 2, no: 1 });
  });

  it('el bot usa páginas publicadas o con IA habilitada, nunca privadas', async () => {
    const { a } = await setup();
    const widget = await createChatWidget(a.id, null, { name: 'w', botEnabled: true, botSource: 'ai' });
    const hits = await retrieveKnowledge(widget, 'invoices monthly');
    expect(hits.some((h) => h.title === 'Billing and invoices')).toBe(true);
    expect((await retrieveKnowledge(widget, 'zebra pricing confidential')).length).toBe(0);
  });

  it('API del widget: 404 sin ayuda activada; solo artículos publicados', async () => {
    const { a } = await setup();
    const widget = await createChatWidget(a.id, null, { name: 'help widget' });
    const url = (q = '') => `http://localhost/api/chat/help?widgetId=${widget.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    expect((await helpRoute(new Request(url()))).status).toBe(404);
    await updateChatWidget(widget.id, { helpEnabled: true });
    const res = await helpRoute(new Request(url('invoices')));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { helpCenterUrl: string; articles: Array<{ title: string; url: string }> };
    expect(data.helpCenterUrl).toBe(`http://localhost/h/${await handleOf(a.id)}`);
    expect(data.articles[0].title).toBe('Billing and invoices');
    const secret = (await (await helpRoute(new Request(url('zebra')))).json()) as { articles: unknown[] };
    expect(secret.articles).toEqual([]);
  });
});
