import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createDocPage,
  createDocShare,
  getDocAccess,
  getDocPageRow,
  listAccessibleSubpages,
  listEffectiveDocShares,
  searchDocPagesContent,
  updateDocPage,
} from '@/lib/docs';
import { mergeInheritedShares, type DocsBlock, type DocsPageShare } from '@/lib/docs-types';
import { docPageUpdateSchema, SHARED_EDITABLE_FIELDS } from '@/lib/docs-schema';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import {
  DOCS_MAX_BLOB_UPLOAD,
  DOCS_MAX_UPLOAD,
  contentDisposition,
  docsFileHref,
  fileBlockFromUpload,
  fileKindFor,
  findFileBlock,
  formatFileSize,
  isDocsUploadUrl,
  stripFileUrls,
} from '@/lib/docs-files';
import {
  buildSnippet,
  highlightParts,
  isPageSwitcherHotkey,
  matchesAll,
  normalizeSearch,
  pageSearchText,
  prefilterTerm,
  rankHits,
  searchTokens,
  type DocsSearchHit,
} from '@/lib/docs-search';
import { clampCaretX, findVerticalTarget, isSameVisualLine } from '@/lib/docs-caret';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { deleteUploads, MAX_UPLOAD_SIZE } from '@/lib/uploads';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const session: { user: unknown } = { user: null };
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const { POST: uploadRoute } = await import('@/lib/routes/docs/pages/[id]/files/route');
const { GET: fileRoute } = await import('@/lib/routes/docs/files/[pageId]/[blockId]/route');

const para = (text: string): DocsBlock => ({ id: crypto.randomUUID(), type: 'paragraph', content: text });
const savedUrls: string[] = [];

afterAll(async () => {
  await deleteUploads(savedUrls);
});

// ---------- 1. Flechas entre bloques ----------

describe('Docs: flechas arriba/abajo entre bloques', () => {
  it('misma línea visual: centros a menos de media línea', () => {
    expect(isSameVisualLine({ top: 100, bottom: 120 }, { top: 102, bottom: 121 })).toBe(true);
    expect(isSameVisualLine({ top: 100, bottom: 120 }, { top: 124, bottom: 144 })).toBe(false);
    // Rect de caret degenerado (alto 0) igual se compara contra la línea.
    expect(isSameVisualLine({ top: 110, bottom: 110 }, { top: 100, bottom: 120 })).toBe(true);
  });

  it('el destino saltea divider, tabla y base; -1 en los extremos', () => {
    const types = ['paragraph', 'divider', 'table', 'heading', 'database', 'image', 'file'];
    expect(findVerticalTarget(types, 3, -1)).toBe(0);
    expect(findVerticalTarget(types, 0, 1)).toBe(3);
    expect(findVerticalTarget(types, 3, 1)).toBe(5);
    expect(findVerticalTarget(types, 5, 1)).toBe(6);
    expect(findVerticalTarget(types, 0, -1)).toBe(-1);
    expect(findVerticalTarget(types, 6, 1)).toBe(-1);
    // Desde el título (índice -1) baja al primer bloque.
    expect(findVerticalTarget(types, -1, 1)).toBe(0);
    expect(findVerticalTarget(['divider', 'quote'], -1, 1)).toBe(1);
  });

  it('la x del caret se clampea al ancho del bloque destino', () => {
    expect(clampCaretX(50, 100, 400)).toBe(101);
    expect(clampCaretX(900, 100, 400)).toBe(399);
    expect(clampCaretX(250, 100, 400)).toBe(250);
    expect(clampCaretX(250, 100, 101)).toBe(100);
  });
});

// ---------- 2. Imágenes y archivos ----------

