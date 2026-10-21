import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'zlib';
import { NextRequest } from 'next/server';
import {
  createDocComment,
  createDocPage,
  createDocShare,
  createDocWorkspaceTemplate,
  DocsTemplateLimitError,
  DOCS_TEMPLATES_MAX,
  getDocComment,
  getDocPage,
  listDocComments,
  listDocPages,
  listDocWorkspaceTemplates,
  setDocCommentResolved,
  deleteDocComment,
} from '@/lib/docs';
import { docxToBlocks, DocxImportError } from '@/lib/docs-docx';
import {
  activeMentionQuery,
  commentBodyParts,
  groupCommentThreads,
  insertMention,
  mentionedInBody,
} from '@/lib/docs-comments';
import { insertionPoint } from '@/lib/docs-blocks';
import { listNotifications } from '@/lib/notifications';
import { addMember, createTeam } from '@/lib/teams';
import { getDb } from '@/lib/db';
import type { DocsBlock, DocsComment } from '@/lib/docs-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name?: string | null; role?: string; actingUser?: { id: string; email: string; name: string | null } },
}));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const commentsRoute = await import('@/app/api/docs/pages/[id]/comments/route');
const importRoute = await import('@/app/api/docs/pages/[id]/import/route');
const templatesRoute = await import('@/app/api/docs/templates/route');
const actions = await import('@/lib/docs-actions');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const as = (u: { id: string; email: string; name?: string | null }, extra: Record<string, unknown> = {}) => {
  session.user = { id: u.id, email: u.email, name: u.name ?? null, ...extra };
};

beforeEach(() => {
  session.user = null;
});

// ---------- .docx de prueba (zip mínimo: deflate + stored) ----------

