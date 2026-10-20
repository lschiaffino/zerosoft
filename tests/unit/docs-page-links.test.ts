import { beforeAll, describe, expect, it } from 'vitest';
import { createDocPage, createDocShare, getDocPage, listDocBacklinks, readableLinkTitles, updateDocPage } from '@/lib/docs';
import { sanitizeBlocks, sanitizeDocsHtml } from '@/lib/docs-sanitize';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { getHelpArticle } from '@/lib/docs-help';
import { getDocPageRow } from '@/lib/docs';
import {
  isPageLinkId,
  pageLinkHtml,
  pageLinkIds,
  resolveBlocksPageLinks,
  resolvePageLinks,
} from '@/lib/docs-page-links';
import { makeUser } from './helpers';

const ID = '3f2b8c1e-9a4d-4c2e-8b7a-1d2e3f4a5b6c';
const para = (content: string) => [{ id: crypto.randomUUID(), type: 'paragraph' as const, content }];

describe('Docs: links a página ([[) — sanitización', () => {
  it('conserva el link interno y rehace el href desde el id', () => {
    const html = pageLinkHtml(ID, 'Roadmap');
    expect(html).toBe(`<a href="/app/docs/${ID}" data-page="${ID}">Roadmap</a>`);
    expect(sanitizeDocsHtml(html)).toBe(html);
    // Href manipulado: se ignora, manda el id.
    expect(sanitizeDocsHtml(`<a href="https://evil.example" data-page="${ID}">x</a>`)).toBe(
      `<a href="/app/docs/${ID}" data-page="${ID}">x</a>`,
    );
    expect(sanitizeDocsHtml(`<a href="javascript:alert(1)" data-page="${ID}">x</a>`)).not.toContain('javascript');
  });

  it('rechaza data-page que no es un id interno', () => {
    for (const bad of ['../../api/x', 'javascript:alert(1)', 'a"b', 'x/y', '', 'a'.repeat(65)]) {
      expect(isPageLinkId(bad)).toBe(false);
      const out = sanitizeDocsHtml(`<a href="javascript:alert(1)" data-page="${bad.replace(/"/g, '&quot;')}">t</a>`);
      expect(out).not.toContain('data-page');
      expect(out).not.toContain('javascript');
      expect(out).toContain('t');
    }
    // Sin data-page válido, un link externo sigue siendo externo.
    expect(sanitizeDocsHtml('<a href="https://x.com" data-page="../x">x</a>')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('el título se escapa y los handlers no sobreviven', () => {
    expect(pageLinkHtml(ID, '<img src=x onerror=alert(1)>')).toContain('&lt;img');
    const out = sanitizeDocsHtml(`<a data-page="${ID}" onclick="x()" style="color:red">T</a>`);
    expect(out).toBe(`<a href="/app/docs/${ID}" data-page="${ID}">T</a>`);
  });
});

describe('Docs: links a página — guardado y resolución', () => {
  // La primera consulta corre las migraciones de la base de test.
  beforeAll(async () => {
    await makeUser('plwarm');
  }, 60_000);

  it('sobrevive guardar y recargar (round-trip por la API de datos)', async () => {
    const u = await makeUser('plink');
    const target = await createDocPage(u.id, { title: 'Destino' });
    const content = `Ver ${pageLinkHtml(target.id, 'Destino')} y seguir`;
    const page = await createDocPage(u.id, { title: 'Origen', content: para(content) });
    const reloaded = await getDocPage(u.id, page.id);
    expect(reloaded!.content[0].content).toBe(content);
    // Re-sanitizar es idempotente.
    expect(sanitizeBlocks(reloaded!.content)[0].content).toBe(content);
    expect(pageLinkIds(reloaded!.content[0].content)).toEqual([target.id]);
  });

  it('resuelve el título actual, o baja a texto plano si no hay destino', () => {
    const html = `a ${pageLinkHtml(ID, 'Viejo')} b`;
    expect(resolvePageLinks(html, () => ({ href: `/es/app/docs/${ID}`, title: 'Nuevo <b>' }))).toBe(
      `a <a href="/es/app/docs/${ID}" data-page="${ID}">Nuevo &lt;b&gt;</a> b`,
    );
    expect(resolvePageLinks(html, () => ({ href: `/app/docs/${ID}` }))).toBe(html);
    // Sin destino: ni id ni href, solo el texto.
    expect(resolvePageLinks(html, () => null)).toBe('a Viejo b');
    // Centro de ayuda: sin data-page.
    expect(resolvePageLinks(html, () => ({ href: '/en/h/acme/slug', title: 'T', keepId: false }))).toBe(
      'a <a href="/en/h/acme/slug" class="docs-page-link">T</a> b',
    );
    // Links normales no se tocan.
    const ext = '<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>';
    expect(resolvePageLinks(ext, () => null)).toBe(ext);
  });

  it('centro de ayuda: solo expone destinos publicados', async () => {
    const u = await makeUser('plhelp');
    const pub = await createDocPage(u.id, { title: 'Publicada' });
    const draft = await createDocPage(u.id, { title: 'Borrador secreto' });
    const art = await createDocPage(u.id, {
      title: 'Artículo',
      content: para(`${pageLinkHtml(pub.id, 'Publicada')} ${pageLinkHtml(draft.id, 'Borrador')}`),
    });
    await updateDocPage(u.id, pub.id, { published: true });
    await updateDocPage(u.id, art.id, { published: true });
    const slug = (await getDocPageRow(art.id))!.slug as string;
    const article = (await getHelpArticle(u.id, slug))!;
    expect(Object.keys(article.linkTargets)).not.toContain(draft.id);
    const [b] = resolveBlocksPageLinks(sanitizeBlocks(article.content), (id) => {
      const t = article.linkTargets[id];
      return t ? { href: `/en/h/x/${t.slug}`, title: t.title, keepId: false } : null;
    });
    expect(b.content).toContain(`href="/en/h/x/${article.linkTargets[pub.id].slug}"`);
    expect(b.content).not.toContain(draft.id);
    expect(b.content).not.toContain('Borrador secreto');
    expect(b.content).toMatch(/<\/a> Borrador$/);
  });

  it('backlinks: páginas del workspace que linkean a esta', async () => {
    const u = await makeUser('plback');
    const other = await makeUser('plback2');
    const target = await createDocPage(u.id, { title: 'Destino' });
    const src = await createDocPage(u.id, { title: 'Fuente', content: para(pageLinkHtml(target.id, 'Destino')) });
    await createDocPage(u.id, { title: 'Solo texto', content: para(`menciona ${target.id} sin link`) });
    await createDocPage(other.id, { title: 'Ajena', content: para(pageLinkHtml(target.id, 'Destino')) });
    expect((await listDocBacklinks(u.id, target.id)).map((b) => b.id)).toEqual([src.id]);
  });
});

describe('Docs: links a página — export Markdown', () => {
  it('salen como links Markdown normales', () => {
    const blocks = resolveBlocksPageLinks(para(`Ver ${pageLinkHtml(ID, 'Plan [Q3]')}.`), (id) => ({
      href: `https://zerosoft.ai/app/docs/${id}`,
    }));
    expect(blocksToMarkdown(blocks)).toBe(`Ver [Plan \\[Q3\\]](https://zerosoft.ai/app/docs/${ID}).\n`);
  });
});

describe('Docs: export Markdown de un invitado — títulos actuales', () => {
  it('resuelve el título renombrado de páginas que el invitado puede abrir, y solo esas', async () => {
    const owner = await makeUser('plexpo');
    const guest = await makeUser('plexpg');
    const shared = await createDocPage(owner.id, { title: 'Viejo nombre' });
    const hidden = await createDocPage(owner.id, { title: 'Privada' });
    const page = await createDocPage(owner.id, {
      title: 'Compartida',
      content: para(`${pageLinkHtml(shared.id, 'Viejo nombre')} y ${pageLinkHtml(hidden.id, 'Privada')}`),
    });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'view');
    await createDocShare(owner.id, shared.id, 'user', guest.id, 'view');
    await updateDocPage(owner.id, shared.id, { title: 'Nombre nuevo' });
    await updateDocPage(owner.id, hidden.id, { title: 'Privada renombrada' });

    const row = (await getDocPageRow(page.id))!;
    const blocks = (await getDocPage(owner.id, page.id))!.content;
    const titles = await readableLinkTitles({ id: guest.id }, row, blocks);
    expect(titles.get(shared.id)).toBe('Nombre nuevo');
    expect(titles.has(hidden.id)).toBe(false);

    const md = blocksToMarkdown(
      resolveBlocksPageLinks(blocks, (id) => ({ href: `https://z.ai/app/docs/${id}`, title: titles.get(id) ?? null })),
    );
    expect(md).toContain('[Nombre nuevo]');
    expect(md).toContain('[Privada]');
    expect(md).not.toContain('Privada renombrada');

    // El dueño ve todos los títulos actuales.
    const own = await readableLinkTitles({ id: owner.id }, row, blocks);
    expect(own.get(hidden.id)).toBe('Privada renombrada');
  });
});