describe('Docs: bloques de imagen y archivo', () => {
  it('solo acepta URLs del storage de Docs (local o Vercel Blob)', () => {
    expect(isDocsUploadUrl('/uploads/docs/abc-foto.png')).toBe(true);
    expect(isDocsUploadUrl('https://store1.public.blob.vercel-storage.com/docs/abc-foto.png')).toBe(true);
    expect(isDocsUploadUrl('/uploads/chat/abc.png')).toBe(false);
    expect(isDocsUploadUrl('/uploads/docs/../../.env')).toBe(false);
    expect(isDocsUploadUrl('https://evil.example/docs/x.png')).toBe(false);
    expect(isDocsUploadUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isDocsUploadUrl(undefined)).toBe(false);
  });

  it('sanitizeBlocks descarta URLs ajenas y campos de archivo en otros tipos', () => {
    const [img, para2, file] = sanitizeBlocks([
      { id: 'a', type: 'image', content: '', url: 'https://evil.example/x.png', name: '<b>x</b>.png', size: 12.6, mime: 'IMAGE/PNG' },
      { id: 'b', type: 'paragraph', content: 'hola', url: '/uploads/docs/x.png', name: 'n' },
      { id: 'c', type: 'file', content: '', url: '/uploads/docs/u-informe.pdf', name: 'informe.pdf', size: 2048, mime: 'text/html; x' },
    ]);
    expect(img.url).toBeUndefined();
    expect(img.name).toBe('bx/b.png');
    expect(img.size).toBe(13);
    expect(img.mime).toBe('image/png');
    expect(para2.url).toBeUndefined();
    expect(para2.name).toBeUndefined();
    expect(file.url).toBe('/uploads/docs/u-informe.pdf');
    expect(file.mime).toBeUndefined();
  });

  it('topes: 50 MB por el servidor (disco propio) y 5 GB subiendo directo a Blob', () => {
    expect(DOCS_MAX_UPLOAD).toBe(50 * 1024 * 1024);
    expect(DOCS_MAX_BLOB_UPLOAD).toBe(5 * 1024 * 1024 * 1024);
    expect(DOCS_MAX_UPLOAD).toBeGreaterThan(MAX_UPLOAD_SIZE);
  });

  it('helpers: tipo, tamaño, href, disposición, strip', () => {
    expect(fileKindFor('image/png')).toBe('image');
    expect(fileKindFor('image/svg+xml')).toBe('file');
    expect(fileKindFor('application/pdf')).toBe('pdf');
    expect(fileKindFor('application/zip')).toBe('file');
    expect(formatFileSize(900)).toBe('900 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3 MB');
    expect(docsFileHref('p 1', 'b', { download: true })).toBe('/api/docs/files/p%201/b?download=1');
    expect(contentDisposition('Año "final".pdf', false)).toBe(
      `attachment; filename="A_o _final_.pdf"; filename*=UTF-8''A%C3%B1o%20%22final%22.pdf`,
    );
    const block = fileBlockFromUpload({ url: '/uploads/docs/u-a.png', name: 'a.png', size: 10, mime: 'image/png' });
    expect(block.type).toBe('image');
    expect(fileBlockFromUpload({ url: '/uploads/docs/u-a.png', name: 'a.png', size: 10, mime: 'image/png' }, 'file').type).toBe('file');
    const [stripped] = stripFileUrls([block]);
    expect(stripped.url).toBe('');
    expect(stripped.name).toBe('a.png');
    expect(findFileBlock([block], block.id)?.url).toBe('/uploads/docs/u-a.png');
    expect(findFileBlock([para('x')], 'nope')).toBeNull();
  });

  it('el export a Markdown linkea al proxy, nunca al storage', () => {
    const blocks: DocsBlock[] = [
      para('Antes'),
      { id: 'i', type: 'image', content: '', url: '/uploads/docs/a.png', name: 'a.png' },
      { id: 'f', type: 'file', content: '', url: '/uploads/docs/b.pdf', name: 'b_v2.pdf' },
    ];
    const md = blocksToMarkdown(blocks, undefined, { fileHref: (id) => `https://z.test${docsFileHref('p', id)}` });
    expect(md).toContain('![a.png](https://z.test/api/docs/files/p/i)');
    expect(md).toContain('[b\\_v2.pdf](https://z.test/api/docs/files/p/f)');
    expect(md).not.toContain('/uploads/');
    expect(blocksToMarkdown(blocks)).toContain('a.png');
  });

  it('subida + descarga respetan los permisos de la página', async () => {
    const owner = await makeUser('fown');
    const guest = await makeUser('fgst');
    const stranger = await makeUser('fstr');
    const page = await createDocPage(owner.id, { title: 'Con adjuntos' });

    const upload = (as: unknown, file: File) => {
      session.user = as;
      const body = new FormData();
      body.append('file', file);
      return uploadRoute(
        new NextRequest(`http://x/api/docs/pages/${page.id}/files`, { method: 'POST', body }),
        { params: Promise.resolve({ id: page.id }) },
      );
    };

    // Sin acceso: 404. Con acceso de lectura: 403. HTML: rechazado.
    expect((await upload(stranger, new File(['x'], 'a.png', { type: 'image/png' }))).status).toBe(404);
    await createDocShare(owner.id, page.id, 'user', guest.id, 'view');
    expect((await upload(guest, new File(['x'], 'a.png', { type: 'image/png' }))).status).toBe(403);
    expect((await upload(owner, new File(['<b>x</b>'], 'a.html', { type: 'text/html' }))).status).toBe(415);

    const res = await upload(owner, new File([new Uint8Array([137, 80, 78, 71])], 'foto.png', { type: 'image/png' }));
    expect(res.status).toBe(201);
    const up = (await res.json()) as { url: string; name: string; size: number; mime: string };
    savedUrls.push(up.url);
    expect(isDocsUploadUrl(up.url)).toBe(true);
    expect(up).toMatchObject({ name: 'foto.png', size: 4, mime: 'image/png' });

    const block = fileBlockFromUpload(up);
    await updateDocPage(owner.id, page.id, { content: [para('hola'), block] });

    const get = (as: unknown, download = false) => {
      session.user = as;
      return fileRoute(
        new NextRequest(`http://x${docsFileHref(page.id, block.id, { download })}`),
        { params: Promise.resolve({ pageId: page.id, blockId: block.id }) },
      );
    };
    expect((await get(stranger)).status).toBe(404);
    expect((await get(null)).status).toBe(404);
    const ok = await get(guest);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    const dl = await get(guest, true);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(dl.headers.get('content-type')).toBe('application/octet-stream');

    // Publicada en el centro de ayuda: cualquiera (también sin sesión).
    await updateDocPage(owner.id, page.id, { published: true });
    expect((await get(null)).status).toBe(200);
    // Un bloque que no es de archivo: 404.
    session.user = owner;
    const notFile = await fileRoute(new NextRequest('http://x/'), {
      params: Promise.resolve({ pageId: page.id, blockId: 'nope' }),
    });
    expect(notFile.status).toBe(404);
  });
});