function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (inner: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const DOCX = {
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${[
    p(r('Informe &amp; plan'), '<w:pStyle w:val="Ttulo1"/>'),
    p(`${r('Hola ')}${r('negrita', '<w:b/>')}${r(' y ')}${r('no', '<w:b w:val="0"/>')}`),
    p(`<w:hyperlink r:id="rId9">${r('link')}</w:hyperlink>`),
    p(r('uno'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p(r('anidado'), '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'),
    p(r('primero'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    p(''),
    `<w:tbl><w:tr><w:tc>${p(r('A'))}</w:tc><w:tc>${p(r('B'))}</w:tc></w:tr><w:tr><w:tc>${p(r('1'))}</w:tc><w:tc>${p(r('<x>'.replace('<', '&lt;').replace('>', '&gt;')))}</w:tc></w:tr></w:tbl>`,
    p(r('cita'), '<w:pStyle w:val="Cita"/>'),
    p(r('<script>'.replace('<', '&lt;').replace('>', '&gt;'))),
  ].join('')}</w:body></w:document>`,
  'word/styles.xml': `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/></w:style></w:styles>`,
  'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num></w:numbering>`,
  'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/></Relationships>`,
};

describe('Docs: importar .docx', () => {
  it('headings por nombre de estilo, marcas, links, listas con nivel, tablas y citas', () => {
    let n = 0;
    const blocks = docxToBlocks(zip(DOCX), () => `d${++n}`);
    expect(blocks.map((b) => [b.type, b.content, b.indent ?? 0])).toEqual([
      ['heading', 'Informe &amp; plan', 0],
      ['paragraph', 'Hola <strong>negrita</strong> y no', 0],
      ['paragraph', '<a href="https://example.com/a?b=1&amp;c=2">link</a>', 0],
      ['bulleted_list_item', 'uno', 0],
      ['bulleted_list_item', 'anidado', 1],
      ['numbered_list_item', 'primero', 0],
      ['table', '', 0],
      ['quote', 'cita', 0],
      ['paragraph', '&lt;script&gt;', 0],
    ]);
    expect(blocks[0].level).toBe(1);
    expect(blocks[6].rows).toEqual([['A', 'B'], ['1', '<x>']]);
  });

  it('también lee partes sin comprimir; un archivo que no es docx falla con invalid_docx', () => {
    expect(docxToBlocks(zip({ 'word/document.xml': DOCX['word/document.xml'] }, false)).length).toBeGreaterThan(5);
    expect(() => docxToBlocks(Buffer.from('no soy un zip'))).toThrow(DocxImportError);
    expect(() => docxToBlocks(zip({ 'otra.xml': '<x/>' }))).toThrow(DocxImportError);
  });

  it('la ruta de importación pide edición, sanea y rechaza tipos raros', async () => {
    const owner = await makeUser('imp');
    const guest = await makeUser('impg');
    const stranger = await makeUser('imps');
    const page = await createDocPage(owner.id, { title: 'Import' });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'view');
    const post = (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return importRoute.POST(new NextRequest(`http://x/api/docs/pages/${page.id}/import`, { method: 'POST', body }), ctx(page.id));
    };
    const md = new File(['# Hola\n\n- a\n  - b\n\n<script>alert(1)</script> [x](javascript:alert(1))'], 'nota.md', { type: 'text/markdown' });

    as(stranger);
    expect((await post(md)).status).toBe(404);
    as(guest);
    expect((await post(md)).status).toBe(403);
    as(owner);
    expect((await post(new File(['x'], 'a.pdf'))).status).toBe(415);
    expect((await post(new File(['nope'], 'roto.docx'))).status).toBe(422);
    const res = await post(md);
    expect(res.status).toBe(200);
    const { blocks } = (await res.json()) as { blocks: DocsBlock[] };
    expect(blocks.slice(0, 3).map((b) => [b.type, b.content, b.indent ?? 0])).toEqual([
      ['heading', 'Hola', 0],
      ['bulleted_list_item', 'a', 0],
      ['bulleted_list_item', 'b', 1],
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/<script|href=\\"javascript:/);
    const docx = await post(new File([new Uint8Array(zip(DOCX))], 'informe.docx'));
    expect(docx.status).toBe(200);
    expect(((await docx.json()) as { blocks: DocsBlock[] }).blocks[0]).toMatchObject({ type: 'heading', level: 1 });
  });
});

// ---------- 4. Respuestas, @menciones y avisos ----------

describe('Docs: hilos de comentarios con respuestas', () => {
  it('una respuesta cuelga de la raíz, hereda el bloque y reabre el hilo', async () => {
    const owner = await makeUser('thr');
    const page = await createDocPage(owner.id, { title: 'Hilos' });
    const root = await createDocComment(page.id, owner.id, { body: 'Raíz', block_id: 'blk' });
    const reply = await createDocComment(page.id, owner.id, { body: 'R1', parent_id: root.id });
    const nested = await createDocComment(page.id, owner.id, { body: 'R2', parent_id: reply.id });
    expect(reply).toMatchObject({ parent_id: root.id, block_id: 'blk' });
    expect(nested.parent_id).toBe(root.id);

    await setDocCommentResolved(reply.id, true);
    expect((await getDocComment(root.id))?.resolved).toBe(true);
    expect((await getDocComment(nested.id))?.resolved).toBe(true);
    await createDocComment(page.id, owner.id, { body: 'R3', parent_id: root.id });
    expect((await getDocComment(root.id))?.resolved).toBe(false);

    const threads = groupCommentThreads(await listDocComments(page.id));
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((c) => c.body)).toEqual(['R1', 'R2', 'R3']);

    // Borrar la raíz se lleva el hilo.
    expect(await deleteDocComment(root.id)).toBe(true);
    expect(await listDocComments(page.id)).toHaveLength(0);
  });

  it('no se responde a un comentario de otra página', async () => {
    const owner = await makeUser('thx');
    const a = await createDocPage(owner.id, { title: 'A' });
    const b = await createDocPage(owner.id, { title: 'B' });
    const root = await createDocComment(a.id, owner.id, { body: 'en A' });
    as(owner);
    const res = await commentsRoute.POST(
      jsonReq(`http://x/api/docs/pages/${b.id}/comments`, 'POST', { body: 'cruzado', parent_id: root.id }),
      ctx(b.id),
    );
    expect(res.status).toBe(400);
  });

  it('avisa a los @mencionados del workspace y a quienes participan del hilo', async () => {
    const owner = await makeUser('Owner');
    const ana = await makeUser('Ana');
    const beto = await makeUser('Beto');
    const outsider = await makeUser('Out');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, ana.id, 'member');
    await addMember(team.id, beto.id, 'member');
    const page = await createDocPage(owner.id, { title: 'Plan Q3' });
    const post = (body: unknown) =>
      commentsRoute.POST(jsonReq(`http://x/api/docs/pages/${page.id}/comments`, 'POST', body), ctx(page.id));

    // Ana abre el hilo mencionando a Beto (y a alguien de afuera, que no cuenta).
    as(owner, { actingUser: { id: ana.id, email: ana.email, name: 'Ana' } });
    const rootRes = await post({ body: '@Beto mirá esto @Out', mention_ids: [beto.id, outsider.id] });
    expect(rootRes.status).toBe(201);
    const root = (await rootRes.json()) as DocsComment;
    expect(root.user_id).toBe(ana.id);
    const betoMentions = await listNotifications(beto.id);
    expect(betoMentions).toHaveLength(1);
    expect(betoMentions[0]).toMatchObject({ type: 'mention', source_type: 'docs_comment', href: `/app/docs/${page.id}` });
    expect(betoMentions[0].title).toContain('mentioned you in a comment on Plan Q3');
    expect(await listNotifications(outsider.id)).toHaveLength(0);

    // Una mención elegida y después borrada del texto no avisa.
    await post({ body: 'sin nombre', mention_ids: [owner.id] });
    expect(await listNotifications(owner.id)).toHaveLength(0);

    // Beto responde: le avisa a Ana (participante). A él mismo no.
    as(owner, { actingUser: { id: beto.id, email: beto.email, name: 'Beto' } });
    expect((await post({ body: 'Visto', parent_id: root.id })).status).toBe(201);
    const anaNotes = await listNotifications(ana.id);
    expect(anaNotes).toHaveLength(1);
    expect(anaNotes[0]).toMatchObject({ type: 'comment' });
    expect(anaNotes[0].title).toContain('replied to a comment on Plan Q3');
    expect(await listNotifications(beto.id)).toHaveLength(1);

    // Respuesta con mención a quien ya participa: un solo aviso (la mención).
    as(owner, { actingUser: { id: ana.id, email: ana.email, name: 'Ana' } });
    await post({ body: 'Gracias @Beto', parent_id: root.id, mention_ids: [beto.id] });
    const betoAll = await listNotifications(beto.id);
    expect(betoAll).toHaveLength(2);
    expect(betoAll.every((nn) => nn.type === 'mention')).toBe(true);
  });

  it('un participante que perdió el acceso no recibe más avisos', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Review' });
    const share = await createDocShare(owner.id, page.id, 'user', guest.id, 'edit');
    if (!share) throw new Error('share');
    const root = await createDocComment(page.id, guest.id, { body: 'Del invitado' });
    await getDb().prepare('DELETE FROM docs_shares WHERE id = ?').run(share.id);
    as(owner);
    await commentsRoute.POST(
      jsonReq(`http://x/api/docs/pages/${page.id}/comments`, 'POST', { body: 'ok', parent_id: root.id }),
      ctx(page.id),
    );
    expect(await listNotifications(guest.id)).toHaveLength(0);
  });

  it('helpers del composer: @ en curso, insertar, resaltar y filtrar menciones', () => {
    expect(activeMentionQuery('hola @be', 8)).toEqual({ start: 5, query: 'be' });
    expect(activeMentionQuery('mail@x', 6)).toBeNull();
    const ins = insertMention('hola @be y', { start: 5, query: 'be' }, { name: 'Beto', email: 'b@x.co' });
    expect(ins).toEqual({ text: 'hola @Beto  y', caret: 11 });
    expect(commentBodyParts('Hola @Beto!', ['Beto'])).toEqual([
      { text: 'Hola ', mention: false },
      { text: '@Beto', mention: true },
      { text: '!', mention: false },
    ]);
    const people = [{ id: '1', name: 'Beto', email: 'b@x.co' }, { id: '2', name: null, email: 'c@x.co' }];
    expect(mentionedInBody('ok @beto y @c@x.co', people, ['1', '2', '3'])).toEqual(['1', '2']);
  });
});

// ---------- 5. Plantillas del workspace ----------

describe('Docs: guardar páginas como plantillas del workspace', () => {
  it('guarda una copia, crea páginas desde ella y solo dentro del workspace', async () => {
    const owner = await makeUser('tpl');
    const other = await makeUser('tplx');
    const page = await createDocPage(owner.id, {
      title: 'Kickoff',
      icon: '🚀',
      content: [
        { id: 'a', type: 'toggle', content: 'Agenda', collapsed: true },
        { id: 'b', type: 'paragraph', content: 'Punto <script>x</script>', indent: 1 },
      ],
    });

    // Otro workspace no puede guardar esta página.
    as(other);
    const denied = await templatesRoute.POST(jsonReq('http://x/api/docs/templates', 'POST', { page_id: page.id }));
    expect(denied.status).toBe(404);

    as(owner, { role: 'owner' });
    const res = await templatesRoute.POST(
      jsonReq('http://x/api/docs/templates', 'POST', { page_id: page.id, title: 'Kickoff de cliente', description: 'Para arrancar' }),
    );
    expect(res.status).toBe(201);
    const tpl = (await res.json()) as { id: string; title: string; icon: string };
    expect(tpl).toMatchObject({ title: 'Kickoff de cliente', icon: '🚀' });
    expect((await listDocWorkspaceTemplates(other.id))).toHaveLength(0);

    // Cambiar la página después no toca la plantilla.
    await getDb().prepare("UPDATE docs_pages SET content = '[]' WHERE id = ?").run(page.id);

    let redirected = '';
    await actions.createDocPageFromWorkspaceTemplateAction('en', tpl.id).catch((err: Error) => {
      redirected = err.message;
    });
    const newId = /REDIRECT:\/en\/app\/docs\/(.+)$/.exec(redirected)?.[1] ?? '';
    const created = await getDocPage(owner.id, newId);
    expect(created).toMatchObject({ title: 'Kickoff de cliente', icon: '🚀' });
    expect(created!.content.map((b) => [b.type, b.indent ?? 0, b.collapsed ?? false])).toEqual([
      ['toggle', 0, true],
      ['paragraph', 1, false],
    ]);
    expect(created!.content[0].id).not.toBe('a');
    expect(JSON.stringify(created!.content)).not.toContain('<script');

    // Desde otro workspace la plantilla no existe: vuelve al inicio de Docs.
    as(other);
    const before = (await listDocPages(other.id)).length;
    await expect(actions.createDocPageFromWorkspaceTemplateAction('en', tpl.id)).rejects.toThrow('REDIRECT:/en/app/docs');
    expect((await listDocPages(other.id)).length).toBe(before);
  });

  it('borrar: quien la guardó o un admin; nadie de otro workspace', async () => {
    const owner = await makeUser('tdo');
    const member = await makeUser('tdm');
    const page = await createDocPage(owner.id, { title: 'Base' });
    const tpl = (await createDocWorkspaceTemplate(owner.id, owner.id, { page_id: page.id }))!;
    // Un miembro sin rol de admin no borra la del dueño.
    as(owner, { role: 'member', actingUser: { id: member.id, email: member.email, name: null } });
    await actions.deleteDocWorkspaceTemplateAction(tpl.id);
    expect(await listDocWorkspaceTemplates(owner.id)).toHaveLength(1);
    // Otro workspace tampoco.
    const stranger = await makeUser('tds');
    as(stranger, { role: 'owner' });
    await actions.deleteDocWorkspaceTemplateAction(tpl.id);
    expect(await listDocWorkspaceTemplates(owner.id)).toHaveLength(1);
    // El admin del workspace sí.
    as(owner, { role: 'owner' });
    await actions.deleteDocWorkspaceTemplateAction(tpl.id);
    expect(await listDocWorkspaceTemplates(owner.id)).toHaveLength(0);
  });

  it('renombrar: quien la guardó o un admin; sin título vacío', async () => {
    const owner = await makeUser('tro');
    const member = await makeUser('trm');
    const page = await createDocPage(owner.id, { title: 'Base' });
    const tpl = (await createDocWorkspaceTemplate(owner.id, member.id, { page_id: page.id }))!;
    const title = async () => (await listDocWorkspaceTemplates(owner.id))[0].title;
    // Quien la guardó (miembro, sin rol de admin) la renombra.
    as(owner, { role: 'member', actingUser: { id: member.id, email: member.email, name: null } });
    expect(await actions.renameDocWorkspaceTemplateAction(tpl.id, '  Kickoff  ')).toBe(true);
    expect(await title()).toBe('Kickoff');
    expect(await actions.renameDocWorkspaceTemplateAction(tpl.id, '   ')).toBe(false);
    expect(await title()).toBe('Kickoff');
    // Otro miembro no.
    const other = await makeUser('tr2');
    as(owner, { role: 'member', actingUser: { id: other.id, email: other.email, name: null } });
    expect(await actions.renameDocWorkspaceTemplateAction(tpl.id, 'Ajena')).toBe(false);
    // Otro workspace tampoco.
    const stranger = await makeUser('trs');
    as(stranger, { role: 'owner' });
    expect(await actions.renameDocWorkspaceTemplateAction(tpl.id, 'Ajena')).toBe(false);
    expect(await title()).toBe('Kickoff');
    // El admin sí, y también la borra.
    as(owner, { role: 'owner' });
    expect(await actions.renameDocWorkspaceTemplateAction(tpl.id, 'Del admin')).toBe(true);
    expect(await title()).toBe('Del admin');
    expect(await actions.deleteDocWorkspaceTemplateAction(tpl.id)).toBe(true);
    expect(await listDocWorkspaceTemplates(owner.id)).toHaveLength(0);
  });

  it('tope de plantillas por workspace', async () => {
    const owner = await makeUser('tlim');
    const page = await createDocPage(owner.id, { title: 'X' });
    const now = new Date().toISOString();
    for (let i = 0; i < DOCS_TEMPLATES_MAX; i++) {
      await getDb()
        .prepare('INSERT INTO docs_templates (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), owner.id, `t${i}`, now, now);
    }
    await expect(createDocWorkspaceTemplate(owner.id, owner.id, { page_id: page.id })).rejects.toThrow(DocsTemplateLimitError);
    as(owner);
    expect((await templatesRoute.POST(jsonReq('http://x/api/docs/templates', 'POST', { page_id: page.id }))).status).toBe(409);
  });
});

describe('Docs: dónde cae un bloque nuevo', () => {
  const b = (id: string, indent = 0, extra: Partial<DocsBlock> = {}): DocsBlock => ({ id, type: 'paragraph', content: '', ...(indent ? { indent } : {}), ...extra });
  it('primer hijo si tiene hijos; después del subárbol si es un toggle plegado', () => {
    expect(insertionPoint([b('a'), b('a1', 1), b('c')], 0)).toEqual({ at: 1, indent: 1 });
    expect(insertionPoint([b('t', 0, { type: 'toggle', collapsed: true }), b('t1', 1), b('c')], 0)).toEqual({ at: 2, indent: 0 });
    expect(insertionPoint([b('a'), b('c')], 0)).toEqual({ at: 1, indent: 0 });
    expect(insertionPoint([b('a', 0), b('a1', 1)], 1)).toEqual({ at: 2, indent: 1 });
  });
});