// ---------- 3. Búsqueda en contenido + Cmd+P ----------

describe('Docs: búsqueda por contenido', () => {
  it('helpers puros: normalización, tokens, prefiltro, snippet, resaltado', () => {
    expect(normalizeSearch('Canción ÁRBOL')).toBe('cancion arbol');
    expect(searchTokens('  Plan   Q3 ')).toEqual(['plan', 'q3']);
    expect(prefilterTerm('el plan de marketing')).toBe('marketing');
    expect(prefilterTerm('canción')).toBe('canci');
    expect(prefilterTerm('é')).toBeNull();
    expect(matchesAll('Roadmap del trimestre', ['trimestre', 'roadmap'])).toBe(true);
    expect(matchesAll('Roadmap', ['roadmap', 'q4'])).toBe(false);

    const text = `${'palabra '.repeat(30)}el presupuesto anual se aprueba en marzo ${'relleno '.repeat(30)}`;
    const snip = buildSnippet(text, ['presupuesto'], 20)!;
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.endsWith('…')).toBe(true);
    expect(snip).toContain('presupuesto');
    expect(buildSnippet('nada', ['otra'])).toBeNull();

    expect(highlightParts('Canción nueva', ['cancion'])).toEqual([
      { text: 'Canción', hit: true },
      { text: ' nueva', hit: false },
    ]);

    const hit = (id: string, match: 'title' | 'content', updated_at: string): DocsSearchHit => ({
      id, title: id, icon: null, parent_id: null, updated_at, match, snippet: null,
    });
    expect(rankHits([hit('a', 'content', '2026-02'), hit('b', 'title', '2026-01'), hit('c', 'content', '2026-03')]).map((h) => h.id))
      .toEqual(['b', 'c', 'a']);

    expect(
      pageSearchText([
        para('<strong>Hola</strong> &amp; chau'),
        { id: 't', type: 'table', content: '', rows: [['celda1', 'celda2']] },
        { id: 'f', type: 'file', content: '', name: 'contrato.pdf' },
      ]),
    ).toBe('Hola & chau celda1 celda2 contrato.pdf');
  });

  it('atajo Cmd+P / Ctrl+P (no Cmd+Shift+P ni Cmd+K)', () => {
    const k = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
      key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
    });
    expect(isPageSwitcherHotkey(k('p', { metaKey: true }))).toBe(true);
    expect(isPageSwitcherHotkey(k('P', { ctrlKey: true }))).toBe(true);
    expect(isPageSwitcherHotkey(k('p', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isPageSwitcherHotkey(k('k', { metaKey: true }))).toBe(false);
    expect(isPageSwitcherHotkey(k('p'))).toBe(false);
  });

  it('encuentra páginas por el texto de sus bloques, con título primero', async () => {
    const owner = await makeUser('srch');
    const other = await makeUser('srcho');
    const byTitle = await createDocPage(owner.id, { title: 'Presupuesto 2027', content: [para('números')] });
    const byBody = await createDocPage(owner.id, {
      title: 'Reunión de equipo',
      content: [para('Hablamos del <strong>presupuesto</strong> de marketing para el año que viene.')],
    });
    const byTable = await createDocPage(owner.id, {
      title: 'Inventario',
      content: [{ id: 't', type: 'table', content: '', rows: [['Item', 'Presupuesto asignado']] }],
    });
    const archived = await createDocPage(owner.id, { title: 'Vieja', content: [para('presupuesto viejo')] });
    await updateDocPage(owner.id, archived.id, { archived: true });
    await createDocPage(other.id, { title: 'Ajena', content: [para('presupuesto ajeno')] });

    const hits = await searchDocPagesContent(owner.id, 'presupuesto');
    expect(hits[0].id).toBe(byTitle.id);
    expect(hits[0].match).toBe('title');
    expect(hits.map((h) => h.id).sort()).toEqual([byTitle.id, byBody.id, byTable.id].sort());
    const body = hits.find((h) => h.id === byBody.id)!;
    expect(body.match).toBe('content');
    expect(body.snippet).toContain('presupuesto de marketing');
    expect(body.snippet).not.toContain('<strong>');

    // Todas las palabras tienen que estar (en cualquier orden, sin tildes).
    expect((await searchDocPagesContent(owner.id, 'marketing reunion')).map((h) => h.id)).toEqual([byBody.id]);
    expect(await searchDocPagesContent(owner.id, 'marketing inexistente')).toEqual([]);
    expect(await searchDocPagesContent(owner.id, '   ')).toEqual([]);
  });
});

// ---------- 4. Herencia de shares ----------

describe('Docs: las subpáginas heredan el acceso', () => {
  it('merge puro: gana el share más cercano y se marca el origen', () => {
    const s = (id: string, target: string, role: 'view' | 'edit'): DocsPageShare => ({
      id, page_id: 'x', kind: 'user', target_id: target, role, created_at: '',
    });
    const merged = mergeInheritedShares([
      { page: { id: 'child', title: 'Hija' }, shares: [s('1', 'ana', 'view')] },
      { page: { id: 'parent', title: 'Padre' }, shares: [s('2', 'ana', 'edit'), s('3', 'beto', 'edit')] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.target_id === 'ana')).toMatchObject({ id: '1', role: 'view', inherited_from: null });
    expect(merged.find((m) => m.target_id === 'beto')).toMatchObject({ id: '3', inherited_from: { id: 'parent', title: 'Padre' } });
  });

  it('share en el padre da acceso a hijas y nietas; cortar la herencia lo quita', async () => {
    const owner = await makeUser('iown');
    const guest = await makeUser('igst');
    const parent = await createDocPage(owner.id, { title: 'Proyecto' });
    const child = await createDocPage(owner.id, { title: 'Notas', parent_id: parent.id });
    const grandchild = await createDocPage(owner.id, { title: 'Detalle', parent_id: child.id });
    const row = async (id: string) => (await getDocPageRow(id))!;

    expect(await getDocAccess(await row(child.id), { id: guest.id })).toBeNull();
    await createDocShare(owner.id, parent.id, 'user', guest.id, 'edit');
    expect(await getDocAccess(await row(child.id), { id: guest.id })).toBe('edit');
    expect(await getDocAccess(await row(grandchild.id), { id: guest.id })).toBe('edit');

    const effective = await listEffectiveDocShares(await row(grandchild.id));
    expect(effective).toHaveLength(1);
    expect(effective[0].inherited_from).toEqual({ id: parent.id, title: 'Proyecto' });

    // Override: un share propio en la hija baja el rol para ella y su subárbol.
    await createDocShare(owner.id, child.id, 'user', guest.id, 'view');
    expect(await getDocAccess(await row(child.id), { id: guest.id })).toBe('view');
    expect(await getDocAccess(await row(grandchild.id), { id: guest.id })).toBe('view');
    expect(await getDocAccess(await row(parent.id), { id: guest.id })).toBe('edit');
    const childShares = await listEffectiveDocShares(await row(child.id));
    expect(childShares).toHaveLength(1);
    expect(childShares[0].inherited_from).toBeNull();

    // Cortar la herencia en la nieta: solo sus propios shares.
    await updateDocPage(owner.id, grandchild.id, { inherit_shares: false });
    expect((await row(grandchild.id)).inherit_shares).toBe(0);
    expect(await getDocAccess(await row(grandchild.id), { id: guest.id })).toBeNull();
    expect(await listEffectiveDocShares(await row(grandchild.id))).toEqual([]);
    await updateDocPage(owner.id, grandchild.id, { inherit_shares: true });
    expect(await getDocAccess(await row(grandchild.id), { id: guest.id })).toBe('view');
  });

  it('herencia por team y subpáginas navegables para el invitado', async () => {
    const owner = await makeUser('town');
    const teamOwner = await makeUser('ttow');
    const member = await makeUser('tmem');
    const team = await createTeam(teamOwner.id, 'Ventas');
    await addMember(team.id, member.id, 'member');
    const parent = await createDocPage(owner.id, { title: 'Playbook' });
    const open = await createDocPage(owner.id, { title: 'Guiones', parent_id: parent.id });
    const closed = await createDocPage(owner.id, { title: 'Privada', parent_id: parent.id });
    await updateDocPage(owner.id, closed.id, { inherit_shares: false });
    await createDocShare(owner.id, parent.id, 'team', team.id, 'view');

    expect(await getDocAccess((await getDocPageRow(open.id))!, { id: member.id })).toBe('view');
    const subs = await listAccessibleSubpages({ id: member.id }, parent.id);
    expect(subs.map((s) => s.id)).toEqual([open.id]);
  });

  it('inherit_shares lo cambia solo el dueño (no está entre los campos de un invitado)', () => {
    expect(docPageUpdateSchema.safeParse({ inherit_shares: false }).success).toBe(true);
    expect((SHARED_EDITABLE_FIELDS as readonly string[]).includes('inherit_shares')).toBe(false);
  });
});
